import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { TrialBalanceAccount } from '../liasse/trial-balance-engine';
import { CONFIRMABLE_LINE_ACCOUNT_PREFIXES } from './resultat-fiscal';

/**
 * Traceability drill-down, Tier 3 — 2058 WJ/WG (the ledger-suggested,
 * caller-confirmable réintégrations). See CLAUDE.md "Traceability
 * drill-down" and `resultat-fiscal.ts`'s own doc comment on why WJ/WG
 * are suggested, never auto-locked. This trace is for the SUGGESTION
 * only — `ConfirmableLigne.confirmed` may be a manual override with no
 * ledger backing at all (that's the whole point of the confirm step),
 * so there is nothing to trace for an overridden amount; tracing the
 * suggestion is what's honestly traceable.
 *
 * Reuses `CONFIRMABLE_LINE_ACCOUNT_PREFIXES` (the exact same constant
 * `resultat-fiscal.service.ts`'s own `suggestedAmendesEtPenalites`/
 * `suggestedTaxeVehicules` are built from) — never a separately-chosen
 * prefix. Operates on the SAME bare `TrialBalanceAccount` shape (just
 * `accountNumber`/`balance`, no id/label) Tier 1's own `traceLine()`
 * works from — the service layer resolves real account ids/labels in a
 * second pass afterward, same "pure trace, then withAccountIds()"
 * split as `liasse.service.ts`'s own Tier 1 traces.
 */

export type ResultatFiscalTraceCode = keyof typeof CONFIRMABLE_LINE_ACCOUNT_PREFIXES;

const LABELS: Record<ResultatFiscalTraceCode, string> = {
  WJ: 'Amendes et pénalités',
  WG: 'Taxe sur les véhicules des sociétés',
};

export interface ResultatFiscalTraceAccount {
  accountNumber: string;
  contribution: string;
}

export interface ResultatFiscalTraceResult {
  code: ResultatFiscalTraceCode;
  label: string;
  fiscalYearId: string;
  columnValue: string;
  accounts: ResultatFiscalTraceAccount[];
}

export function traceConfirmableLine(
  chargesAccounts: TrialBalanceAccount[],
  fiscalYearId: string,
  code: string,
): ResultatFiscalTraceResult {
  const prefix = (CONFIRMABLE_LINE_ACCOUNT_PREFIXES as Record<string, string | undefined>)[code];
  if (!prefix) {
    throw new BadRequestException(`La ligne 2058 "${code}" n'est pas traçable.`);
  }
  const matching = chargesAccounts.filter((a) => a.accountNumber.startsWith(prefix));
  const accounts: ResultatFiscalTraceAccount[] = matching.map((a) => ({
    accountNumber: a.accountNumber,
    contribution: a.balance.toApiString(),
  }));
  const columnValue = matching.reduce((sum, a) => sum.plus(a.balance), Money.zero()).toApiString();

  return {
    code: code as ResultatFiscalTraceCode,
    label: LABELS[code as ResultatFiscalTraceCode],
    fiscalYearId,
    columnValue,
    accounts,
  };
}

/**
 * The oracle — same non-negotiable discipline as every other trace
 * tier: the détail's own sum must equal a SEPARATE, independently-
 * computed figure (here, the suggestion `ResultatFiscalService.generate()`
 * itself produces via its own `sumAccountBalance()`, re-derived a
 * second time by the service layer), not the same call checked
 * against itself.
 */
export function assertConfirmableLineTraceSums(
  trace: ResultatFiscalTraceResult,
  independentSuggestion: Money,
): void {
  if (!Money.fromString(trace.columnValue).equals(independentSuggestion)) {
    throw new ConflictException(
      `Traçabilité rompue pour 2058 ${trace.code} : détail = ${trace.columnValue}, suggestion ` +
        `officielle = ${independentSuggestion.toApiString()}.`,
    );
  }
}
