import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FiscalYear } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import {
  LiasseLigne,
  TrialBalanceAccount,
  buildTrialBalance,
} from '../liasse/trial-balance-engine';
import { Bilan2050, computeBilan2050 } from '../liasse/bilan-2050';
import {
  CompteResultat2052_2053,
  computeCompteResultat2052_2053,
} from '../liasse/compte-resultat-2052-2053';
import {
  CashFlowStatement,
  assertCashFlowReconciles,
  computeCashFlowStatement,
} from './cash-flow-statement';
import { ComputeCashFlowDto } from './dto/compute-cash-flow.dto';

const CREANCES_SUR_CESSIONS_ACCOUNT_PREFIX = '462';
const TVA_DEDUCTIBLE_AUTRES_ACCOUNT_PREFIX = '445660';
const TVA_DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT_PREFIX = '445662';

/**
 * Everything computeCashFlowStatement() needs, plus the intermediate
 * bilans/trial-balances themselves — exposed so other modules (e.g.
 * FinancialAnalysisService) can build on the EXACT SAME fetch, never a
 * second, independently-typed re-derivation that could silently drift.
 * See financial-analysis.ts's BFR computation for why this matters: its
 * BFR snapshot must agree with this module's own embedded ΔBFR to the
 * centime, and sharing this context is what guarantees that by
 * construction rather than by two hand-synced formulas.
 */
export interface CashFlowContext {
  fiscalYear: FiscalYear;
  closingBilan: Bilan2050;
  closingCompteResultat: CompteResultat2052_2053;
  closingBilanAccounts: TrialBalanceAccount[];
  openingBilan: Bilan2050;
  openingBilanAccounts: TrialBalanceAccount[];
  openingCreancesSurCessions: Money;
  closingCreancesSurCessions: Money;
  openingTvaDeductibleAutres: Money;
  closingTvaDeductibleAutres: Money;
  openingTvaDeductibleImmobilisations: Money;
  closingTvaDeductibleImmobilisations: Money;
  acquisitionsImmobilisations: Money;
  cessionsImmobilisations: Money;
}

/**
 * Tableau des flux de trésorerie, méthode indirecte — see
 * cash-flow-statement.ts for the compute/reconciliation logic and its
 * scope decisions. This service is the fetch layer: it does NOT reuse
 * LiasseService.generate() (see CLAUDE.md "Tableau des flux de
 * trésorerie" for why — the immobilisations VNC tie-out throws for a
 * fiscal year, like the multi-year fixture's FY2025, whose asset gross
 * values live entirely inside a LATER year's à-nouveau block).
 */
