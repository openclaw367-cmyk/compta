import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BridgeAggregatorAdapter } from './bridge-aggregator.adapter';

/**
 * ⚠️ These tests exercise this adapter against HAND-BUILT fixture JSON
 * responses, mirroring the CAMT.053 parser's own fixture pattern — NOT
 * against Bridge's real API. See this adapter's own doc comment and
 * CLAUDE.md "Bank reconciliation — Layer 1b": every endpoint path and
 * response shape here is a placeholder, so these tests prove this
 * adapter's OWN parsing/conversion logic is internally consistent, not
 * that it matches Bridge's actual behavior. That's the pass's explicit,
 * up-front pre-ship blocker, not a gap discovered later.
 */
function makeConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    BRIDGE_CLIENT_ID: 'client-id-1',
    BRIDGE_CLIENT_SECRET: 'client-secret-1',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('BridgeAggregatorAdapter', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  describe('createConnectSession', () => {
    it('returns the connect URL from a well-formed response', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ url: 'https://connect.bridgeapi.io/session-1' }),
      );
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      const result = await adapter.createConnectSession({ companyId: 'company-1', role: 'OWNER' });
      expect(result.connectUrl).toBe('https://connect.bridgeapi.io/session-1');
    });

    it('throws when BRIDGE_CLIENT_ID/SECRET are not configured — before any network call', async () => {
      const adapter = new BridgeAggregatorAdapter(makeConfig({ BRIDGE_CLIENT_ID: undefined }));
      await expect(adapter.createConnectSession({ companyId: 'company-1', role: 'OWNER' })).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws a clear error when the response has no url field', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      await expect(adapter.createConnectSession({ companyId: 'company-1', role: 'OWNER' })).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it("requests the read-only (AIS) scope, never a payment/PIS scope — the code-level half of the read-only design intent (unconfirmed parameter name, see the adapter's own doc comment)", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ url: 'https://connect.bridgeapi.io/session-1' }),
      );
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      await adapter.createConnectSession({ companyId: 'company-1', role: 'OWNER' });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(sentBody.scope).toBe('aggregation');
      expect(sentBody.scope).not.toBe('payment');
    });

    it('throws on a non-2xx HTTP response, naming the status', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'nope' }, false, 401));
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      await expect(adapter.createConnectSession({ companyId: 'company-1', role: 'OWNER' })).rejects.toThrow(/401/);
    });
  });

  describe('confirmLink', () => {
    it('extracts item id / access token / label from a well-formed callback payload', async () => {
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      const result = await adapter.confirmLink(
        { companyId: 'company-1', role: 'OWNER' },
        { item_id: 'item-1', access_token: 'token-1', bank_name: 'Banque Test' },
      );
      expect(result).toEqual({
        externalItemId: 'item-1',
        accessToken: 'token-1',
        label: 'Banque Test',
      });
    });

    it('falls back to a generic label when bank_name is absent', async () => {
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      const result = await adapter.confirmLink(
        { companyId: 'company-1', role: 'OWNER' },
        { item_id: 'item-1', access_token: 'token-1' },
      );
      expect(result.label).toBe('Compte lié via Bridge');
    });

    it('throws on a callback payload missing item_id or access_token', async () => {
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      await expect(
        adapter.confirmLink({ companyId: 'company-1', role: 'OWNER' }, { item_id: 'item-1' }),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('fetchTransactions', () => {
    it('normalizes a string-amount response into ParsedStatement, never touching a raw JS number', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          iban: 'FR7630001007941234567890185',
          period_start: '2026-03-01',
          period_end: '2026-03-31',
          opening_balance: '100.00',
          closing_balance: '150.00',
          resources: [
            { id: 'tx-1', date: '2026-03-05', amount: '50.00', clean_description: 'Virement reçu' },
          ],
        }),
      );
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      const result = await adapter.fetchTransactions('token-1', 'item-1');
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toEqual({
        bookingDate: '2026-03-05',
        valueDate: null,
        amount: '50.00',
        label: 'Virement reçu',
        bankReference: 'tx-1',
      });
      expect(result.openingBalance).toBe('100.00');
      expect(result.closingBalance).toBe('150.00');
    });

    it('normalizes a native-JSON-number amount the same way — Money.fromNumber, never bare arithmetic', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          resources: [{ id: 'tx-2', date: '2026-03-06', amount: -25.5, label: 'Prélèvement' }],
          opening_balance: 0,
          closing_balance: -25.5,
        }),
      );
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      const result = await adapter.fetchTransactions('token-1', 'item-1');
      expect(result.lines[0].amount).toBe('-25.50');
      expect(result.closingBalance).toBe('-25.50');
    });

    it('throws rather than guessing when an amount is neither a string nor a number', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          resources: [{ id: 'tx-3', amount: null }],
          opening_balance: '0.00',
          closing_balance: '0.00',
        }),
      );
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      await expect(adapter.fetchTransactions('token-1', 'item-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('passes a since param when provided', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ resources: [], opening_balance: '0.00', closing_balance: '0.00' }),
      );
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      const since = new Date('2026-03-15T00:00:00.000Z');
      await adapter.fetchTransactions('token-1', 'item-1', since);
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain('since=2026-03-15');
    });

    it('falls back to a placeholder label when neither clean_description nor label is present', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          resources: [{ id: 'tx-4', date: '2026-03-07', amount: '1.00' }],
          opening_balance: '0.00',
          closing_balance: '1.00',
        }),
      );
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      const result = await adapter.fetchTransactions('token-1', 'item-1');
      expect(result.lines[0].label).toBe('(sans libellé)');
    });
  });

  describe('revoke', () => {
    it('calls the DELETE items endpoint with the access token as bearer auth', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}));
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      await adapter.revoke('token-1', 'item-1');
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/aggregation/items/item-1');
      expect(init.method).toBe('DELETE');
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-1');
    });

    it('propagates a non-2xx response as an error rather than silently succeeding', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));
      const adapter = new BridgeAggregatorAdapter(makeConfig());
      await expect(adapter.revoke('token-1', 'item-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});
