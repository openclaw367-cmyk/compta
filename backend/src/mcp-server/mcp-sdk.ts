/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * The ONE file in this project that imports `@modelcontextprotocol/sdk`'s
 * deep subpaths via `require()` instead of a normal `import` — same
 * "one file owns the interop workaround, everything else uses ordinary
 * imports" discipline as `common/esm-interop.ts`, but for a different
 * underlying problem than that file solves.
 *
 * `@modelcontextprotocol/sdk` genuinely has a CommonJS build (confirmed
 * via its own package.json `exports` map and a direct `require()` probe
 * against `node_modules` — unlike `@stafyniaksacha/facturx`/
 * `libxml2-wasm`/`@nestjs/jwt`, this is NOT an ESM-only package), so
 * `require()` resolves every subpath used here correctly at runtime,
 * confirmed live. The obstacle is purely TypeScript's STATIC type
 * resolution: this project's `tsconfig.json` uses `module: "commonjs"`
 * with the implied `moduleResolution: "node10"` (classic) — required
 * everywhere else in this ~1000-file backend and NOT changed here, since
 * `node16`/`nodenext`/`bundler` resolution (the modes that DO honor a
 * package's `exports` map, which is what this SDK's subpath types need)
 * would force a module-emit-format change across the whole project, a
 * blast radius wildly disproportionate to one new local-only entrypoint.
 * Confirmed directly: `moduleResolution: "bundler"` requires `module` to
 * be `"preserve"`/ES2015+, and `"node16"`/`"nodenext"` require `module`
 * to match, so neither can be set without touching `module` itself.
 *
 * Fix: `require()` the three subpaths (untyped by TS, since a literal
 * string argument to `require` is never resolved as a module import the
 * way `import`/`import()` are) and cast each to a small, hand-written
 * local interface covering ONLY the members this project actually calls
 * — confirmed field-for-field against the SDK's own installed `.d.ts`
 * files before writing them (never guessed), not a full re-declaration
 * of the SDK's surface.
 */

export interface McpToolInputSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: McpToolInputSchema;
}

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpCallToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

export interface McpListToolsResult {
  tools: McpTool[];
}

export interface McpCallToolRequest {
  params: {
    name: string;
    arguments?: Record<string, unknown>;
  };
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpServerOptions {
  capabilities?: {
    tools?: Record<string, never>;
  };
}

export interface McpTransport {
  start(): Promise<void>;
  close(): Promise<void>;
}

/**
 * The subset of `@modelcontextprotocol/sdk/server`'s `Server` class this
 * project calls. Confirmed field-for-field against
 * `node_modules/@modelcontextprotocol/sdk/dist/cjs/server/index.d.ts`.
 */
export interface McpServer {
  setRequestHandler(requestSchema: unknown, handler: (request: unknown) => unknown): void;
  connect(transport: McpTransport): Promise<void>;
}

export interface McpServerConstructor {
  new (info: McpServerInfo, options?: McpServerOptions): McpServer;
}

export interface McpStdioServerTransportConstructor {
  new (): McpTransport;
}

const serverSdk = require('@modelcontextprotocol/sdk/server') as {
  Server: McpServerConstructor;
};
const stdioSdk = require('@modelcontextprotocol/sdk/server/stdio.js') as {
  StdioServerTransport: McpStdioServerTransportConstructor;
};
const typesSdk = require('@modelcontextprotocol/sdk/types.js') as {
  ListToolsRequestSchema: unknown;
  CallToolRequestSchema: unknown;
};

export const Server = serverSdk.Server;
export const StdioServerTransport = stdioSdk.StdioServerTransport;
export const ListToolsRequestSchema = typesSdk.ListToolsRequestSchema;
export const CallToolRequestSchema = typesSdk.CallToolRequestSchema;
