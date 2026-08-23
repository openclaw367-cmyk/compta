import { CloudProposeToolsService } from './cloud-propose-tools.service';
import { ChatTool } from './chat-tool';
import { CompanyContext } from '../../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

function fakeTool(name: string, execute: ChatTool['execute'] = jest.fn()): ChatTool {
  return { spec: { name, description: 'x', parameters: {} }, execute };
}

function buildService(
  readToolNames: string[] = ['search_accounts', 'list_vat_rates', 'query_liasse'],
) {
  const readTools = {
    getAll: jest.fn(() => readToolNames.map((name) => fakeTool(name))),
  };
  const proposeTools = {
    getAll: jest.fn(() => [fakeTool('propose_ecriture')]),
  };
  const service = new CloudProposeToolsService(readTools as never, proposeTools as never);
  return { service, readTools, proposeTools };
}

describe('CloudProposeToolsService — narrow-by-construction cloud registry', () => {
  it('exposes exactly search_accounts, list_vat_rates, and propose_ecriture', () => {
    const { service } = buildService();
    const names = service.getAll().map((t) => t.spec.name);
    expect(new Set(names)).toEqual(
      new Set(['search_accounts', 'list_vat_rates', 'propose_ecriture']),
    );
  });

  it('never exposes any other ReadToolsService tool, even when ReadToolsService offers many more', () => {
    const { service } = buildService([
      'search_accounts',
      'list_vat_rates',
      'list_tiers',
      'list_journals',
      'list_fiscal_years',
      'query_trial_balance',
      'query_grand_livre',
      'query_vat_declaration',
      'query_liasse',
      'query_cash_flow',
      'query_financial_analysis',
      'query_resultat_fiscal',
      'list_fixed_assets',
      'query_depreciation_schedule',
      'search_ecritures',
      'get_ecriture',
    ]);
    const names = service.getAll().map((t) => t.spec.name);
    expect(names).not.toContain('query_liasse');
    expect(names).not.toContain('query_cash_flow');
    expect(names).not.toContain('query_financial_analysis');
    expect(names).not.toContain('query_resultat_fiscal');
    expect(names).not.toContain('query_trial_balance');
    expect(names).not.toContain('query_grand_livre');
    expect(names).not.toContain('search_ecritures');
    expect(names).not.toContain('get_ecriture');
    expect(names.length).toBe(3);
  });

  it('a call to a tool outside the allowlist fails cleanly rather than reaching ReadToolsService', async () => {
    const { service } = buildService([
      'search_accounts',
      'list_vat_rates',
      'query_liasse',
      'query_cash_flow',
    ]);
    const outcome = await service.execute(company, 'query_liasse', { fiscalYearId: 'fy-1' });
    expect(outcome).toEqual({
      ok: false,
      error: 'Unknown tool "query_liasse". No such tool is registered.',
    });
  });

  it('dispatches an allowed tool call to the exact same ChatTool object ReadToolsService built', async () => {
    const execute = jest.fn().mockResolvedValue([{ number: '411000', label: 'Clients' }]);
    const readTools = {
      getAll: jest.fn(() => [
        fakeTool('search_accounts', execute),
        fakeTool('list_vat_rates'),
        fakeTool('query_liasse'),
      ]),
    };
    const proposeTools = { getAll: jest.fn(() => [fakeTool('propose_ecriture')]) };
    const service = new CloudProposeToolsService(readTools as never, proposeTools as never);

    const outcome = await service.execute(company, 'search_accounts', { query: 'client' });

    expect(execute).toHaveBeenCalledWith(company, { query: 'client' });
    expect(outcome).toEqual({ ok: true, value: [{ number: '411000', label: 'Clients' }] });
  });

  it('dispatches propose_ecriture to the exact same ChatTool object ProposeToolsService built', async () => {
    const execute = jest.fn().mockResolvedValue({ dto: {}, warnings: [], assumptions: [] });
    const readTools = {
      getAll: jest.fn(() => [fakeTool('search_accounts'), fakeTool('list_vat_rates')]),
    };
    const proposeTools = { getAll: jest.fn(() => [fakeTool('propose_ecriture', execute)]) };
    const service = new CloudProposeToolsService(readTools as never, proposeTools as never);

    const outcome = await service.execute(company, 'propose_ecriture', { libelle: 'x' });

    expect(execute).toHaveBeenCalledWith(company, { libelle: 'x' });
    expect(outcome).toEqual({ ok: true, value: { dto: {}, warnings: [], assumptions: [] } });
  });

  it('surfaces an underlying tool error as a clean tool-result error, not a throw', async () => {
    const readTools = {
      getAll: jest.fn(() => [
        fakeTool('search_accounts', jest.fn().mockRejectedValue(new Error('boom'))),
        fakeTool('list_vat_rates'),
      ]),
    };
    const proposeTools = { getAll: jest.fn(() => [fakeTool('propose_ecriture')]) };
    const service = new CloudProposeToolsService(readTools as never, proposeTools as never);

    const outcome = await service.execute(company, 'search_accounts', {});
    expect(outcome).toEqual({ ok: false, error: 'boom' });
  });

  it('throws at construction time, naming the gap, if ReadToolsService no longer exposes an allowlisted tool', () => {
    const readTools = { getAll: jest.fn(() => [fakeTool('list_vat_rates')]) }; // search_accounts missing
    const proposeTools = { getAll: jest.fn(() => [fakeTool('propose_ecriture')]) };

    expect(() => new CloudProposeToolsService(readTools as never, proposeTools as never)).toThrow(
      /expected ReadToolsService to expose \[search_accounts\]/,
    );
  });
});
