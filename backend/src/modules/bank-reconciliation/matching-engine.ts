import { Money } from '../../common/decimal/money';

/**
 * A statement line's own confidence tier — see CLAUDE.md "Bank
 * reconciliation". HIGH means exactly one amount-and-direction-eligible
 * candidate exists within the date window: a one-click confirm.
 * AMBIGUOUS means 2+ eligible candidates, ranked (closest date first,
 * label similarity as the tiebreaker) for the human to pick from.
 * NO_CANDIDATE means nothing matched — the review UI offers "create an
 * écriture" instead.
 */
export type MatchConfidence = 'HIGH' | 'AMBIGUOUS' | 'NO_CANDIDATE';

/** The candidate écriture lines the matching engine chooses among — a thin, Prisma-independent shape. */
export interface CandidateLigne {
  id: string;
  ecritureId: string;
  ecritureNum: string | null;
  ecritureDate: Date;
  libelle: string;
  /** API-string money — whichever of debit/credit is non-zero on this line. */
  debit: string;
  credit: string;
}

/** The unmatched statement lines being matched against — a thin, Prisma-independent shape. */
export interface MatchableStatementLine {
  id: string;
  bookingDate: Date;
  /** Signed API-string — positive = inflow (matches a debit ligne on the bank account), negative = outflow (matches a credit ligne). */
  amount: string;
  label: string;
}

export interface MatchCandidate {
  ecritureLigneId: string;
  ecritureId: string;
  ecritureNum: string | null;
  ecritureDate: string;
  libelle: string;
  amount: string;
  dateDistanceDays: number;
  /** 0..1, token-overlap between the statement line's label and this candidate's libelle — a tiebreaker only, never the primary signal. */
  labelSimilarity: number;
}

export interface StatementLineMatchProposal {
  statementLineId: string;
  confidence: MatchConfidence;
  /** Empty for NO_CANDIDATE; exactly one for HIGH; 2+ for AMBIGUOUS, ranked best-first. */
  candidates: MatchCandidate[];
}

/**
 * How many days apart a statement's bookingDate and a candidate ligne's
 * own ecritureDate may be and still be considered eligible at all — a
 * first-cut value covering the common case (a bank's value date lands
 * up to roughly two weeks after the ledger's own posting date), NOT a
 * precision-tuned threshold. Per the design pass: matching heuristics
 * are the one place in this feature where "confidently wrong" is a
 * real risk, and this constant (along with the amount-exact-only
 * decision below) is the first thing to revisit against real
 * reconciliation data once this ships, not something to treat as
 * settled.
 */
export const DATE_WINDOW_DAYS = 15;

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs(a.getTime() - b.getTime()) / msPerDay);
}

/** Lowercase, strip accents/punctuation, collapse whitespace — for token-overlap comparison only, never for display. */
function normalize(label: string): string[] {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

/** Jaccard similarity over normalized word sets — simple, hand-traceable, good enough as a tiebreaker only. */
function labelSimilarity(a: string, b: string): number {
  const setA = new Set(normalize(a));
  const setB = new Set(normalize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * A statement line is eligible against a candidate ligne only if the
 * ligne's non-zero side (debit for an inflow, credit for an outflow —
 * money coming INTO the bank account debits it, same convention as
 * every other account) exactly equals the statement's own absolute
 * amount. Amount matching is exact-only in this pass, deliberately not
 * given a rounding tolerance — see this file's own module doc comment.
 */
function isEligible(statementAmount: Money, ligne: CandidateLigne): boolean {
  const target = statementAmount.isPositive() ? ligne.debit : ligne.credit;
  if (Money.fromString(target).isZero()) return false;
  return Money.fromString(target).equals(
    statementAmount.isPositive() ? statementAmount : Money.zero().minus(statementAmount),
  );
}

function toCandidate(
  ligne: CandidateLigne,
  statementLine: MatchableStatementLine,
  statementAmount: Money,
): MatchCandidate {
  const amount = statementAmount.isPositive() ? ligne.debit : ligne.credit;
  return {
    ecritureLigneId: ligne.id,
    ecritureId: ligne.ecritureId,
    ecritureNum: ligne.ecritureNum,
    ecritureDate: ligne.ecritureDate.toISOString().slice(0, 10),
    libelle: ligne.libelle,
    amount,
    dateDistanceDays: daysBetween(statementLine.bookingDate, ligne.ecritureDate),
    labelSimilarity: labelSimilarity(statementLine.label, ligne.libelle),
  };
}

/**
 * Pure, stateless — deliberately never persisted (mirrors
 * propose_ecriture's own "never persists" discipline). Given one
 * unmatched statement line and the pool of unlettered candidate lignes
 * for its bank account, returns a ranked proposal. The caller
 * (BankReconciliationService) is responsible for pre-filtering the
 * candidate pool to the right compte/company/unlettered-only/date-window
 * scope before calling this — this function only ranks what it's given.
 */
export function matchStatementLine(
  statementLine: MatchableStatementLine,
  candidates: CandidateLigne[],
): StatementLineMatchProposal {
  const statementAmount = Money.fromString(statementLine.amount);
  const eligible = candidates
    .filter(
      (ligne) =>
        daysBetween(statementLine.bookingDate, ligne.ecritureDate) <= DATE_WINDOW_DAYS &&
        isEligible(statementAmount, ligne),
    )
    .map((ligne) => toCandidate(ligne, statementLine, statementAmount))
    .sort(
      (a, b) => a.dateDistanceDays - b.dateDistanceDays || b.labelSimilarity - a.labelSimilarity,
    );

  return {
    statementLineId: statementLine.id,
    confidence:
      eligible.length === 0 ? 'NO_CANDIDATE' : eligible.length === 1 ? 'HIGH' : 'AMBIGUOUS',
    candidates: eligible,
  };
}

export function matchStatementLines(
  statementLines: MatchableStatementLine[],
  candidates: CandidateLigne[],
): StatementLineMatchProposal[] {
  return statementLines.map((line) => matchStatementLine(line, candidates));
}
