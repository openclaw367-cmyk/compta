/**
 * Hand-authored response types mirroring the JSON the API actually sends.
 *
 * These are deliberately NOT imported from the backend's Prisma-generated
 * types: Prisma types money fields as `Prisma.Decimal`, but the wire
 * format (confirmed live: `"debit":"10.00"`) is a string — Decimal.js's
 * toJSON() serializes it that way. Reusing the Prisma type here would
 * claim `debit: Decimal` for a field that is actually `string` on the
 * wire, which is worse than no shared type at all. See request DTOs
 * (imported directly from the backend as `import type`) for the case
 * where sharing is safe: those are already string-typed by design.
 */

export interface Journal {
  id: string;
  companyId: string;
  code: string;
  label: string;
  type: 'ACHATS' | 'VENTES' | 'BANQUE' | 'CAISSE' | 'OPERATIONS_DIVERSES' | 'A_NOUVEAU';
}

export interface Account {
  id: string;
  companyId: string;
  number: string;
  label: string;
  pcgClass: number;
  isAuxiliary: boolean;
  parentId: string | null;
}

export interface FiscalYear {
  id: string;
  companyId: string;
  label: string;
  startDate: string;
  endDate: string;
  closedAt: string | null;
}

export interface EcritureLigne {
  id: string;
  companyId: string;
  ecritureId: string;
  compteId: string;
  compteAuxId: string | null;
  /** Money string, e.g. "1234.56". Never parse into a number — see lib/money.ts. */
  debit: string;
  /** Money string, e.g. "1234.56". Never parse into a number — see lib/money.ts. */
  credit: string;
  lettrage: string | null;
  dateLettrage: string | null;
  montantDevise: string | null;
  idDevise: string | null;
}

export interface Ecriture {
  id: string;
  companyId: string;
  fiscalYearId: string;
  journalId: string;
  ecritureNum: string | null;
  ecritureDate: string;
  pieceRef: string | null;
  pieceDate: string | null;
  libelle: string;
  validatedAt: string | null;
  reversesId: string | null;
  importBatchId: string | null;
  createdAt: string;
  updatedAt: string;
  lignes: EcritureLigne[];
}

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  /** NestJS's ValidationPipe sends an array (one message per failed rule); domain errors send a single string. */
  message: string | string[];
}

export interface LedgerTotals {
  debit: string;
  credit: string;
  balance: string;
}

export interface TrialBalanceLine {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  totalDebit: string;
  totalCredit: string;
  balance: string;
}

export interface TrialBalanceResponse {
  fiscalYearId: string;
  periodStart?: string;
  periodEnd?: string;
  lines: TrialBalanceLine[];
  totals: LedgerTotals;
}

export interface AccountLedgerLine {
  ecritureId: string;
  ecritureNum: string | null;
  journalCode: string;
  ecritureDate: string;
  pieceRef?: string | null;
  libelle: string;
  debit: string;
  credit: string;
  lettrage?: string | null;
  runningBalance: string;
}

export interface AccountLedgerResponse {
  accountId: string;
  accountNumber: string;
  accountLabel: string;
  fiscalYearId: string;
  periodStart?: string;
  periodEnd?: string;
  lines: AccountLedgerLine[];
  totals: LedgerTotals;
}
