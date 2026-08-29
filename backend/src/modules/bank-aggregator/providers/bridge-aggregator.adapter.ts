import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Money } from '../../../common/decimal/money';
import { CompanyContext } from '../../../common/tenant/company-context';
import {
  ParsedStatement,
  ParsedStatementLine,
} from '../../bank-reconciliation/camt053-parser.service';
import { BankAggregatorPort } from '../bank-aggregator.port';

/**
 * ⚠️ PAPER DESIGN — NOT VERIFIED AGAINST THE REAL BRIDGE API.
 *
 * Built from `docs.bridgeapi.io`'s PUBLIC pages only (Bearer auth, a
 * `Bridge-Version` header, an Item→Account→Transaction hierarchy,
 * `item.account.updated` webhooks, a `since`-param incremental fetch).
 * The exact endpoint paths, request/response field names, and the
 * Connect-session/token-exchange flow below are PLACEHOLDERS — every one
 * of them must be re-confirmed against the real, current
 * `docs.bridgeapi.io` (and a real sandbox app) before this talks to a
 * real bank. See CLAUDE.md "Bank reconciliation — Layer 1b" for the
 * verification plan and why no real sandbox could be used to build this.
 *
 * Deliberately NOT DI-bound (no `@Injectable`, no binding in
 * `bank-aggregator.module.ts`) — same reasoning as `ClaudeCloudModelAdapter`:
 * per-company state (the decrypted access token) is passed into each
 * method call, never held as constructor state shared across companies.
 * The one thing this adapter DOES read from shared config is Bridge's
 * APP-LEVEL `client_id`/`client_secret` — this deployment's own
 * registered identity with Bridge, the same for every company, read
 * lazily inside each method (mirroring
 * `CredentialEncryptionService.getKey()`'s lazy-read) so a fresh install
 * with no Bridge intent configured still boots cleanly.
 */
export class BridgeAggregatorAdapter implements BankAggregatorPort {
  private static readonly logger = new Logger(BridgeAggregatorAdapter.name);

  // PLACEHOLDER — confirm against real docs before go-live.
  private static readonly BASE_URL = 'https://api.bridgeapi.io/v3';
  // PLACEHOLDER — Bridge versions its API via this header; confirm the
  // current value (docs.bridgeapi.io showed an example, not necessarily
  // the value to actually pin to) before go-live.
  private static readonly API_VERSION = '2025-01-15';

  constructor(private readonly config: ConfigService) {}

  async createConnectSession(company: CompanyContext): Promise<{ connectUrl: string }> {
    const { clientId, clientSecret } = this.getAppCredentials();
    // PLACEHOLDER body/endpoint — the real flow likely needs an
    // app-side "user" created first, then a Connect session scoped to
    // that user; confirm against real docs before go-live.
    const response = await this.request(
      'POST',
      '/aggregation/connect-sessions',
      clientId,
      clientSecret,
      {
        company_id: company.companyId,
      },
    );
    const body = (await response.json()) as { url?: string };
    if (!body.url) {
      throw new InternalServerErrorException(
        "Bridge n'a pas renvoyé d'URL de connexion (réponse inattendue — vérifier le format réel de l'API).",
      );
    }
    return { connectUrl: body.url };
  }

  // PLACEHOLDER — the real shape of `callbackPayload` (redirect query
  // params vs. a widget postMessage payload) is unconfirmed, and this
  // stands in for what will genuinely be an async server-side
  // token-exchange call once the real flow is confirmed (Bridge's
  // Connect flow likely hands back a short-lived code, not the final
  // access token directly) — kept `async` (with the lint rule below
  // silenced, not the method's real behavior removed) so a synchronous
  // throw here still reaches a caller as a rejected Promise, matching
  // this port's own declared return type; do not trust this parsing
  // logic without re-checking against real docs.
  // eslint-disable-next-line @typescript-eslint/require-await
  async confirmLink(
    _company: CompanyContext,
    callbackPayload: unknown,
  ): Promise<{ externalItemId: string; accessToken: string; label: string }> {
    const payload = callbackPayload as {
      item_id?: string;
      access_token?: string;
      bank_name?: string;
    };
    if (!payload.item_id || !payload.access_token) {
      throw new InternalServerErrorException(
        'Réponse de callback Bridge inattendue — vérifier le format réel avant mise en production.',
      );
    }
    return {
      externalItemId: payload.item_id,
      accessToken: payload.access_token,
      label: payload.bank_name ?? 'Compte lié via Bridge',
    };
  }

