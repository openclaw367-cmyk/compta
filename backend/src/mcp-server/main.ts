/**
 * The local MCP server entrypoint — run with `npm run mcp:local` (see
 * package.json). See CLAUDE.md "MCP server (local)" for the full design
 * and the privacy/consent framing.
 *
 * Scope, stated explicitly: THIS is the local-verification half only.
 * Transport is stdio (Claude Code / any local MCP client launches this
 * as a child process over stdin/stdout) — no HTTP, no public endpoint,
 * no OAuth. A PUBLIC remote connector (what a user would add from
 * Settings → Connectors on claude.ai) needs a public HTTPS endpoint
 * plus an OAuth 2.1 authorization server mapping to this exact same
 * `CompanyContext`/Membership model — a separate, consciously deferred
 * deployment decision, same reasoning this project already applied to
 * Bridge Layer 1b (polling, not webhooks, because there's no public
 * endpoint today). Not built this pass.
 *
 * Auth/company-scoping reuses the REAL pieces the HTTP API uses for
 * every other request, called directly instead of through
 * AuthMiddleware/CompanyContextMiddleware (there's no HTTP request
 * here to run those against):
 *   1. `AuthService.login()` — the exact bcrypt-checked login path.
 *   2. `AccessTokenService.verify()` on the JWT `login()` just issued —
 *      the exact check `AuthMiddleware` runs on every request.
 *   3. `resolveCompanyContextForUser()` — the exact Membership lookup
 *      `CompanyContextMiddleware` runs on every request (extracted from
 *      that file specifically so this script and the middleware share
 *      one implementation, never two).
 * A user with no account, a wrong password, or no Membership for the
 * requested company is refused exactly as they would be over HTTP —
 * this script has no separate, looser auth path.
 *
 * Tool handling is a thin dispatch onto `McpToolsService` — this file
 * contains zero query/computation/validation logic of its own.
 *
 * `propose_ecriture`'s own result gets one additional thing attached
 * here: a confirmation link (via `McpConfirmationsService.createToken()`,
 * itself a thin delegate, not inline logic) — see CLAUDE.md "MCP
 * confirmation flow". This is the ONLY write this process ever
 * performs, and it writes proposal-tracking metadata, never an
 * Ecriture — posting only ever happens from the web confirm page's own
 * authenticated, human-triggered POST.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AuthService } from '../modules/auth/auth.service';
import { AccessTokenService } from '../common/auth/access-token.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { McpToolsService } from '../modules/ai-chat/tools/mcp-tools.service';
import { McpConfirmationsService } from '../modules/mcp-confirmations/mcp-confirmations.service';
import { ProposedEcriture } from '../modules/ai-chat/tools/propose-tools.service';
import { resolveCompanyContextForUser } from '../common/tenant/resolve-company-context';
import { CompanyContext } from '../common/tenant/company-context';

const PROPOSE_TOOL_NAME = 'propose_ecriture';
import {
  Server,
  StdioServerTransport,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpCallToolRequest,
  McpCallToolResult,
  McpListToolsResult,
} from './mcp-sdk';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable "${name}". The local MCP server needs ` +
        'MCP_EMAIL, MCP_PASSWORD, and MCP_COMPANY_ID set — see CLAUDE.md "MCP server (local)".',
    );
  }
  return value;
}

async function resolveAuthenticatedIdentity(
  authService: AuthService,
  accessTokens: AccessTokenService,
  prisma: PrismaService,
): Promise<{ userId: string; company: CompanyContext }> {
  const email = requiredEnv('MCP_EMAIL');
  const password = requiredEnv('MCP_PASSWORD');
  const companyId = requiredEnv('MCP_COMPANY_ID');

  // Step 1 + 2: the exact login + token-verify round trip AuthMiddleware
  // relies on for every HTTP request — not a shortcut to the user id.
  const issued = await authService.login({ email, password });
  const payload = accessTokens.verify(issued.accessToken);

  // Step 3: the exact Membership check CompanyContextMiddleware runs.
  const company = await resolveCompanyContextForUser(prisma, payload.sub, companyId);
  return { userId: payload.sub, company };
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  const authService = app.get(AuthService);
  const accessTokens = app.get(AccessTokenService);
  const prisma = app.get(PrismaService);
  const mcpTools = app.get(McpToolsService);
  const mcpConfirmations = app.get(McpConfirmationsService);

  const { userId, company } = await resolveAuthenticatedIdentity(authService, accessTokens, prisma);

  const server = new Server(
    { name: 'citaledge-accounting', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, (): McpListToolsResult => {
    return {
      tools: mcpTools.getAll().map((tool) => ({
        name: tool.spec.name,
        description: tool.spec.description,
        inputSchema: tool.spec
          .parameters as unknown as McpListToolsResult['tools'][number]['inputSchema'],
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<McpCallToolResult> => {
    const { name, arguments: args } = (request as McpCallToolRequest).params;
    const outcome = await mcpTools.execute(company, name, args ?? {});
    if (!outcome.ok) {
      return { content: [{ type: 'text', text: outcome.error }], isError: true };
    }
    // propose_ecriture ALONE, over MCP, also gets a confirmation link —
    // see CLAUDE.md "MCP confirmation flow". This is the ONE write this
    // process ever performs: a McpProposalToken row (proposal-tracking
    // metadata), never an Ecriture/EcritureLigne. Posting itself only
    // ever happens from the web confirm page's own POST, triggered by a
    // human — never from this tool call or any other.
    if (name === PROPOSE_TOOL_NAME) {
      const confirmUrl = await mcpConfirmations.createToken(
        userId,
        company,
        outcome.value as ProposedEcriture,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ...(outcome.value as object), confirmUrl }, null, 2),
          },
        ],
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(outcome.value, null, 2) }] };
  });

  const transport = new StdioServerTransport();
  // connect() calls transport.start() internally, which attaches a
  // stdin listener — that listener alone keeps the event loop (and this
  // process) alive for as long as the MCP client keeps the pipe open.
  await server.connect(transport);
}

main().catch((err) => {
  // Logged to stderr, never stdout — stdout is the MCP JSON-RPC channel
  // itself, and anything written there that isn't a valid message would
  // corrupt the protocol stream for whatever client is talking to this
  // process.
  process.stderr.write(`[mcp-server] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
