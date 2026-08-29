import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import {
  DualNatureRule,
  LineRule,
  classifyAccounts,
  resolveLineContribution,
} from './liasse-line-rules';
import { TrialBalanceAccount } from './trial-balance-engine';

/**
 * The reverse-mapping engine behind the traceability drill-down — see
 * CLAUDE.md "Traceability drill-down" and
 * specs/liasse-drilldown-traceability-implementation-spec.md. Tier 1
 * only (bilan/CDR family, régime normal AND régime simplifié — same
 * engine, different rule tables): a line's contributing accounts are
 * found by calling `resolveLineContribution()` (the SAME per-account
 * primitive `resolveLineCode()`/`classifyAccounts()` are built from —
 * see that function's own doc comment) for every account in the trial
 * balance, keeping the ones whose code matches. The line's OWN value is
 * independently computed via `classifyAccounts()` — a genuinely
 * separate call, not the same computation reused as its own check — and
 * `assertLineTraceabilitySums()` asserts the two agree to the centime.
 * If they don't, the reverse mapping is wrong and this throws; it never
 * silently reconciles a discrepancy.
 */

export interface TracedAccount {
  accountNumber: string;
  /** This account's own signed contribution to the line's total (see LineContribution's own doc comment). */
  contribution: string;
}

export interface LineTraceResult {
  lineCode: string;
  lineLabel: string;
  /** The line's own already-computed value, read from the SAME classifyAccounts() call the forward report uses. */
  lineValue: string;
  accounts: TracedAccount[];
}

/**
 * Throws (naming the exact discrepancy) rather than silently
 * reconciling — this IS the oracle: the sum of the contributing
 * accounts' own signed contributions must equal the line's own
 * classifyAccounts()-derived value, to the centime.
 */
export function assertLineTraceabilitySums(
  lineCode: string,
  lineLabel: string,
  officialValue: Money,
  contributions: Money[],
): void {
  const summed = contributions.reduce((sum, c) => sum.plus(c), Money.zero());
  if (!summed.equals(officialValue)) {
    throw new ConflictException(
      `Traçabilité rompue pour la ligne ${lineCode} (${lineLabel}) : le détail des comptes ` +
        `totalise ${summed.toApiString()} mais la ligne affiche ${officialValue.toApiString()} — ` +
        'la correspondance inverse est incorrecte et doit être corrigée avant de pouvoir faire ' +
        'confiance à ce détail.',
    );
  }
}

/**
 * Traces one line back to its contributing accounts. Throws
 * `BadRequestException` (not silently returning an empty list) when
 * `lineCode` doesn't appear in `rules` at all — either a typo, or a
 * genuinely non-drillable derived line (e.g. bilan's own DI, which is
 * constructed from the compte de résultat's HN rather than read from
 * `classifyAccounts()` — see CLAUDE.md "Liasse fiscale / bilan & compte
 * de résultat"). Deferring those honestly, rather than faking a
 * decomposition, is a deliberate scope boundary of Tier 1, not an
 * oversight — see this feature's own spec §1.
 */
export function traceLine(
  lineCode: string,
  accounts: TrialBalanceAccount[],
  rules: LineRule[],
  dualNatureRules: DualNatureRule[] = [],
): LineTraceResult {
  const rule = rules.find((r) => r.code === lineCode);
  if (!rule) {
    throw new BadRequestException(
      `La ligne "${lineCode}" n'est pas traçable — soit ce code n'existe pas, soit il s'agit d'une ` +
        "ligne dérivée (ex. un sous-total, ou le résultat DI) qui n'a pas de contrepartie directe " +
        'dans les comptes du grand livre.',
    );
  }

  const officialValue =
    classifyAccounts(accounts, rules, dualNatureRules).get(lineCode) ?? Money.zero();

  const traced: TracedAccount[] = [];
  const contributions: Money[] = [];
  for (const account of accounts) {
    const result = resolveLineContribution(
      account.accountNumber,
      account.balance,
      rules,
      dualNatureRules,
    );
    if (result.code !== lineCode) continue;
    traced.push({
      accountNumber: account.accountNumber,
      contribution: result.contribution.toApiString(),
    });
    contributions.push(result.contribution);
  }

  assertLineTraceabilitySums(lineCode, rule.label, officialValue, contributions);

  return {
    lineCode,
    lineLabel: rule.label,
    lineValue: officialValue.toApiString(),
    accounts: traced,
  };
}