@Injectable()
export class CashFlowService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The shared fetch/build step — see CashFlowContext's doc comment.
   * Does NOT check the draft-count guard (the caller decides whether
   * that matters for its own use case); generate() below applies it.
   */
  async buildContext(company: CompanyContext, fiscalYearId: string): Promise<CashFlowContext> {
    const companyRecord = await this.prisma.company.findFirst({ where: { id: company.companyId } });
    if (!companyRecord) {
      throw new NotFoundException(`Company ${company.companyId} not found`);
    }

    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${fiscalYearId} not found`);
    }

    const lignes = await this.prisma.ecritureLigne.findMany({
      where: {
        companyId: company.companyId,
        ecriture: { fiscalYearId: fiscalYear.id, validatedAt: { not: null } },
      },
      include: { compte: true, ecriture: true },
    });

    const closingLignes: LiasseLigne[] = lignes.map((ligne) => ({
      compteNumber: ligne.compte.number,
      pcgClass: ligne.compte.pcgClass,
      debit: ligne.debit,
      credit: ligne.credit,
    }));
    const closingTrialBalance = buildTrialBalance(closingLignes);
    const closingBilanAccounts = closingTrialBalance.filter(
      (a) => a.pcgClass >= 1 && a.pcgClass <= 5,
    );
    const closingCdrAccounts = closingTrialBalance.filter(
      (a) => a.pcgClass === 6 || a.pcgClass === 7,
    );

    const closingCompteResultat = computeCompteResultat2052_2053(closingCdrAccounts);
    const closingBilan = computeBilan2050(
      closingBilanAccounts,
      Money.fromString(closingCompteResultat.beneficeOuPerte),
    );

    // Opening bilan lines are identified by ecritureDate === fiscalYear.startDate, not by journal
    // type. a-nouveau.service.ts ALWAYS dates the opening écriture it generates at exactly
    // `target.startDate` — a genuine structural invariant of the real feature, confirmed directly in
    // that service, not a convention specific to any one dataset. This replaced an earlier version
    // that filtered on `journal.type === 'A_NOUVEAU'` — a real bug found live: the multi-year
    // fixture's own opening écriture was hand-built through a generic "OD" (Opérations diverses)
    // journal (this fixture company has no JournalType.A_NOUVEAU journal at all), so the journal-type
    // filter matched zero lines and silently produced an all-zero opening bilan, cascading into a
    // 300200.00-vs-14000.00 reconciliation failure — caught by assertCashFlowReconciles exactly as
    // designed. A second, sharper version of the same investigation ("sum every validated ligne dated
    // strictly before fiscalYear.startDate", reasoning that balance-sheet accounts never reset) was
    // tried and also found wrong, live: this fixture's FY2025 has no acquisition/capital écritures of
    // its own at all (only 3 stray dotation postings) — everything before FY2026 (terrain, bâtiment,
    // machine, véhicule, capital) lives entirely inside the single AN-2026 écriture, which is dated
    // exactly on FY2026's own startDate and itself belongs to FY2026, not FY2025. There is nothing
    // "strictly before" to sum. Matching on the exact startDate is therefore not a fallback heuristic
    // but the only signal this data actually offers, and it matches the real feature's own invariant
    // exactly. Known limitation: a genuine operational écriture dated exactly on the fiscal year's own
    // first day would also be swept into "opening" by this signal — accepted since no sharper
    // distinguishing signal exists, and no such collision exists in any data this module has been
    // verified against. Accounts 120000/129000 are still excluded: bilan-2050.ts has no PASSIF_RULE
    // for them (DI is always constructed from HN, never read off the ledger), so classifyAccounts
    // would throw "unmapped account" on the opening écriture's own 120/129 line. The opening bilan's
    // own DI/résultat is never used by this module (only specific asset/liability lines are), so
    // dropping 120/129 loses nothing this needs.
    const openingLignes: LiasseLigne[] = lignes
      .filter(
        (ligne) =>
          ligne.ecriture.ecritureDate.getTime() === fiscalYear.startDate.getTime() &&
          !ligne.compte.number.startsWith('120') &&
          !ligne.compte.number.startsWith('129'),
      )
      .map((ligne) => ({
        compteNumber: ligne.compte.number,
        pcgClass: ligne.compte.pcgClass,
        debit: ligne.debit,
        credit: ligne.credit,
      }));
    const openingTrialBalance = buildTrialBalance(openingLignes);
    const openingBilanAccounts = openingTrialBalance.filter(
      (a) => a.pcgClass >= 1 && a.pcgClass <= 5,
    );
    const openingBilan = computeBilan2050(openingBilanAccounts, Money.zero());
    // A fiscal year with no à-nouveau at all (e.g. a company's first) yields an all-zero opening
    // bilan here — the correct "no prior year" case, not a guess.

    const sumAccountBalance = (accounts: TrialBalanceAccount[], prefix: string): Money =>
      accounts
        .filter((a) => a.accountNumber.startsWith(prefix))
        .reduce((sum, a) => sum.plus(a.balance), Money.zero());
    const openingCreancesSurCessions = sumAccountBalance(
      openingBilanAccounts,
      CREANCES_SUR_CESSIONS_ACCOUNT_PREFIX,
    );
    const closingCreancesSurCessions = sumAccountBalance(
      closingBilanAccounts,
      CREANCES_SUR_CESSIONS_ACCOUNT_PREFIX,
    );
    // 445660/445662 carved out of BZ the same way 462 is above — see cash-flow-statement.ts's doc
    // comment for why (they're individually addressable, unlike the genuinely-commingled rest of BZ).
    const openingTvaDeductibleAutres = sumAccountBalance(
      openingBilanAccounts,
      TVA_DEDUCTIBLE_AUTRES_ACCOUNT_PREFIX,
    );
    const closingTvaDeductibleAutres = sumAccountBalance(
      closingBilanAccounts,
      TVA_DEDUCTIBLE_AUTRES_ACCOUNT_PREFIX,
    );
    const openingTvaDeductibleImmobilisations = sumAccountBalance(
      openingBilanAccounts,
      TVA_DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT_PREFIX,
    );
    const closingTvaDeductibleImmobilisations = sumAccountBalance(
      closingBilanAccounts,
      TVA_DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT_PREFIX,
    );

    const assetsAcquiredThisYear = await this.prisma.fixedAsset.findMany({
      where: {
        companyId: company.companyId,
        acquisitionDate: { gte: fiscalYear.startDate, lte: fiscalYear.endDate },
      },
    });
    const acquisitionsImmobilisations = assetsAcquiredThisYear.reduce(
      (sum, asset) => sum.plus(Money.fromDecimal(asset.acquisitionValue)),
      Money.zero(),
    );

    const assetsDisposedThisYear = await this.prisma.fixedAsset.findMany({
      where: {
        companyId: company.companyId,
        cessionDate: { gte: fiscalYear.startDate, lte: fiscalYear.endDate },
      },
    });
    const cessionsImmobilisations = assetsDisposedThisYear.reduce(
      (sum, asset) => sum.plus(Money.fromDecimal(asset.cessionPrice!)),
      Money.zero(),
    );

    return {
      fiscalYear,
      closingBilan,
      closingCompteResultat,
      closingBilanAccounts,
      openingBilan,
      openingBilanAccounts,
      openingCreancesSurCessions,
      closingCreancesSurCessions,
      openingTvaDeductibleAutres,
      closingTvaDeductibleAutres,
      openingTvaDeductibleImmobilisations,
      closingTvaDeductibleImmobilisations,
      acquisitionsImmobilisations,
      cessionsImmobilisations,
    };
  }

  async generate(company: CompanyContext, dto: ComputeCashFlowDto): Promise<CashFlowStatement> {
    const context = await this.buildContext(company, dto.fiscalYearId);

    const draftCount = await this.prisma.ecriture.count({
      where: {
        companyId: company.companyId,
        fiscalYearId: context.fiscalYear.id,
        validatedAt: null,
      },
    });
    if (draftCount > 0) {
      throw new ConflictException(
        `Cannot generate the tableau des flux de trésorerie: ${draftCount} écriture(s) in this ` +
          'fiscal year are still unvalidated (draft). Validate them first.',
      );
    }

    const statement = computeCashFlowStatement(context);
    assertCashFlowReconciles(statement);

    return statement;
  }
}
