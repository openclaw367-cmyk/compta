import { Injectable } from '@nestjs/common';
import { CompanyContext } from '../../../common/tenant/company-context';
import { ChatTool, extractErrorMessage } from './chat-tool';
import { ReadToolsService } from './read-tools.service';
import { ProposeToolsService } from './propose-tools.service';

/** The one write-adjacent tool name — see the class doc comment below for why this is blocked for READ_ONLY. */
const WRITE_ADJACENT_TOOL_NAME = 'propose_ecriture';

/**
 * The tool registry exposed over the local MCP server (`src/mcp-server/`
 * — see CLAUDE.md "MCP server (local)"). Unlike `CloudProposeToolsService`
 * (a short, named ALLOWLIST for the cloud-AI tier's own narrower write
 * turn — see its own doc comment), this registry is deliberately WIDE:
 * the WHOLE existing `ReadToolsService` registry (all 16 tools, the
 * same breadth the in-app assistant's own local `/assistant` chat
 * already has for this company) plus `ProposeToolsService`'s single
 * `propose_ecriture` tool — reused verbatim, not reimplemented. There is
 * no new read/write logic in this file: it is composition only, the
 * same "thin dispatch onto an already-tested service, nothing inline"
 * discipline `ChatTool` itself documents.
 *
 * The write surface is EXACTLY `propose_ecriture` and nothing else —
 * grep this file (and `read-tools.service.ts`) for `validate`/`remove`/
 * `.create(`/`.update(` to confirm: none of those appear anywhere in
 * either tool registry. `propose_ecriture` itself never persists (see
 * `propose-tools.service.ts`'s own doc comment) — a human must still
 * confirm the proposal through the app's ordinary `POST /entries`
 * before anything reaches the ledger, identical to the in-app chat
 * flow. An external user's own Claude, connected over MCP, has no more
 * write capability than the in-app assistant already has — never more.
 *
 * **`ReadOnlyGuard`'s own coarse rule (CLAUDE.md "Multi-user / roles &
 * permissions": a READ_ONLY member can't make changes) is mirrored
 * here, not inherited for free.** `ReadOnlyGuard` works by blocking any
 * non-GET/HEAD HTTP verb — a rule this transport has no HTTP verb to
 * key off of, since MCP tool calls aren't HTTP requests. `execute()`
 * below blocks `propose_ecriture` specifically for a READ_ONLY
 * `CompanyContext`, the one tool in this registry the guard's own rule
 * would actually have caught (every read tool stays available,
 * matching `SAFE_METHODS` always being allowed).
 */
@Injectable()
export class McpToolsService {
  private readonly tools: ChatTool[];

  constructor(
    private readonly readTools: ReadToolsService,
    private readonly proposeTools: ProposeToolsService,
  ) {
    this.tools = [...this.readTools.getAll(), ...this.proposeTools.getAll()];
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
    if (name === WRITE_ADJACENT_TOOL_NAME && company.role === 'READ_ONLY') {
      return {
        ok: false,
        error: 'This account has read-only access to this company and cannot make changes.',
      };
    }
    try {
      const value = await tool.execute(company, args);
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: extractErrorMessage(err) };
    }
  }
}
