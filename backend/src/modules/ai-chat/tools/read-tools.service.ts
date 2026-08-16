import { Injectable } from '@nestjs/common';
import { CompanyContext } from '../../../common/tenant/company-context';
import { AccountsService } from '../../accounts/accounts.service';
import { JournalsService } from '../../journals/journals.service';
import { FiscalYearsService } from '../../fiscal-years/fiscal-years.service';
import { VatService } from '../../vat/vat.service';
import { LedgerService } from '../../ledger/ledger.service';
import { LiasseService } from '../../liasse/liasse.service';
import { CashFlowService } from '../../cash-flow/cash-flow.service';
import { FinancialAnalysisService } from '../../financial-analysis/financial-analysis.service';
import { ResultatFiscalService } from '../../resultat-fiscal/resultat-fiscal.service';
import { DepreciationService } from '../../depreciation/depreciation.service';
import { EntriesService } from '../../entries/entries.service';
import {
  ChatTool,
  extractErrorMessage,
  optionalBoolean,
  optionalString,
  requireString,
} from './chat-tool';

/**
 * The Phase 1 tool registry — READ ONLY, unchanged by Phase 2. Every
 * `execute` below is a thin dispatch onto an existing, already-tested
 * domain service method: no tool contains its own aggregation,
 * classification, or money math. This is an enforced invariant, not a
 * style preference — see chat-tool.ts's doc comment and CLAUDE.md "AI
 * chatbot". A new kind of question the model needs answered is a
 * new/extended service method, reviewed and tested independently of the
 * chatbot, never inline logic added here.
 *
 * `propose_ecriture` (Phase 2, now active) deliberately does NOT live in
 * this file — it's the ONLY tool in a separate registry,
 * ProposeToolsService (tools/propose-tools.service.ts). Keeping it out
 * of this file means this registry's own "read only" claim stays
 * grep-verifiable: nothing here can ever accidentally become write-
 * capable by editing this one file.
 */
@Injectable()
export class ReadToolsService {
  private readonly tools: ChatTool[];

  constructor(
    private readonly accounts: AccountsService,
    private readonly journals: JournalsService,
    private readonly fiscalYears: FiscalYearsService,
    private readonly vat: VatService,
    private readonly ledger: LedgerService,
    private readonly liasse: LiasseService,
    private readonly cashFlow: CashFlowService,
    private readonly financialAnalysis: FinancialAnalysisService,
    private readonly resultatFiscal: ResultatFiscalService,
    private readonly depreciation: DepreciationService,
    private readonly entries: EntriesService,
  ) {
    this.tools = this.buildTools();
  }

  getAll(): ChatTool[] {
    return this.tools;
  }

