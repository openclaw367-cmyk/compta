import {
  ConflictException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { computeFixedAssetSummary } from '../depreciation/fixed-asset-invariants';
import { ComputeLiasseDto } from './dto/compute-liasse.dto';
import { LineTraceQueryDto } from './dto/line-trace-query.dto';
import { LiasseLigne, buildTrialBalance } from './trial-balance-engine';
import {
  ACTIF_RULES as ACTIF_RULES_2050,
  PASSIF_RULES as PASSIF_RULES_2050,
  DUAL_NATURE_RULES as DUAL_NATURE_RULES_2050,
  Bilan2050,
  computeBilan2050,
  resolveImmobilisationLineCode,
} from './bilan-2050';
import {
  ACTIF_RULES as ACTIF_RULES_2033,
  PASSIF_RULES as PASSIF_RULES_2033,
  DUAL_NATURE_RULES as DUAL_NATURE_RULES_2033,
  Bilan2033A,
  computeBilan2033A,
} from './bilan-2033-a';
import {
  CDR_RULES as CDR_RULES_2050,
  CompteResultat2052_2053,
  computeCompteResultat2052_2053,
} from './compte-resultat-2052-2053';
import {
  CDR_RULES as CDR_RULES_2033,
  CompteResultat2033B,
  computeCompteResultat2033B,
} from './compte-resultat-2033-b';
import { LineTraceResult, traceLine } from './liasse-line-trace';
import {
  VncCheckLine,
  assertLiasseArticulation,
  assertBilan2033ABalances,
  assertTableauxTieToBilan,
  assertTableau2056TiesToBilan,
  assertTableau2057TiesToBilan,
  assertTableau2059TiesToCompteResultat,
} from './liasse-articulation';
import { ImmobilisationMovementAsset, Tableau2054, computeTableau2054 } from './tableau-2054';
import {
  ImmobilisationDepreciationMovement,
  ImmobilisationDisposal,
  Tableau2055,
  computeTableau2055,
} from './tableau-2055';
import { ProvisionMovementLigne, Tableau2056, computeTableau2056 } from './tableau-2056';
import { PROVISION_ACCOUNT_CLASS_PREFIXES } from './provision-categories';
import { Tableau2057, Tableau2057RawLigne, computeTableau2057 } from './tableau-2057';
import { Tableau2059AAsset, Tableau2059A, computeTableau2059A } from './tableau-2059';
import { traceTableau2059Column } from './tableau-2059-trace';
import { Tableau2059TraceQueryDto } from './dto/tableau-2059-trace-query.dto';
import {
  ImmobilisationMovementAssetWithId,
  Tableau2054TraceResult,
  traceTableau2054Column,
} from './tableau-2054-trace';
import {
  ImmobilisationDepreciationMovementWithId,
  ImmobilisationDisposalWithId,
  Tableau2055TraceResult,
  traceTableau2055Column,
} from './tableau-2055-trace';
import {
  ProvisionMovementLigneWithAccount,
  Tableau2056TraceResult,
  traceTableau2056Column,
} from './tableau-2056-trace';
import { Tableau2054TraceQueryDto } from './dto/tableau-2054-trace-query.dto';
import { Tableau2055TraceQueryDto } from './dto/tableau-2055-trace-query.dto';
import { Tableau2056TraceQueryDto } from './dto/tableau-2056-trace-query.dto';

/**
 * Response shape for `traceTableau2059()` — see CLAUDE.md "Traceability
 * drill-down". Unlike every other trace tier, this is a SINGLE
 * account, never a list — a 2059-A row is already asset-level, so
 * there's nothing to aggregate.
 */
export interface LiasseTableau2059TraceResult {
  assetId: string;
  assetLabel: string;
  column: string;
  columnValue: string;
  fiscalYearId: string;
  accountId: string;
  accountNumber: string;
  accountLabel: string;
}

/** One contributing account in a traceability drill-down — see `liasse-line-trace.ts`. */
export interface TracedAccountWithId {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  /** This account's own signed contribution to the line's total. */
  contribution: string;
}

/** Response shape for `traceBilanLine()`/`traceCdrLine()` — see CLAUDE.md "Traceability drill-down". */
export interface LiasseLineTraceResult {
  lineCode: string;
  lineLabel: string;
  lineValue: string;
  fiscalYearId: string;
  accounts: TracedAccountWithId[];
}

export interface LiasseResult {
  regime: 'REEL_NORMAL';
  bilan: Bilan2050;
  compteResultat: CompteResultat2052_2053;
  tableau2054: Tableau2054;
  tableau2055: Tableau2055;
  tableau2056: Tableau2056;
  tableau2057: Tableau2057;
  tableau2059: Tableau2059A;
}

/**
 * Régime réel simplifié — bilan simplifié (2033-A) and compte de résultat
 * simplifié (2033-B, "A - RÉSULTAT COMPTABLE" section only) only, no
 * annexe equivalents (2033-C onward are a future pass) — see
 * bilan-2033-a.ts/compte-resultat-2033-b.ts for the full scope statement.
 */
export interface LiasseSimplifieResult {
  regime: 'REEL_SIMPLIFIE';
  bilan: Bilan2033A;
  compteResultat: CompteResultat2033B;
}

/**
 * Liasse fiscale, régime réel normal (2050-series) — bilan, compte de
 * résultat, the 2054/2055 immobilisations/amortissements movement
 * annexes, 2056 (provisions), 2057 (état des créances et des dettes,
 * montant brut only — see tableau-2057.ts for why the maturity split is
 * blocked), and 2059-A (plus/moins-values, a guarded always-empty
 * stub). See specs/liasse-2050-implementation-spec.md,
 * specs/liasse-2054-2055-implementation-spec.md, and
 * specs/liasse-2056-2059-implementation-spec.md for exactly what's
 * built vs. deferred on each. The 2033-series (régime réel simplifié)
 * mapping doesn't exist yet — a REEL_SIMPLIFIE company is refused
 * explicitly rather than silently handed a réel-normal liasse, same
 * discipline as VatService.computeDeclaration()'s jurisdiction guard.
 *
 * Only validated écritures are read, and the whole computation refuses
 * if any écriture in the fiscal year is still a draft — same rule as
 * FEC/CA3/Monaco. Class 8 (comptes spéciaux — off-balance-sheet
 * commitments) is excluded from both the bilan and the compte de
 * résultat: per Règlement ANC 2014-03 art. 934-3, class 8 exists purely
 * "pour satisfaire à des exigences d'information", not as part of
 * either statutory statement.
 */
@Injectable()
export class LiasseService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(
    company: CompanyContext,
    dto: ComputeLiasseDto,
  ): Promise<LiasseResult | LiasseSimplifieResult> {
    const ctx = await this.fetchLedgerContext(company, dto);
    if (ctx.companyRecord.regime === 'REEL_SIMPLIFIE') {
      return this.computeReelSimplifie(ctx.bilanAccounts, ctx.compteResultatAccounts);
    }
    return this.computeReelNormal(company, ctx);
  }

  /**
   * The regime the company DIDN'T pick, computed from the exact same
   * ledger — see CLAUDE.md "Liasse fiscale — comparison view". Both
   * regimes are always available for any company since they read the
   * same PCG ledger; `Company.regime` only selects which one is the
   * OFFICIAL/fileable one, not which one is computable. Deliberately a
   * separate method (and separate endpoint) rather than folding this
   * into `generate()`'s return shape: a failure computing the secondary
   * regime (e.g. an account that classifies cleanly under one regime's
   * rule table but not the other's) must never block viewing the
   * company's own official liasse — two independent calls guarantee
   * that structurally, with no try/catch resilience logic needed here.
   */
  async generateSecondary(
    company: CompanyContext,
    dto: ComputeLiasseDto,
  ): Promise<LiasseResult | LiasseSimplifieResult> {
    const ctx = await this.fetchLedgerContext(company, dto);
    if (ctx.companyRecord.regime === 'REEL_SIMPLIFIE') {
      return this.computeReelNormal(company, ctx);
    }
    return this.computeReelSimplifie(ctx.bilanAccounts, ctx.compteResultatAccounts);
  }

  /**
   * Traceability drill-down, Tier 1 — bilan family. See CLAUDE.md
   * "Traceability drill-down" and `liasse-line-trace.ts`'s own doc
   * comment for the design. Regime-agnostic at this call site: which
   * rule table is picked is the ONLY branch, `traceLine()` itself is
   * identical either way — the same engine `generate()` already proved
   * supports both regimes without changes.
   *
   * Branches on `dto.regime` (caller-supplied), NEVER
   * `ctx.companyRecord.regime` — a real bug caught before shipping: the
   * comparison view (`generateSecondary()`) renders the regime the
   * company DIDN'T pick, so a click there must trace against THAT
   * regime's table, which can differ from the company's own official
   * one. See `LineTraceQueryDto.regime`'s own doc comment.
   */
  async traceBilanLine(
    company: CompanyContext,
    dto: LineTraceQueryDto,
  ): Promise<LiasseLineTraceResult> {
    const ctx = await this.fetchLedgerContext(company, dto);
    const { rules, dualNatureRules } =
      dto.regime === 'REEL_SIMPLIFIE'
        ? {
            rules: [...ACTIF_RULES_2033, ...PASSIF_RULES_2033],
            dualNatureRules: DUAL_NATURE_RULES_2033,
          }
        : {
            rules: [...ACTIF_RULES_2050, ...PASSIF_RULES_2050],
            dualNatureRules: DUAL_NATURE_RULES_2050,
          };
    const traced = traceLine(dto.lineCode, ctx.bilanAccounts, rules, dualNatureRules);
    return this.withAccountIds(company, ctx.fiscalYear.id, traced);
  }

  /**
   * Traceability drill-down, Tier 1 — compte de résultat family. Same
   * shape as `traceBilanLine()` above, including branching on
   * `dto.regime` rather than `ctx.companyRecord.regime` for the same
   * comparison-view reason.
   */
  async traceCdrLine(
    company: CompanyContext,
    dto: LineTraceQueryDto,
  ): Promise<LiasseLineTraceResult> {
    const ctx = await this.fetchLedgerContext(company, dto);
    const rules = dto.regime === 'REEL_SIMPLIFIE' ? CDR_RULES_2033 : CDR_RULES_2050;
    const traced = traceLine(dto.lineCode, ctx.compteResultatAccounts, rules);
    return this.withAccountIds(company, ctx.fiscalYear.id, traced);
  }

  /**
   * Traceability drill-down, Tier 2 — 2054 (immobilisations, valeur
   * brute movement). See CLAUDE.md "Traceability drill-down" and
   * `tableau-2054-trace.ts`'s own doc comment for the design (including
   * why "début" has no "→ écritures" hop). REEL_NORMAL only — 2054 has
   * no 2033-series equivalent, same scope boundary `generate()` itself
   * already enforces.
   */
  async traceTableau2054(
    company: CompanyContext,
    dto: Tableau2054TraceQueryDto,
  ): Promise<Tableau2054TraceResult> {
    const ctx = await this.fetchLedgerContext(company, dto);
    this.assertReelNormalOnly(ctx.companyRecord.regime, '2054');
    const assets = await this.fetchImmobilisations(company, ctx.fiscalYear);
    const enriched: ImmobilisationMovementAssetWithId[] = assets.map((asset) => ({
      accountNumber: asset.account.number,
      acquisitionDate: asset.acquisitionDate,
      acquisitionValue: Money.fromDecimal(asset.acquisitionValue),
      cessionDate: asset.cessionDate,
      assetId: asset.id,
      assetLabel: asset.label,
      accountId: asset.account.id,
      accountLabel: asset.account.label,
    }));
    return traceTableau2054Column(enriched, ctx.fiscalYear, dto.rowCode, dto.column);
  }

  /**
   * Traceability drill-down, Tier 2 — 2055 (amortissements movement).
   * See `tableau-2055-trace.ts`'s own doc comment. REEL_NORMAL only,
   * same reason as 2054 above.
   */
  async traceTableau2055(
    company: CompanyContext,
    dto: Tableau2055TraceQueryDto,
  ): Promise<Tableau2055TraceResult> {
    const ctx = await this.fetchLedgerContext(company, dto);
    this.assertReelNormalOnly(ctx.companyRecord.regime, '2055');
    const assets = await this.fetchImmobilisations(company, ctx.fiscalYear);
    const assetsDisposedThisYear = assets.filter(
      (asset) =>
        asset.cessionDate &&
        asset.cessionDate >= ctx.fiscalYear.startDate &&
        asset.cessionDate <= ctx.fiscalYear.endDate,
    );

    const entries: ImmobilisationDepreciationMovementWithId[] = assets.flatMap((asset) =>
      asset.depreciationEntries.map((entry) => ({
        accountNumber: asset.account.number,
        fiscalYearId: entry.fiscalYearId,
        fiscalYearEndDate: entry.fiscalYear.endDate,
        amount: Money.fromDecimal(entry.amount),
        entryId: entry.id,
        assetId: asset.id,
        assetLabel: asset.label,
        depreciationAccountId: asset.depreciationAccount.id,
        depreciationAccountNumber: asset.depreciationAccount.number,
        depreciationAccountLabel: asset.depreciationAccount.label,
      })),
    );
    const disposals: ImmobilisationDisposalWithId[] = assetsDisposedThisYear.map((asset) => ({
      accountNumber: asset.account.number,
      amortissementsCumules: computeFixedAssetSummary(asset, asset.depreciationEntries)
        .amortissementsCumules,
      assetId: asset.id,
      assetLabel: asset.label,
      depreciationAccountId: asset.depreciationAccount.id,
      depreciationAccountNumber: asset.depreciationAccount.number,
      depreciationAccountLabel: asset.depreciationAccount.label,
    }));

    return traceTableau2055Column(
      entries,
      disposals,
      { id: ctx.fiscalYear.id, endDate: ctx.fiscalYear.endDate },
      dto.categoryCode,
      dto.column,
    );
  }

  /**
   * Traceability drill-down, Tier 2 — 2056 (provisions). See
   * `tableau-2056-trace.ts`'s own doc comment. REEL_NORMAL only, same
   * reason as 2054/2055 above.
   */
  async traceTableau2056(
    company: CompanyContext,
    dto: Tableau2056TraceQueryDto,
  ): Promise<Tableau2056TraceResult> {
    const ctx = await this.fetchLedgerContext(company, dto);
    this.assertReelNormalOnly(ctx.companyRecord.regime, '2056');
    const lignes: ProvisionMovementLigneWithAccount[] = ctx.lignes
      .filter((ligne) =>
        PROVISION_ACCOUNT_CLASS_PREFIXES.some((prefix) => ligne.compte.number.startsWith(prefix)),
      )
      .map((ligne) => ({
        accountNumber: ligne.compte.number,
        isOpeningBalance: ligne.ecriture.journal.type === 'A_NOUVEAU',
        debit: Money.fromDecimal(ligne.debit),
        credit: Money.fromDecimal(ligne.credit),
        accountId: ligne.compte.id,
        accountLabel: ligne.compte.label,
      }));
    return traceTableau2056Column(lignes, ctx.fiscalYear.id, dto.categoryCode, dto.column);
  }

  /**
   * Traceability drill-down, Tier 3 — 2059-A (plus/moins-values). See
   * CLAUDE.md "Traceability drill-down" and `tableau-2059-trace.ts`'s
   * own doc comment. REEL_NORMAL only, same reason as the annexe
   * traces above. Keyed by `assetId`, not category+column, since a
   * 2059-A row is already asset-level.
   */
  async traceTableau2059(
    company: CompanyContext,
    dto: Tableau2059TraceQueryDto,
  ): Promise<LiasseTableau2059TraceResult> {
    const ctx = await this.fetchLedgerContext(company, dto);
    this.assertReelNormalOnly(ctx.companyRecord.regime, '2059-A');
    const assets = await this.fetchImmobilisations(company, ctx.fiscalYear);
    const asset = assets.find(
      (a) =>
        a.id === dto.assetId &&
        a.cessionDate &&
        a.cessionDate >= ctx.fiscalYear.startDate &&
        a.cessionDate <= ctx.fiscalYear.endDate,
    );
    if (!asset) {
      throw new NotFoundException(
        `No disposed asset "${dto.assetId}" found within this fiscal year — 2059-A only covers ` +
          'disposals dated within the reported year.',
      );
    }

    const summary = computeFixedAssetSummary(asset, asset.depreciationEntries);
    const trace = traceTableau2059Column(
      asset.id,
      asset.account.number,
      asset.depreciationAccount.number,
      summary.valeurBrute,
      summary.amortissementsCumules,
      Money.fromDecimal(asset.cessionPrice!),
      dto.column,
    );

    const accountRow = await this.prisma.account.findFirst({
      where: { companyId: company.companyId, number: trace.accountNumber },
    });
    if (!accountRow) {
      throw new NotFoundException(
        `Account "${trace.accountNumber}" was traced to 2059-A ${trace.column} but no longer ` +
          'exists on this company.',
      );
    }

    return {
      assetId: trace.assetId,
      assetLabel: asset.label,
      column: trace.column,
      columnValue: trace.columnValue,
      fiscalYearId: ctx.fiscalYear.id,
      accountId: accountRow.id,
      accountNumber: accountRow.number,
      accountLabel: accountRow.label,
    };
  }

  /**
   * 2054/2055/2056 have no régime réel simplifié equivalent — see
   * CLAUDE.md "Liasse fiscale — régime réel simplifié (2033-series)".
   * `fetchLedgerContext()` already refuses any regime OTHER than
   * REEL_NORMAL/REEL_SIMPLIFIE; this refuses REEL_SIMPLIFIE
   * specifically for these three trace endpoints, the same "throw
   * rather than guess" a REEL_SIMPLIFIE company's own `generate()` call
   * already applies by simply never computing these tableaux for it.
   */
  private assertReelNormalOnly(regime: string, tableauName: string): void {
    if (regime !== 'REEL_NORMAL') {
      throw new NotImplementedException(
        `${tableauName} has no régime réel simplifié equivalent — this trace is only available for a ` +
          'REEL_NORMAL company.',
      );
    }
  }

  /**
   * Resolves each traced account NUMBER back to its real id/label —
   * `TrialBalanceAccount` (what `traceLine()` works from) only ever
   * carries the number, never the id, so this is the one place the
   * drill-down touches Prisma at all. Handed straight to
   * `AccountLedgerDrilldown` on the frontend, unchanged — see CLAUDE.md.
   */
  private async withAccountIds(
    company: CompanyContext,
    fiscalYearId: string,
    traced: LineTraceResult,
  ): Promise<LiasseLineTraceResult> {
    const numbers = traced.accounts.map((a) => a.accountNumber);
    const accountRows = await this.prisma.account.findMany({
      where: { companyId: company.companyId, number: { in: numbers } },
    });
    const byNumber = new Map(accountRows.map((a) => [a.number, a]));
    return {
      lineCode: traced.lineCode,
      lineLabel: traced.lineLabel,
      lineValue: traced.lineValue,
      fiscalYearId,
      accounts: traced.accounts.map((a) => {
        const row = byNumber.get(a.accountNumber);
        if (!row) {
          throw new NotFoundException(
            `Account "${a.accountNumber}" was traced to line ${traced.lineCode} but no longer exists on this company.`,
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
   * Shared prefetch for both `generate()` and `generateSecondary()`:
   * validates the company/fiscal year exist and the regime is a known
   * one, refuses while any draft écriture exists in the fiscal year,
   * and builds the trial balance split by bilan (classes 1–5) vs.
   * compte de résultat (classes 6–7) — same "throw rather than guess"
   * discipline either caller then builds on.
   */
  private async fetchLedgerContext(company: CompanyContext, dto: ComputeLiasseDto) {
    const companyRecord = await this.prisma.company.findFirst({ where: { id: company.companyId } });
    if (!companyRecord) {
      throw new NotFoundException(`Company ${company.companyId} not found`);
    }
    if (companyRecord.regime !== 'REEL_NORMAL' && companyRecord.regime !== 'REEL_SIMPLIFIE') {
      throw new NotImplementedException(
        `Liasse fiscale for regime "${String(companyRecord.regime)}" is not implemented yet — only ` +
          'REEL_NORMAL (2050-series) and REEL_SIMPLIFIE (2033-A/2033-B) are built so far.',
      );
    }

    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: dto.fiscalYearId, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${dto.fiscalYearId} not found`);
    }

    const draftCount = await this.prisma.ecriture.count({
      where: { companyId: company.companyId, fiscalYearId: fiscalYear.id, validatedAt: null },
    });
    if (draftCount > 0) {
      throw new ConflictException(
        `Cannot generate the liasse: ${draftCount} écriture(s) in this fiscal year are still ` +
          'unvalidated (draft). Validate them first.',
      );
    }

    const lignes = await this.prisma.ecritureLigne.findMany({
      where: {
        companyId: company.companyId,
        ecriture: { fiscalYearId: fiscalYear.id, validatedAt: { not: null } },
      },
      include: { compte: true, ecriture: { include: { journal: true } } },
    });
    const mappedLignes: LiasseLigne[] = lignes.map((ligne) => ({
      compteNumber: ligne.compte.number,
      pcgClass: ligne.compte.pcgClass,
      debit: ligne.debit,
      credit: ligne.credit,
    }));
    const trialBalance = buildTrialBalance(mappedLignes);

    const bilanAccounts = trialBalance.filter((a) => a.pcgClass >= 1 && a.pcgClass <= 5);
    const compteResultatAccounts = trialBalance.filter((a) => a.pcgClass === 6 || a.pcgClass === 7);
    // Class 8 accounts, if any, are neither bilan nor compte de résultat — silently excluded, not
    // silently mismapped (see module doc comment).

    return { companyRecord, fiscalYear, lignes, bilanAccounts, compteResultatAccounts };
  }

  /** Pure, cheap — bilan simplifié (2033-A) + compte de résultat simplifié (2033-B). */
  private computeReelSimplifie(
    bilanAccounts: ReturnType<typeof buildTrialBalance>,
    compteResultatAccounts: ReturnType<typeof buildTrialBalance>,
  ): LiasseSimplifieResult {
    const compteResultat = computeCompteResultat2033B(compteResultatAccounts);
    const bilan = computeBilan2033A(
      bilanAccounts,
      Money.fromString(compteResultat.beneficeOuPerte),
    );
    assertBilan2033ABalances(bilan);
    return { regime: 'REEL_SIMPLIFIE', bilan, compteResultat };
  }

  /** The full régime réel normal pipeline — bilan, compte de résultat, and every 2054–2059 annexe. */
  private async computeReelNormal(
    company: CompanyContext,
    ctx: Awaited<ReturnType<LiasseService['fetchLedgerContext']>>,
  ): Promise<LiasseResult> {
    const { fiscalYear, lignes, bilanAccounts, compteResultatAccounts } = ctx;

    const compteResultat = computeCompteResultat2052_2053(compteResultatAccounts);
    const bilan = computeBilan2050(bilanAccounts, Money.fromString(compteResultat.beneficeOuPerte));

    // One fetch, shared by the VNC check, 2054/2055, and 2059-A — scoped to "acquired in or before
    // the reported fiscal year, AND not disposed before it" (see fetchImmobilisations' own doc
    // comment for why both halves of that scoping are load-bearing, not incidental).
    const assets = await this.fetchImmobilisations(company, fiscalYear);
    const assetsDisposedThisYear = assets.filter(
      (asset) =>
        asset.cessionDate &&
        asset.cessionDate >= fiscalYear.startDate &&
        asset.cessionDate <= fiscalYear.endDate,
    );

    const vncByLine = this.buildVncByLine(assets, assetsDisposedThisYear);
    assertLiasseArticulation({ bilan, vncByLine });

    const tableau2054Assets: ImmobilisationMovementAsset[] = assets.map((asset) => ({
      accountNumber: asset.account.number,
      acquisitionDate: asset.acquisitionDate,
      acquisitionValue: Money.fromDecimal(asset.acquisitionValue),
      cessionDate: asset.cessionDate,
    }));
    const tableau2054 = computeTableau2054(tableau2054Assets, fiscalYear);

    const tableau2055Entries: ImmobilisationDepreciationMovement[] = assets.flatMap((asset) =>
      asset.depreciationEntries.map((entry) => ({
        accountNumber: asset.account.number,
        fiscalYearId: entry.fiscalYearId,
        fiscalYearEndDate: entry.fiscalYear.endDate,
        amount: Money.fromDecimal(entry.amount),
      })),
    );
    const tableau2055Disposals: ImmobilisationDisposal[] = assetsDisposedThisYear.map((asset) => ({
      accountNumber: asset.account.number,
      amortissementsCumules: computeFixedAssetSummary(asset, asset.depreciationEntries)
        .amortissementsCumules,
    }));
    const tableau2055 = computeTableau2055(
      tableau2055Entries,
      { id: fiscalYear.id, endDate: fiscalYear.endDate },
      tableau2055Disposals,
    );

    assertTableauxTieToBilan({ bilan, tableau2054, tableau2055 });

    const provisionLignes: ProvisionMovementLigne[] = lignes
      .filter((ligne) =>
        PROVISION_ACCOUNT_CLASS_PREFIXES.some((prefix) => ligne.compte.number.startsWith(prefix)),
      )
      .map((ligne) => ({
        accountNumber: ligne.compte.number,
        isOpeningBalance: ligne.ecriture.journal.type === 'A_NOUVEAU',
        debit: Money.fromDecimal(ligne.debit),
        credit: Money.fromDecimal(ligne.credit),
      }));
    const tableau2056 = computeTableau2056(provisionLignes);
    assertTableau2056TiesToBilan({ trialBalance: bilanAccounts, tableau2056 });

    const tableau2057RawLignes: Tableau2057RawLigne[] = lignes.map((ligne) => ({
      compteNumber: ligne.compte.number,
      pcgClass: ligne.compte.pcgClass,
      debit: ligne.debit,
      credit: ligne.credit,
      dateEcheance: ligne.dateEcheance,
    }));
    const tableau2057 = computeTableau2057(bilan, tableau2057RawLignes, fiscalYear.endDate);
    assertTableau2057TiesToBilan({ bilan, tableau2057 });

    const tableau2059Assets: Tableau2059AAsset[] = assetsDisposedThisYear.map((asset) => {
      const summary = computeFixedAssetSummary(asset, asset.depreciationEntries);
      return {
        assetId: asset.id,
        accountNumber: asset.account.number,
        cessionDate: asset.cessionDate!,
        cessionPrice: Money.fromDecimal(asset.cessionPrice!),
        valeurBrute: summary.valeurBrute,
        amortissementsCumules: summary.amortissementsCumules,
      };
    });
    const tableau2059 = computeTableau2059A(tableau2059Assets, fiscalYear);
    assertTableau2059TiesToCompteResultat({ compteResultat, tableau2059 });

    return {
      regime: 'REEL_NORMAL',
      bilan,
      compteResultat,
      tableau2054,
      tableau2055,
      tableau2056,
      tableau2057,
      tableau2059,
    };
  }

  /**
   * Every FixedAsset acquired in or before the reported fiscal year AND
   * not disposed before it, with its posted depreciation entries from
   * that same fiscal year or earlier — the shared "as of this year"
   * dataset the VNC check, 2054/2055, and 2059-A all need.
   *
   * Both halves of the WHERE are load-bearing, fixed as real bugs, not
   * incidental: filtering only depreciationEntries and not the assets
   * themselves by acquisitionDate was the original bug (see git
   * history) — a company that later acquired more assets would get a
   * wrong VNC when reporting a past year. The cessionDate half is the
   * disposal-side analog, found while building cession support: without
   * it, an asset disposed in a PRIOR fiscal year would still contribute
   * its full valeurBrute/amortissementsCumules to every LATER year's
   * bilan forever (computeFixedAssetSummary's valeurBrute is always
   * FixedAsset.acquisitionValue, independent of disposal — see that
   * function's own doc comment), even though the asset is genuinely
   * gone and the ledger's own 21x/28x balances for it are already zero.
   * An asset disposed WITHIN the reported year is still included (its
   * 2054/2055/2059-A movement needs to show for that year); only a
   * disposal strictly BEFORE the reported year's start excludes it.
   */
  private async fetchImmobilisations(
    company: CompanyContext,
    fiscalYear: { startDate: Date; endDate: Date },
  ) {
    return this.prisma.fixedAsset.findMany({
      where: {
        companyId: company.companyId,
        acquisitionDate: { lte: fiscalYear.endDate },
        OR: [{ cessionDate: null }, { cessionDate: { gte: fiscalYear.startDate } }],
      },
      include: {
        account: true,
        // depreciationAccount is a real, previously-unused-here field on FixedAsset — added for the
        // traceability drill-down's 2055 trace (Tier 2), which must expand a dotation/diminution
        // contribution into ITS OWN écritures, and those post to the 28x contra-account, never the
        // asset's own 21x/20x gross account (`account` above). Reusing the asset's OWN stored
        // reference here (never guessing a 28x number from the gross account's own prefix, e.g. via
        // string surgery) is exactly the "never guess" discipline this app holds elsewhere. Purely
        // additive — no existing caller of fetchImmobilisations() reads this field, so nothing
        // downstream changes behavior.
        depreciationAccount: true,
        depreciationEntries: {
          where: {
            postedEcritureId: { not: null },
            fiscalYear: { endDate: { lte: fiscalYear.endDate } },
          },
          include: { fiscalYear: true },
        },
      },
    });
  }

  /**
   * Groups the already-fetched assets by the Actif line their account
   * rolls up to, summing valeurBrute/amortissementsCumules per line
   * using the same formula as the immobilisations module itself
   * (fixed-asset-invariants.ts) — never re-derived.
   *
   * `disposedThisYear` assets are excluded from this tie-out entirely —
   * found live while adding cession support: computeFixedAssetSummary's
   * valeurBrute is always FixedAsset.acquisitionValue "independent of
   * residualValue or postings" (see that function's own doc comment),
   * so it keeps reporting a disposed asset's full historical gross
   * value forever, while the LEDGER (which this tie-out compares
   * against) correctly nets that same account to zero once the
   * disposal écriture's débit 28x/crédit 21x lines land. Comparing
   * those two for a disposed asset would always mismatch — not a bug
   * to paper over, a sign the two figures mean different things once
   * disposal exists. The bilan's own Actif=Passif check (a genuinely
   * separate, still-live tie-out) is what actually verifies the
   * disposal posted correctly.
   */
  private buildVncByLine(
    assets: Awaited<ReturnType<LiasseService['fetchImmobilisations']>>,
    disposedThisYear: Awaited<ReturnType<LiasseService['fetchImmobilisations']>>,
  ): VncCheckLine[] {
    const disposedIds = new Set(disposedThisYear.map((a) => a.id));
    const byLine = new Map<string, { valeurBrute: Money; amortissementsCumules: Money }>();
    for (const asset of assets) {
      if (disposedIds.has(asset.id)) {
        continue;
      }
      const summary = computeFixedAssetSummary(asset, asset.depreciationEntries);
      const lineCode = resolveImmobilisationLineCode(asset.account.number);
      const existing = byLine.get(lineCode) ?? {
        valeurBrute: Money.zero(),
        amortissementsCumules: Money.zero(),
      };
      byLine.set(lineCode, {
        valeurBrute: existing.valeurBrute.plus(summary.valeurBrute),
        amortissementsCumules: existing.amortissementsCumules.plus(summary.amortissementsCumules),
      });
    }

    return Array.from(byLine.entries()).map(([code, totals]) => ({ code, ...totals }));
  }
}
