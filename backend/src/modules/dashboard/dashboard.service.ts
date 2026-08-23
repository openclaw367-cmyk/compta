import { Injectable } from '@nestjs/common';
import { Regime } from '@prisma/client';
import { CompanyContext } from '../../common/tenant/company-context';
import { CompaniesService } from '../companies/companies.service';
import { FiscalYearsService } from '../fiscal-years/fiscal-years.service';
import { LiasseService } from '../liasse/liasse.service';
import { BilanActifLigne, BilanPassifLigne } from '../liasse/bilan-2050';
import { FinancialAnalysisService } from '../financial-analysis/financial-analysis.service';
import { LedgerService, RecentEntryLine } from '../ledger/ledger.service';

/** How many fiscal years (including the current one) the CA-over-time chart shows at most. */
const CA_HISTORY_MAX_YEARS = 6;

export interface DashboardCaHistoryPoint {
  fiscalYearId: string;
  label: string;
  chiffreDAffaires: string;
}

export interface DashboardAssocieBalance {
  accountId: string;
  accountNumber: string;
  /** The account's own label — the associé's name for a real tiers sub-account, or the flat 455000 collectif's own label when some lines were never attributed to a specific associé. */
  accountLabel: string;
  /** debit - credit, a money string. Positive = the associé owes the company; negative = the company owes the associé (the ordinary "avance en compte courant" case). */
  balance: string;
  /** True only for the flat 455000 collectif row itself, never a real tiers sub-account — lets the frontend flag it as "non ventilé" rather than implying it's someone's name. */
  isUnattributed: boolean;
}

export type DashboardRecentEntry = RecentEntryLine;

export interface DashboardSummaryAvailable {
  available: true;
  fiscalYear: { id: string; label: string };
  /** Class-5 balance (bilan CF, "Disponibilités") — trésorerie right now. */
  tresorerie: string;
  /** margins.chiffreDAffaires for the current fiscal year. */
  chiffreAffaires: string;
  /** bilan DX, "Dettes fournisseurs et comptes rattachés". */
  dettesFournisseurs: string;
  /** 2057 Cadre A's own BX row — montantBrut (gross), not the bilan's net figure, per this tile's own design intent (encours, not a dépréciation-netted figure). */
  encoursClient: string;
  /** compte de résultat totalProduits (every produit, not exploitation-only). */
  revenus: string;
  /** compte de résultat totalCharges (every charge, not exploitation-only). */
  depenses: string;
  /** SIG cascade's own resultatNet (= compte de résultat's beneficeOuPerte) — reused directly rather than the dashboard re-deriving revenus − dépenses itself. */
  resultatNet: string;
  /** SIG cascade's EBE — the app's differentiator figure (see CLAUDE.md "Analyse financière"). */
  ebe: string;
  /** EBE as a % of CA — null when CA is exactly 0 (see Margins.margeEbe's own guard). */
  margeEbe: string | null;
  /** Oldest → newest, capped at CA_HISTORY_MAX_YEARS, honestly missing any year that failed to compute (never a faked/zeroed point). */
  caHistory: DashboardCaHistoryPoint[];
  comptesCourantsAssocies: DashboardAssocieBalance[];
  recentBankEntries: DashboardRecentEntry[];
}

export interface DashboardSummaryUnavailable {
  available: false;
  reason: string;
}

export type DashboardSummary = DashboardSummaryAvailable | DashboardSummaryUnavailable;