  async fetchTransactions(
    accessToken: string,
    externalItemId: string,
    since?: Date,
  ): Promise<ParsedStatement> {
    const { clientId, clientSecret } = this.getAppCredentials();
    const params = new URLSearchParams({ item_id: externalItemId });
    if (since) {
      params.set('since', since.toISOString());
    }
    // PLACEHOLDER endpoint/response shape.
    const response = await this.request(
      'GET',
      `/aggregation/transactions?${params.toString()}`,
      clientId,
      clientSecret,
      undefined,
      accessToken,
    );
    const body = (await response.json()) as {
      resources?: BridgeTransaction[];
      opening_balance?: unknown;
      closing_balance?: unknown;
      period_start?: string;
      period_end?: string;
      iban?: string | null;
    };

    return {
      iban: body.iban ?? null,
      periodStart: body.period_start ?? new Date(0).toISOString(),
      periodEnd: body.period_end ?? new Date().toISOString(),
      openingBalance: toMoneyApiString(body.opening_balance).toApiString(),
      closingBalance: toMoneyApiString(body.closing_balance).toApiString(),
      lines: (body.resources ?? []).map(toParsedLine),
    };
  }

  async revoke(accessToken: string, externalItemId: string): Promise<void> {
    const { clientId, clientSecret } = this.getAppCredentials();
    // PLACEHOLDER endpoint — must actually terminate the connection on
    // Bridge's side, not just return 200 for an already-inert item.
    await this.request(
      'DELETE',
      `/aggregation/items/${encodeURIComponent(externalItemId)}`,
      clientId,
      clientSecret,
      undefined,
      accessToken,
    );
  }

  private getAppCredentials(): { clientId: string; clientSecret: string } {
    const clientId = this.config.get<string>('BRIDGE_CLIENT_ID');
    const clientSecret = this.config.get<string>('BRIDGE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'BRIDGE_CLIENT_ID / BRIDGE_CLIENT_SECRET ne sont pas configurés — nécessaires pour lier un ' +
          'compte bancaire via Bridge. Voir backend/.env.example.',
      );
    }
    return { clientId, clientSecret };
  }

  private async request(
    method: string,
    path: string,
    clientId: string,
    clientSecret: string,
    body?: unknown,
    accessToken?: string,
  ): Promise<Response> {
    // PLACEHOLDER auth scheme — real Bridge apps may authenticate the
    // app-level client_id/client_secret differently (e.g. dedicated
    // headers) from the per-item Bearer access token; confirm before
    // go-live rather than trust this combination.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Bridge-Version': BridgeAggregatorAdapter.API_VERSION,
      'Client-Id': clientId,
      'Client-Secret': clientSecret,
    };
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    const response = await fetch(`${BridgeAggregatorAdapter.BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      BridgeAggregatorAdapter.logger.warn(`Bridge ${method} ${path} -> HTTP ${response.status}`);
      throw new InternalServerErrorException(
        `Bridge a répondu avec le statut HTTP ${response.status} (${text.slice(0, 300)}).`,
      );
    }
    return response;
  }
}

interface BridgeTransaction {
  // PLACEHOLDER field names — confirm against a real transactions
  // response before go-live.
  id?: string;
  date?: string;
  amount?: string | number;
  label?: string;
  clean_description?: string;
}

function toParsedLine(tx: BridgeTransaction): ParsedStatementLine {
  return {
    bookingDate: tx.date ?? new Date().toISOString().slice(0, 10),
    valueDate: null,
    // Money-safety boundary — see this adapter's own doc comment and
    // CLAUDE.md "Bank reconciliation — Layer 1b": Bridge's amount type
    // (string vs. native JSON number) is unconfirmed. Handle both, but
    // convert to a Money-backed API string at this exact boundary —
    // nothing past this line ever touches a raw parsed float again,
    // same discipline as camt053-parser.service.ts's `parseTagValue:
    // false`.
    amount: toMoneyApiString(tx.amount).toApiString(),
    label: tx.clean_description ?? tx.label ?? '(sans libellé)',
    bankReference: tx.id ?? null,
  };
}

function toMoneyApiString(value: unknown): Money {
  if (typeof value === 'string') {
    return Money.fromString(value);
  }
  if (typeof value === 'number') {
    // Explicit escape hatch for a third-party API we don't control —
    // see Money.fromNumber's own doc comment. Never used for anything
    // derived from this app's own ledger arithmetic.
    return Money.fromNumber(value);
  }
  throw new InternalServerErrorException(
    `Bridge a renvoyé un montant de type inattendu (${typeof value}) — vérifier le format réel de l'API.`,
  );
}
