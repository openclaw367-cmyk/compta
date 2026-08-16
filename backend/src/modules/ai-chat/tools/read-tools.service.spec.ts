import { ReadToolsService } from './read-tools.service';
import { CompanyContext } from '../../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

/**
 * These tests exist to prove the module's own load-bearing invariant (see
 * read-tools.service.ts's doc comment): every tool is a THIN DISPATCH onto
 * an existing service method — same args in, same result out, no
 * reimplemented aggregation. Each test asserts the underlying service mock
 * was called with the tool's arguments and that the tool's result is
 * exactly what the mock returned (or, for search_accounts, exactly the
 * mock's list minus the documented trivial substring filter — nothing
 * else transformed).
 */
function buildService() {
  const accounts = {
    findAll: jest.fn(),
    listTiers: jest.fn(),
  };
  const journals = { findAll: jest.fn() };
  const fiscalYears = { findAll: jest.fn() };
  const vat = { findAll: jest.fn(), computeDeclaration: jest.fn() };
  const ledger = { trialBalance: jest.fn(), accountLedger: jest.fn() };
  const liasse = { generate: jest.fn(), generateSecondary: jest.fn() };
  const cashFlow = { generate: jest.fn() };
  const financialAnalysis = { generate: jest.fn() };
  const resultatFiscal = { generate: jest.fn() };
  const depreciation = { findAll: jest.fn(), findSchedule: jest.fn() };
  const entries = { findAll: jest.fn(), findOne: jest.fn() };

  const service = new ReadToolsService(
    accounts as never,
    journals as never,
    fiscalYears as never,
    vat as never,
    ledger as never,
    liasse as never,
    cashFlow as never,
    financialAnalysis as never,
    resultatFiscal as never,
    depreciation as never,
    entries as never,
  );

  return {
    service,
    accounts,
    journals,
    fiscalYears,
    vat,
    ledger,
    liasse,
    cashFlow,
    financialAnalysis,
    resultatFiscal,
    depreciation,
    entries,
  };
}

