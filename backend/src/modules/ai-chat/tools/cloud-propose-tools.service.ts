import { Injectable } from '@nestjs/common';
import { CompanyContext } from '../../../common/tenant/company-context';
import { ChatTool, extractErrorMessage } from './chat-tool';
import { ReadToolsService } from './read-tools.service';
import { ProposeToolsService } from './propose-tools.service';

/**
 * The only read tools a cloud proposal turn may reach — deliberately a
 * short, explicit ALLOWLIST, not "everything ReadToolsService has minus a
 * blocklist." Growing ReadToolsService's own 16-tool registry later (a
 * future 17th read tool) can never silently widen what a cloud turn sees
 * — only editing this constant can. `search_accounts` resolves an account
 * number/label the model needs to build a proposal; `list_vat_rates`
 * resolves a taux de TVA. Neither can return a financial report
 * (`query_liasse`, `query_cash_flow`, a trial balance, ...) — see
 * CLAUDE.md "AI chatbot cloud tier" for why that specific line was drawn.
 */
const ALLOWED_READ_TOOL_NAMES = ['search_accounts', 'list_vat_rates'] as const;

/**
 * The narrow tool registry a cloud-routed turn is given — see CLAUDE.md
 * "AI chatbot cloud tier" and
 * specs/ai-chatbot-cloud-tier-implementation-spec.md. This is
 * minimization BY CONSTRUCTION, not a filter that could have a bug:
 * `ReadToolsService`'s full registry is never injected into anything a
 * cloud turn touches — this class reuses exactly the two read tools named
 * in `ALLOWED_READ_TOOL_NAMES` (the SAME already-tested `ChatTool`
 * objects `ReadToolsService` built, not reimplemented logic) plus
 * `ProposeToolsService`'s own single `propose_ecriture` tool. No new
 * business logic lives in this file — it's composition and filtering
 * only, so its own "narrow by construction" claim stays grep-verifiable:
 * auditing what a cloud turn can reach only requires reading this one
 * short file, never re-deriving it from `ReadToolsService`'s full
 * implementation.
 *
 * The constructor throws (rather than silently exposing fewer tools than
 * intended) if `ReadToolsService` ever stops having a tool named in
 * `ALLOWED_READ_TOOL_NAMES` — e.g. a future rename in
 * `read-tools.service.ts` with this file left unmatched. Same "throw
 * rather than silently degrade" discipline as every other guard in this
 * codebase.
 */
@Injectable()
export class CloudProposeToolsService {
  private readonly tools: ChatTool[];

  constructor(
    private readonly readTools: ReadToolsService,
    private readonly proposeTools: ProposeToolsService,
  ) {
    const allowedReadTools = this.readTools
      .getAll()
      .filter((tool) => (ALLOWED_READ_TOOL_NAMES as readonly string[]).includes(tool.spec.name));

    const missing = ALLOWED_READ_TOOL_NAMES.filter(
      (name) => !allowedReadTools.some((tool) => tool.spec.name === name),
    );
    if (missing.length > 0) {
      throw new Error(
        `CloudProposeToolsService expected ReadToolsService to expose [${missing.join(', ')}], ` +
          "but it doesn't — check for a tool rename in read-tools.service.ts.",
      );
    }

    this.tools = [...allowedReadTools, ...this.proposeTools.getAll()];
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
}
