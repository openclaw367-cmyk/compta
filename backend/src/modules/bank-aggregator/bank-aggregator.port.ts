import { CompanyContext } from '../../common/tenant/company-context';
import { ParsedStatement } from '../bank-reconciliation/camt053-parser.service';

/**
 * The abstraction Layer 1b talks to — nothing outside this file (and its
 * concrete adapters) may know a specific bank-aggregator provider exists.
 * Mirrors ChatModelPort's own role (see
 * `ai-chat/chat-model/chat-model.port.ts`) exactly: ONE interface, with
 * `BridgeAggregatorAdapter` as the only implementation this pass ships.
 * Adding a second provider (e.g. Powens) means a new adapter class plus
 * one case in `bank-aggregator-registry.ts`'s factory — orchestration
 * code (`BankAggregatorLinkService`) never changes regardless of which
 * side of this port answers.
 *
 * `fetchTransactions()` deliberately returns the SAME `ParsedStatement`
 * shape `camt053-parser.service.ts` already exports — this is the seam
 * that makes "a live sync feeds the exact same pipeline a CAMT.053
 * upload does" literally true (both land, via
 * `BankStatementImportService.persistParsedStatement()`, in the same
 * `BankStatementLine` rows the matching engine and review UI already
 * work against), not just an aspiration.
 *
 * See CLAUDE.md "Bank reconciliation — Layer 1b" for the full design,
 * including the honest pre-ship gap: this port's only implementation is
 * a paper design against Bridge's public docs, not yet verified against
 * a real Bridge sandbox.
 */
export interface BankAggregatorPort {
  /**
   * Starts a new bank-login handshake for this company and returns the
   * provider's own hosted URL to send the user's browser to. No token
   * exists yet — that only happens once the user actually completes the
   * flow and `confirmLink()` is called with whatever the provider hands
   * back.
   */
  createConnectSession(company: CompanyContext): Promise<{ connectUrl: string }>;

  /**
   * Exchanges the result of a completed Connect flow for a real,
   * usable access token. `callbackPayload` is deliberately untyped here
   * — its real shape (redirect query params vs. a postMessage payload)
   * is a build-time verify-against-real-docs item, not guessed by this
   * port.
   */
  confirmLink(
    company: CompanyContext,
    callbackPayload: unknown,
  ): Promise<{ externalItemId: string; accessToken: string; label: string }>;

  /**
   * Pull transactions for one already-linked item, optionally only
   * those since a prior sync. User-triggered only in v1 (no scheduler,
   * no webhook subscription) — see CLAUDE.md "Bank reconciliation —
   * Layer 1b" for why.
   */
  fetchTransactions(
    accessToken: string,
    externalItemId: string,
    since?: Date,
  ): Promise<ParsedStatement>;

  /**
   * Tells the provider to end this connection. MUST be called, and MUST
   * succeed, before a `BankAggregatorLink` row is deleted locally —
   * revoking only our own local record while the provider still holds a
   * live connection would be a real privacy gap, not just incomplete
   * cleanup. See `BankAggregatorLinkService.revoke()`.
   */
  revoke(accessToken: string, externalItemId: string): Promise<void>;
}

export const BANK_AGGREGATOR_PORT = Symbol('BANK_AGGREGATOR_PORT');