describe('ReadToolsService — thin dispatch invariant', () => {
  it('registers every tool with a unique name', () => {
    const { service } = buildService();
    const names = service.getAll().map((t) => t.spec.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('search_accounts');
    expect(names).not.toContain('propose_ecriture');
  });

  it('search_accounts with no query returns the service list verbatim', async () => {
    const { service, accounts } = buildService();
    const list = [{ number: '606400', label: 'Fournitures' }];
    accounts.findAll.mockResolvedValue(list);
    const outcome = await service.execute(company, 'search_accounts', {});
    expect(accounts.findAll).toHaveBeenCalledWith(company);
    expect(outcome).toEqual({ ok: true, value: list });
  });

  it('search_accounts filters by a case-insensitive substring of number or label only', async () => {
    const { service, accounts } = buildService();
    accounts.findAll.mockResolvedValue([
      { number: '606400', label: 'Achats de fournitures' },
      { number: '411000', label: 'Clients' },
    ]);
    const outcome = await service.execute(company, 'search_accounts', { query: 'CLIENT' });
    expect(outcome).toEqual({ ok: true, value: [{ number: '411000', label: 'Clients' }] });
  });

  it('list_tiers dispatches to AccountsService.listTiers with the given parentAccountId', async () => {
    const { service, accounts } = buildService();
    accounts.listTiers.mockResolvedValue([{ id: 'tiers-1' }]);
    const outcome = await service.execute(company, 'list_tiers', { parentAccountId: 'acc-411' });
    expect(accounts.listTiers).toHaveBeenCalledWith(company, 'acc-411');
    expect(outcome).toEqual({ ok: true, value: [{ id: 'tiers-1' }] });
  });

  it('query_trial_balance dispatches to LedgerService.trialBalance with a plain DTO', async () => {
    const { service, ledger } = buildService();
    const response = { lines: [], totals: { debit: '0.00', credit: '0.00', balance: '0.00' } };
    ledger.trialBalance.mockResolvedValue(response);
    const outcome = await service.execute(company, 'query_trial_balance', {
      fiscalYearId: 'fy-1',
      periodStart: '2026-01-01',
    });
    expect(ledger.trialBalance).toHaveBeenCalledWith(company, {
      fiscalYearId: 'fy-1',
      periodStart: '2026-01-01',
      periodEnd: undefined,
    });
    expect(outcome).toEqual({ ok: true, value: response });
  });

  it('query_liasse dispatches to generate() by default and generateSecondary() when secondary=true', async () => {
    const { service, liasse } = buildService();
    liasse.generate.mockResolvedValue({ regime: 'REEL_NORMAL' });
    liasse.generateSecondary.mockResolvedValue({ regime: 'REEL_SIMPLIFIE' });

    const primary = await service.execute(company, 'query_liasse', { fiscalYearId: 'fy-1' });
    expect(liasse.generate).toHaveBeenCalledWith(company, { fiscalYearId: 'fy-1' });
    expect(primary).toEqual({ ok: true, value: { regime: 'REEL_NORMAL' } });

    const secondary = await service.execute(company, 'query_liasse', {
      fiscalYearId: 'fy-1',
      secondary: true,
    });
    expect(liasse.generateSecondary).toHaveBeenCalledWith(company, { fiscalYearId: 'fy-1' });
    expect(secondary).toEqual({ ok: true, value: { regime: 'REEL_SIMPLIFIE' } });
  });

  it('query_cash_flow / query_financial_analysis / query_resultat_fiscal dispatch verbatim', async () => {
    const { service, cashFlow, financialAnalysis, resultatFiscal } = buildService();
    cashFlow.generate.mockResolvedValue({ x: 1 });
    financialAnalysis.generate.mockResolvedValue({ y: 2 });
    resultatFiscal.generate.mockResolvedValue({ z: 3 });

    expect(await service.execute(company, 'query_cash_flow', { fiscalYearId: 'fy-1' })).toEqual({
      ok: true,
      value: { x: 1 },
    });
    expect(cashFlow.generate).toHaveBeenCalledWith(company, { fiscalYearId: 'fy-1' });

    expect(
      await service.execute(company, 'query_financial_analysis', { fiscalYearId: 'fy-1' }),
    ).toEqual({ ok: true, value: { y: 2 } });
    expect(financialAnalysis.generate).toHaveBeenCalledWith(company, { fiscalYearId: 'fy-1' });

    expect(
      await service.execute(company, 'query_resultat_fiscal', { fiscalYearId: 'fy-1' }),
    ).toEqual({ ok: true, value: { z: 3 } });
    expect(resultatFiscal.generate).toHaveBeenCalledWith(company, { fiscalYearId: 'fy-1' });
  });

  it('search_ecritures with no fiscalYearId returns the full list verbatim', async () => {
    const { service, entries } = buildService();
    const list = [
      { id: 'e1', fiscalYearId: 'fy-1' },
      { id: 'e2', fiscalYearId: 'fy-2' },
    ];
    entries.findAll.mockResolvedValue(list);
    const outcome = await service.execute(company, 'search_ecritures', {});
    expect(outcome).toEqual({ ok: true, value: list });
  });

  it('search_ecritures with a fiscalYearId applies only a plain equality filter', async () => {
    const { service, entries } = buildService();
    entries.findAll.mockResolvedValue([
      { id: 'e1', fiscalYearId: 'fy-1' },
      { id: 'e2', fiscalYearId: 'fy-2' },
    ]);
    const outcome = await service.execute(company, 'search_ecritures', { fiscalYearId: 'fy-1' });
    expect(outcome).toEqual({ ok: true, value: [{ id: 'e1', fiscalYearId: 'fy-1' }] });
  });

  it('get_ecriture dispatches to EntriesService.findOne', async () => {
    const { service, entries } = buildService();
    entries.findOne.mockResolvedValue({ id: 'e1' });
    const outcome = await service.execute(company, 'get_ecriture', { ecritureId: 'e1' });
    expect(entries.findOne).toHaveBeenCalledWith(company, 'e1');
    expect(outcome).toEqual({ ok: true, value: { id: 'e1' } });
  });

  it('an unknown tool name returns a clean error instead of throwing', async () => {
    const { service } = buildService();
    const outcome = await service.execute(company, 'delete_everything', {});
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: string }).error).toMatch(/unknown tool/i);
  });

  it('a missing required argument is caught and reported as a tool-result error, not thrown', async () => {
    const { service } = buildService();
    const outcome = await service.execute(company, 'query_trial_balance', {});
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: string }).error).toMatch(/fiscalYearId/);
  });

  it('an underlying service throwing (e.g. NotFoundException) surfaces its own message verbatim', async () => {
    const { service, entries } = buildService();
    entries.findOne.mockRejectedValue(new Error('Écriture xyz not found'));
    const outcome = await service.execute(company, 'get_ecriture', { ecritureId: 'xyz' });
    expect(outcome).toEqual({ ok: false, error: 'Écriture xyz not found' });
  });
});