  async execute(
    company: CompanyContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
    const tool = this.tools.find((t) => t.spec.name === name);
    if (!tool) {
      return { ok: false, error: `Unknown tool "${name}". No such tool is registered.` };
    }
    try {
      const value = await tool.execute(company, args);
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: extractErrorMessage(err) };
    }
  }

  private buildTools(): ChatTool[] {
    return [
      {
        spec: {
          name: 'search_accounts',
          description:
            "Search this company's chart of accounts (PCG) by a substring of the account " +
            'number or label. Omit "query" to list all accounts. Use this to resolve an ' +
            'account name/number mentioned in conversation to a real accountId before calling ' +
            'any other tool that needs one.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Substring to match against number or label.' },
            },
          },
        },
        execute: async (company, args) => {
          const query = optionalString(args, 'query')?.toLowerCase();
          const all = await this.accounts.findAll(company);
          if (!query) {
            return all;
          }
          // Trivial presentational filtering over an unmodified service
          // result — not aggregation, no money touched. See the module
          // doc comment above for the line this must not cross.
          return all.filter(
            (a) => a.number.toLowerCase().includes(query) || a.label.toLowerCase().includes(query),
          );
        },
      },
      {
        spec: {
          name: 'list_tiers',
          description:
            'List the tiers (comptes auxiliaires — specific clients/suppliers) under a ' +
            'collectif account (e.g. 411000 clients, 401000 fournisseurs). Requires the ' +
            "collectif account's id — resolve it with search_accounts first.",
          parameters: {
            type: 'object',
            properties: {
              parentAccountId: { type: 'string', description: "The collectif account's id." },
            },
            required: ['parentAccountId'],
          },
        },
        execute: (company, args) =>
          this.accounts.listTiers(company, requireString(args, 'parentAccountId')),
      },
      {
        spec: {
          name: 'list_journals',
          description: "List this company's journaux (AC, VE, BQ, OD, AN, ...).",
          parameters: { type: 'object', properties: {} },
        },
        execute: (company) => this.journals.findAll(company),
      },
      {
        spec: {
          name: 'list_fiscal_years',
          description:
            "List this company's fiscal years (exercices), with id, label, start/end date, " +
            'and whether closed. Most other tools need a fiscalYearId — call this first.',
          parameters: { type: 'object', properties: {} },
        },
        execute: (company) => this.fiscalYears.findAll(company),
      },
      {
        spec: {
          name: 'list_vat_rates',
          description: "List this company's configured taux de TVA.",
          parameters: { type: 'object', properties: {} },
        },
        execute: (company) => this.vat.findAll(company),
      },
      {
        spec: {
          name: 'query_trial_balance',
          description:
            'Balance générale for a fiscal year: per-account total debit/credit/balance. ' +
            'Optionally scoped to a date range within the fiscal year.',
          parameters: {
            type: 'object',
            properties: {
              fiscalYearId: { type: 'string' },
              periodStart: { type: 'string', description: 'YYYY-MM-DD, optional.' },
              periodEnd: { type: 'string', description: 'YYYY-MM-DD, optional.' },
            },
            required: ['fiscalYearId'],
          },
        },
        execute: (company, args) =>
          this.ledger.trialBalance(company, {
            fiscalYearId: requireString(args, 'fiscalYearId'),
            periodStart: optionalString(args, 'periodStart'),
            periodEnd: optionalString(args, 'periodEnd'),
          }),
      },
      {
        spec: {
          name: 'query_grand_livre',
          description:
            'Grand livre for ONE account: every écriture line posted to it in a fiscal year, ' +
            "with a running balance. Requires the account's id — resolve it with " +
            'search_accounts first.',
          parameters: {
            type: 'object',
            properties: {
              accountId: { type: 'string' },
              fiscalYearId: { type: 'string' },
              periodStart: { type: 'string', description: 'YYYY-MM-DD, optional.' },
              periodEnd: { type: 'string', description: 'YYYY-MM-DD, optional.' },
            },
            required: ['accountId', 'fiscalYearId'],
          },
        },
        execute: (company, args) =>
          this.ledger.accountLedger(company, requireString(args, 'accountId'), {
            fiscalYearId: requireString(args, 'fiscalYearId'),
            periodStart: optionalString(args, 'periodStart'),
            periodEnd: optionalString(args, 'periodEnd'),
          }),
      },
      {
        spec: {
          name: 'query_vat_declaration',
          description:
            'Compute the VAT declaration (CA3 for a French company, DSF for a Monaco company — ' +
            "branches automatically on the company's own jurisdiction) for a period.",
          parameters: {
            type: 'object',
            properties: {
              periodStart: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
              periodEnd: { type: 'string', description: 'YYYY-MM-DD, inclusive.' },
            },
            required: ['periodStart', 'periodEnd'],
          },
        },
        execute: (company, args) =>
          this.vat.computeDeclaration(company, {
            periodStart: requireString(args, 'periodStart'),
            periodEnd: requireString(args, 'periodEnd'),
          }),
      },
      {
        spec: {
          name: 'query_liasse',
          description:
            'Compute the liasse fiscale (bilan, compte de résultat, and — for régime réel ' +
            "normal — the 2054/2055/2056/2057/2059 annexes) for a fiscal year, in this company's " +
            'own official regime. Set secondary=true to instead compute the OTHER regime as a ' +
            'comparison view (bilan + compte de résultat only, no annexes).',
          parameters: {
            type: 'object',
            properties: {
              fiscalYearId: { type: 'string' },
              secondary: { type: 'boolean', description: 'Default false.' },
            },
            required: ['fiscalYearId'],
          },
        },
        execute: (company, args) => {
          const dto = { fiscalYearId: requireString(args, 'fiscalYearId') };
          return optionalBoolean(args, 'secondary')
            ? this.liasse.generateSecondary(company, dto)
            : this.liasse.generate(company, dto);
        },
      },
      {
        spec: {
          name: 'query_cash_flow',
          description:
            'Compute the tableau des flux de trésorerie (méthode indirecte) for a fiscal year.',
          parameters: {
            type: 'object',
            properties: { fiscalYearId: { type: 'string' } },
            required: ['fiscalYearId'],
          },
        },
        execute: (company, args) =>
          this.cashFlow.generate(company, { fiscalYearId: requireString(args, 'fiscalYearId') }),
      },
      {
        spec: {
          name: 'query_financial_analysis',
          description:
            'Compute the retraitement analytique for a fiscal year: SIG cascade (marge, valeur ' +
            'ajoutée, EBE...), BFR/FR/trésorerie nette, free cash flow, endettement net, book EV, ' +
            'and the standard financial ratios.',
          parameters: {
            type: 'object',
            properties: { fiscalYearId: { type: 'string' } },
            required: ['fiscalYearId'],
          },
        },
        execute: (company, args) =>
          this.financialAnalysis.generate(company, {
            fiscalYearId: requireString(args, 'fiscalYearId'),
          }),
      },
      {
        spec: {
          name: 'query_resultat_fiscal',
          description:
            'Compute the détermination du résultat fiscal (2058-A/B) for a fiscal year, as ' +
            'currently recorded — the ledger-computed anchor (résultat comptable, I7) plus ' +
            'whatever WJ/WG amounts the ledger itself suggests, with no manually declared ' +
            'réintégrations/déductions applied. This never proves tax completeness — say so ' +
            'if asked whether it is complete.',
          parameters: {
            type: 'object',
            properties: { fiscalYearId: { type: 'string' } },
            required: ['fiscalYearId'],
          },
        },
        execute: (company, args) =>
          this.resultatFiscal.generate(company, {
            fiscalYearId: requireString(args, 'fiscalYearId'),
          }),
      },
      {
        spec: {
          name: 'list_fixed_assets',
          description:
            "List this company's immobilisations with their valeur brute, amortissements " +
            'cumulés, and VNC as of now.',
          parameters: { type: 'object', properties: {} },
        },
        execute: (company) => this.depreciation.findAll(company),
      },
      {
        spec: {
          name: 'query_depreciation_schedule',
          description: "One fixed asset's full plan d'amortissement. Requires its id.",
          parameters: {
            type: 'object',
            properties: { fixedAssetId: { type: 'string' } },
            required: ['fixedAssetId'],
          },
        },
        execute: (company, args) =>
          this.depreciation.findSchedule(company, requireString(args, 'fixedAssetId')),
      },
      {
        spec: {
          name: 'search_ecritures',
          description:
            "List this company's écritures (journal entries), optionally scoped to one fiscal " +
            'year. Includes both draft and validated entries — check validatedAt to tell them ' +
            "apart. Use get_ecriture for one entry's full line detail if needed.",
          parameters: {
            type: 'object',
            properties: { fiscalYearId: { type: 'string', description: 'Optional filter.' } },
          },
        },
        execute: async (company, args) => {
          const fiscalYearId = optionalString(args, 'fiscalYearId');
          const all = await this.entries.findAll(company);
          return fiscalYearId ? all.filter((e) => e.fiscalYearId === fiscalYearId) : all;
        },
      },
      {
        spec: {
          name: 'get_ecriture',
          description: 'One écriture by id, with its full line detail.',
          parameters: {
            type: 'object',
            properties: { ecritureId: { type: 'string' } },
            required: ['ecritureId'],
          },
        },
        execute: (company, args) =>
          this.entries.findOne(company, requireString(args, 'ecritureId')),
      },
    ];
  }
}
