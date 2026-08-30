import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import {
  LiasseLigne,
  TrialBalanceAccount,
  buildTrialBalance,
} from '../liasse/trial-balance-engine';
import { computeCompteResultat2052_2053 } from '../liasse/compte-resultat-2052-2053';
import {
  CONFIRMABLE_LINE_ACCOUNT_PREFIXES,
  ResultatFiscalResult,
  assertResultatFiscalArithmetic,
  computeResultatFiscal,
} from './resultat-fiscal';
import { assertConfirmableLineTraceSums, traceConfirmableLine } from './resultat-fiscal-trace';
import { ComputeResultatFiscalDto } from './dto/compute-resultat-fiscal.dto';
import { ResultatFiscalTraceQueryDto } from './dto/resultat-fiscal-trace-query.dto';

/**
 * Détermination du résultat fiscal — see resultat-fiscal.ts for the
 * compute logic and every scope decision. This service is the fetch
 * layer: unlike cash-flow/financial-analysis, this module needs only
 * the CLOSING trial balance (no opening bilan, no immobilisations) —
 * a résultat fiscal worksheet has no delta/snapshot articulation to
 * verify, only the compte de résultat anchor and two raw-account
 * suggestions.
 */
@Injectable()
export class ResultatFiscalService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(
    company: CompanyContext,
    dto: ComputeResultatFiscalDto,
  ): Promise<ResultatFiscalResult> {
    const { closingCompteResultat, closingChargesAccounts } = await this.fetchClosingContext(
      company,
      dto.fiscalYearId,
    );

    const sumAccountBalance = (accounts: TrialBalanceAccount[], prefix: string): Money =>
      accounts
        .filter((a) => a.accountNumber.startsWith(prefix))
        .reduce((sum, a) => sum.plus(a.balance), Money.zero()); // balance = debit − credit, already positive for a normal charge
    const suggestedAmendesEtPenalites = sumAccountBalance(
      closingChargesAccounts,
      CONFIRMABLE_LINE_ACCOUNT_PREFIXES.WJ,
    );
    const suggestedTaxeVehicules = sumAccountBalance(
      closingChargesAccounts,
      CONFIRMABLE_LINE_ACCOUNT_PREFIXES.WG,
    );

    const confirmedAmendesEtPenalites = dto.confirmedAmendesEtPenalites
      ? Money.fromString(dto.confirmedAmendesEtPenalites)
      : suggestedAmendesEtPenalites;
    const confirmedTaxeVehicules = dto.confirmedTaxeVehicules
      ? Money.fromString(dto.confirmedTaxeVehicules)
      : suggestedTaxeVehicules;

    const result = computeResultatFiscal({
      closingCompteResultat,
      suggestedAmendesEtPenalites,
      confirmedAmendesEtPenalites,
      suggestedTaxeVehicules,
      confirmedTaxeVehicules,
      reintegrationsDeclarees: (dto.reintegrationsDeclarees ?? []).map((l) => ({
        code: l.code,
        label: l.label,
        montant: l.montant,
      })),
      deductionsDeclarees: (dto.deductionsDeclarees ?? []).map((l) => ({
        code: l.code,
        label: l.label,
        montant: l.montant,
      })),
    });
    assertResultatFiscalArithmetic(result);

    return result;
  }

  /**
   * Traceability drill-down, Tier 3 — 2058 WJ/WG. See CLAUDE.md
   * "Traceability drill-down" and `resultat-fiscal-trace.ts`'s own doc
   * comment. Resolves the pure trace's bare account NUMBERS back to
   * real ids/labels afterward, same "pure trace, then a second id-
   * resolution pass" split `liasse.service.ts`'s own `withAccountIds()`
   * already established for Tier 1.
   */
  async traceConfirmableLine(
    company: CompanyContext,
    dto: ResultatFiscalTraceQueryDto,
  ): Promise<ResultatFiscalLineTraceResult> {
    const { fiscalYear, closingChargesAccounts } = await this.fetchClosingContext(
      company,
      dto.fiscalYearId,
    );

    const trace = traceConfirmableLine(closingChargesAccounts, fiscalYear.id, dto.code);

    // Independent second derivation, same discipline as every other trace tier — a freshly,
    // separately-written filter+sum over the SAME closingChargesAccounts, not the same call
    // (traceConfirmableLine's own internal sum) checked against itself.
    const prefix = CONFIRMABLE_LINE_ACCOUNT_PREFIXES[dto.code];
    const independentSuggestion = closingChargesAccounts
      .filter((a) => a.accountNumber.startsWith(prefix))
      .reduce((sum, a) => sum.plus(a.balance), Money.zero());
    assertConfirmableLineTraceSums(trace, independentSuggestion);

    const numbers = trace.accounts.map((a) => a.accountNumber);
    const accountRows = await this.prisma.account.findMany({
      where: { companyId: company.companyId, number: { in: numbers } },
    });
    const byNumber = new Map(accountRows.map((a) => [a.number, a]));
    return {
      code: trace.code,
      label: trace.label,
      fiscalYearId: trace.fiscalYearId,
      columnValue: trace.columnValue,
      accounts: trace.accounts.map((a) => {
        const row = byNumber.get(a.accountNumber);
        if (!row) {
          throw new NotFoundException(
            `Account "${a.accountNumber}" was traced to 2058 ${trace.code} but no longer exists on ` +
              'this company.',
          );
        }
        return {
          accountId: row.id,
          accountNumber: row.number,
          accountLabel: row.label,
          contribution: a.contribution,
        };
      }),
    };
  }

  /**
   * Shared fetch for generate()/traceConfirmableLine() — company/
   * fiscal-year lookup, the draft-block guard, and the closing compte
   * de résultat + charges-accounts trial balance. Extracted so the
   * trace reuses the IDENTICAL fetch generate() already used.
   */
  private async fetchClosingContext(company: CompanyContext, fiscalYearId: string) {
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

    const draftCount = await this.prisma.ecriture.count({
      where: { companyId: company.companyId, fiscalYearId: fiscalYear.id, validatedAt: null },
    });
    if (draftCount > 0) {
      throw new ConflictException(
        `Cannot compute the résultat fiscal: ${draftCount} écriture(s) in this fiscal year are ` +
          'still unvalidated (draft). Validate them first.',
      );
    }

    const lignes = await this.prisma.ecritureLigne.findMany({
      where: {
        companyId: company.companyId,
        ecriture: { fiscalYearId: fiscalYear.id, validatedAt: { not: null } },
      },
      include: { compte: true },
    });

    const closingLignes: LiasseLigne[] = lignes.map((ligne) => ({
      compteNumber: ligne.compte.number,
      pcgClass: ligne.compte.pcgClass,
      debit: ligne.debit,
      credit: ligne.credit,
    }));
    const closingTrialBalance = buildTrialBalance(closingLignes);
    const closingCdrAccounts = closingTrialBalance.filter(
      (a) => a.pcgClass === 6 || a.pcgClass === 7,
    );
    const closingCompteResultat = computeCompteResultat2052_2053(closingCdrAccounts);
    const closingChargesAccounts = closingTrialBalance.filter((a) => a.pcgClass === 6);

    return { companyRecord, fiscalYear, closingCompteResultat, closingChargesAccounts };
  }
}

/** One contributing account, with real ids resolved — the API-facing shape of a 2058 WJ/WG trace. */
export interface ResultatFiscalTracedAccount {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  contribution: string;
}

export interface ResultatFiscalLineTraceResult {
  code: string;
  label: string;
  fiscalYearId: string;
  columnValue: string;
  accounts: ResultatFiscalTracedAccount[];
}