/**
 * The dashboard's ONLY job: fetch already-verified figures from existing,
 * independently-tested services and arrange them — see CLAUDE.md
 * "Dashboard". No new business logic, no new money arithmetic. The two
 * exceptions, both purely presentational (same "thin dispatch" line the
 * AI chatbot's read tools already draw — see read-tools.service.ts):
 * finding a named line by its own `code` in an already-computed
 * Bilan2050/Tableau2057 (`.find()`, nothing computed), and filtering an
 * already-computed trial balance by account-number prefix for the
 * comptes-courants-d'associés tile.
 *
 * Deliberately returns `{ available: false, reason }` instead of letting
 * a guard exception (drafts present, no fiscal year, régime réel
 * simplifié) propagate as a raw error response — this is the FIRST
 * screen the app shows on every load, so it must degrade to one honest
 * banner rather than a broken landing page. Every reason string is the
 * real message from the underlying service's own guard, never
 * paraphrased.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly companies: CompaniesService,
    private readonly fiscalYears: FiscalYearsService,
    private readonly liasse: LiasseService,
    private readonly financialAnalysis: FinancialAnalysisService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * `requestedFiscalYearId` lets the caller pin a specific fiscal year
   * (the app-wide fiscal-year selector — see CLAUDE.md "Navigation") —
   * purely which year gets passed to the SAME `generate()` calls below,
   * never a new computation. Falls back to the existing "open, else most
   * recent" heuristic when omitted, or when the requested id doesn't
   * belong to this company (a stale selection from a just-switched
   * company, not an error worth surfacing).
   */
  async getSummary(
    company: CompanyContext,
    requestedFiscalYearId?: string,
  ): Promise<DashboardSummary> {
    const companyRecord = await this.companies.findCurrent(company);
    if (companyRecord.regime !== Regime.REEL_NORMAL) {
      return {
        available: false,
        reason:
          'Le tableau de bord est disponible uniquement pour le régime réel normal — ' +
          'ce dossier est en régime réel simplifié. Consultez la Liasse fiscale pour ses ' +
          'propres bilan et compte de résultat simplifiés.',
      };
    }

    const years = await this.fiscalYears.findAll(company);
    if (years.length === 0) {
      return { available: false, reason: 'Aucun exercice créé pour ce dossier.' };
    }
    // findAll() orders startDate desc — years[0] is the most recent.
    const requested = requestedFiscalYearId
      ? years.find((y) => y.id === requestedFiscalYearId)
      : undefined;
    const current = requested ?? years.find((y) => y.closedAt === null) ?? years[0];

    let liasseResult: Awaited<ReturnType<LiasseService['generate']>>;
    let analysis: Awaited<ReturnType<FinancialAnalysisService['generate']>>;
    try {
      liasseResult = await this.liasse.generate(company, { fiscalYearId: current.id });
      analysis = await this.financialAnalysis.generate(company, { fiscalYearId: current.id });
    } catch (err) {
      return { available: false, reason: describeError(err) };
    }
    if (liasseResult.regime !== 'REEL_NORMAL') {
      // Unreachable given the companyRecord.regime check above (regime is
      // a company-level field, not per-fiscal-year) — defensive only.
      return { available: false, reason: 'Régime inattendu pour ce dossier.' };
    }

    const cf = findActifLine(liasseResult.bilan.actif, 'CF');
    const dx = findPassifLine(liasseResult.bilan.passif, 'DX');
    const bx2057 = liasseResult.tableau2057.cadreA.find((l) => l.code === 'BX');
    if (!bx2057) {
      return {
        available: false,
        reason: 'La ligne BX (créances clients) est absente du tableau 2057 pour cet exercice.',
      };
    }

    const historyYears = [...years]
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
      .filter((y) => y.startDate.getTime() <= current.startDate.getTime())
      .slice(-CA_HISTORY_MAX_YEARS);
    const caHistory: DashboardCaHistoryPoint[] = [];
    for (const year of historyYears) {
      if (year.id === current.id) {
        caHistory.push({
          fiscalYearId: year.id,
          label: year.label,
          chiffreDAffaires: analysis.margins.chiffreDAffaires,
        });
        continue;
      }
      try {
        const yearAnalysis = await this.financialAnalysis.generate(company, {
          fiscalYearId: year.id,
        });
        caHistory.push({
          fiscalYearId: year.id,
          label: year.label,
          chiffreDAffaires: yearAnalysis.margins.chiffreDAffaires,
        });
      } catch {
        // Honestly omitted, never faked as zero — see this class's own
        // doc comment. A year with drafts, or the company's very first
        // fiscal year (no opening bilan to diff against — see CLAUDE.md
        // "Tableau des flux de trésorerie"), is a real, expected case.
      }
    }

    const trialBalance = await this.ledger.trialBalance(company, { fiscalYearId: current.id });
    const comptesCourantsAssocies: DashboardAssocieBalance[] = trialBalance.lines
      .filter((l) => l.accountNumber.startsWith('455'))
      .map((l) => ({
        accountId: l.accountId,
        accountNumber: l.accountNumber,
        accountLabel: l.accountLabel,
        balance: l.balance,
        isUnattributed: l.accountNumber === '455000',
      }))
      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));

    const recentBankEntries = await this.getRecentBankEntries(company, current.id);

    return {
      available: true,
      fiscalYear: { id: current.id, label: current.label },
      tresorerie: cf.net,
      chiffreAffaires: analysis.margins.chiffreDAffaires,
      dettesFournisseurs: dx.montant,
      encoursClient: bx2057.montantBrut,
      revenus: liasseResult.compteResultat.totalProduits,
      depenses: liasseResult.compteResultat.totalCharges,
      resultatNet: analysis.sig.resultatNet,
      ebe: analysis.sig.ebe,
      margeEbe: analysis.margins.margeEbe,
      caHistory,
      comptesCourantsAssocies,
      recentBankEntries,
    };
  }

  /**
   * Recent transactions on class-5 (trésorerie) accounts — the SAME
   * `EcritureLigne` rows the trial balance/grand livre already read,
   * just filtered to pcgClass 5 and the most recent N by date. Purely
   * presentational filtering/sorting (see this class's own doc comment),
   * not a new report: it reuses `LedgerService.trialBalance()`'s own
   * account-scoping query shape by going one level lower, straight to
   * the fiscal year's lignes, since the trial balance itself only
   * returns per-account TOTALS, not individual lines.
   */
  private async getRecentBankEntries(
    company: CompanyContext,
    fiscalYearId: string,
  ): Promise<DashboardRecentEntry[]> {
    const RECENT_LIMIT = 8;
    return this.ledger.recentEntriesForClass(company, fiscalYearId, 5, RECENT_LIMIT);
  }
}

function findActifLine(actif: BilanActifLigne[], code: string): BilanActifLigne {
  const line = actif.find((l) => l.code === code);
  if (!line) {
    throw new Error(`Bilan actif line "${code}" not found — this should never happen.`);
  }
  return line;
}

function findPassifLine(passif: BilanPassifLigne[], code: string): BilanPassifLigne {
  const line = passif.find((l) => l.code === code);
  if (!line) {
    throw new Error(`Bilan passif line "${code}" not found — this should never happen.`);
  }
  return line;
}

/** Same discipline as the AI chatbot's tool error extraction (chat-tool.ts) — surface the real guard message (draft count, etc.), never a generic "something went wrong". */
function describeError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
