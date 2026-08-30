/**
 * A genuine, un-downleveled dynamic `import()` for loading an ESM-only
 * package from this CommonJS backend.
 *
 * TypeScript, when `module: "commonjs"` (this project's setting), always
 * rewrites a literal `import(specifier)` expression to
 * `Promise.resolve().then(() => require(specifier))` — even inside an
 * `async` function, even at target ES2022. That still ends up calling
 * Node's `require()`, which cannot load a pure-ESM package
 * (`ERR_REQUIRE_ESM`) — the exact class of incompatibility CLAUDE.md
 * already documents for pdfjs-dist, except pdfjs-dist's own dynamic
 * import lives inside an already-compiled JS file Node loads directly
 * (untouched by this project's own tsc/ts-node transform), so it never
 * hits this problem; a NEW dynamic import written in THIS project's own
 * `.ts` source does.
 *
 * `new Function(...)`'s body is a plain string TypeScript's AST
 * transform never inspects or rewrites, so the `import(specifier)`
 * inside it survives to be evaluated by Node's own parser as a real
 * ESM dynamic import — the standard, widely-documented workaround for
 * this exact CJS-importing-ESM scenario (see TypeScript issue #43329).
 * Used by `@stafyniaksacha/facturx` (ESM-only, see its own README) —
 * see invoicing/invoice-to-cii.ts and invoicing/factur-x.service.ts.
 */
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const realDynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<unknown>;

export async function importEsm<T>(specifier: string): Promise<T> {
  return realDynamicImport(specifier) as Promise<T>;
}
