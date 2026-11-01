import { McpToolsService } from './mcp-tools.service';
import { ChatTool } from './chat-tool';
import { CompanyContext } from '../../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };

const ALL_READ_TOOL_NAMES = [
  'search_accounts',
  'list_tiers',
  'list_journals',
  'list_fiscal_years',
  'list_vat_rates',
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
];

function fakeTool(name: string, execute: ChatTool['execute'] = jest.fn()): ChatTool {
  return { spec: { name, description: 'x', parameters: {} }, execute };
}

function buildService() {
  const readTools = { getAll: jest.fn(() => ALL_READ_TOOL_NAMES.map((name) => fakeTool(name))) };
  const proposeTools = { getAll: jest.fn(() => [fakeTool('propose_ecriture')]) };
  const service = new McpToolsService(readTools as never, proposeTools as never);
  return { service, readTools, proposeTools };
}

describe('McpToolsService — wide, verbatim-reuse registry for the local MCP server', () => {
  it('exposes every ReadToolsService tool plus propose_ecriture, and nothing else', () => {
    const { service } = buildService();
    const names = service.getAll().map((t) => t.spec.name);
    expect(new Set(names)).toEqual(new Set([...ALL_READ_TOOL_NAMES, 'propose_ecriture']));
    expect(names.length).toBe(ALL_READ_TOOL_NAMES.length + 1);
  });

  it('the write surface is exactly one tool: propose_ecriture', () => {
    const { service } = buildService();
    const writeLike = service
      .getAll()
      .map((t) => t.spec.name)
      .filter((n) => /propose|validate|create|update|delete|remove|post/i.test(n));
    expect(writeLike).toEqual(['propose_ecriture']);
  });

  it('dispatches a read tool call to the exact ChatTool object ReadToolsService built', async () => {
    const execute = jest.fn().mockResolvedValue({ totalDebit: '100.00' });
    const readTools = { getAll: jest.fn(() => [fakeTool('query_trial_balance', execute)]) };
    const proposeTools = { getAll: jest.fn(() => [fakeTool('propose_ecriture')]) };
    const service = new McpToolsService(readTools as never, proposeTools as never);

    const outcome = await service.execute(company, 'query_trial_balance', {
      fiscalYearId: 'fy-1',
    });

    expect(execute).toHaveBeenCalledWith(company, { fiscalYearId: 'fy-1' });
    expect(outcome).toEqual({ ok: true, value: { totalDebit: '100.00' } });
  });

  it('dispatches propose_ecriture to the exact ChatTool object ProposeToolsService built — never persisting itself', async () => {
    const execute = jest.fn().mockResolvedValue({ dto: {}, warnings: [], assumptions: [] });
    const readTools = { getAll: jest.fn(() => []) };
    const proposeTools = { getAll: jest.fn(() => [fakeTool('propose_ecriture', execute)]) };
    const service = new McpToolsService(readTools as never, proposeTools as never);

    const outcome = await service.execute(company, 'propose_ecriture', { libelle: 'x' });

    expect(execute).toHaveBeenCalledWith(company, { libelle: 'x' });
    expect(outcome).toEqual({ ok: true, value: { dto: {}, warnings: [], assumptions: [] } });
  });

  it('an unknown tool name fails cleanly rather than throwing', async () => {
    const { service } = buildService();
    const outcome = await service.execute(company, 'delete_everything', {});
    expect(outcome).toEqual({
      ok: false,
      error: 'Unknown tool "delete_everything". No such tool is registered.',
    });
  });

  it('blocks propose_ecriture for a READ_ONLY company context, mirroring ReadOnlyGuard — never reaching the real tool', async () => {
    const execute = jest.fn();
    const readTools = { getAll: jest.fn(() => []) };
    const proposeTools = { getAll: jest.fn(() => [fakeTool('propose_ecriture', execute)]) };
    const service = new McpToolsService(readTools as never, proposeTools as never);
    const readOnlyCompany: CompanyContext = { companyId: 'company-1', role: 'READ_ONLY' };

    const outcome = await service.execute(readOnlyCompany, 'propose_ecriture', { libelle: 'x' });

    expect(outcome).toEqual({
      ok: false,
      error: 'This account has read-only access to this company and cannot make changes.',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('still allows every read tool for a READ_ONLY company context', async () => {
    const execute = jest.fn().mockResolvedValue({ totalDebit: '0.00' });
    const readTools = { getAll: jest.fn(() => [fakeTool('query_trial_balance', execute)]) };
    const proposeTools = { getAll: jest.fn(() => [fakeTool('propose_ecriture')]) };
    const service = new McpToolsService(readTools as never, proposeTools as never);
    const readOnlyCompany: CompanyContext = { companyId: 'company-1', role: 'READ_ONLY' };

    const outcome = await service.execute(readOnlyCompany, 'query_trial_balance', {});

    expect(outcome).toEqual({ ok: true, value: { totalDebit: '0.00' } });
  });

  it('surfaces an underlying tool error as a clean tool-result error, not a throw', async () => {
    const readTools = {
      getAll: jest.fn(() => [
        fakeTool('search_accounts', jest.fn().mockRejectedValue(new Error('boom'))),
      ]),
    };
    const proposeTools = { getAll: jest.fn(() => [fakeTool('propose_ecriture')]) };
    const service = new McpToolsService(readTools as never, proposeTools as never);

    const outcome = await service.execute(company, 'search_accounts', {});
    expect(outcome).toEqual({ ok: false, error: 'boom' });
  });
});
