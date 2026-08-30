# Invoicing — Factur-X rendering implementation spec

**Status: built and verified 2026-08-31.** The second pass of invoicing
Phase A — see `specs/invoicing-plan.md` (regulatory research) and
`specs/invoicing-phase-a-implementation-spec.md` (the generation +
ledger-posting engine this pass renders on top of). Produces a real
Factur-X 1.09 / EN16931 file (PDF/A-3 with the CII XML embedded) for a
FINALIZED invoice, verified against the **real official XSD and
Schematron EN16931 business rules** — not a hand-rolled approximation.
Frontend remains the next, still-unbuilt increment.

---

## The two decisions, resolved

### 1. Profile: EN16931 ("Comfort")

Confirmed directly from FNFE-MPE's own page
(`https://fnfe-mpe.org/factur-x/factur-x_en/`, fetched, current version
**Factur-X 1.09.2 / ZUGFeRD 2.5.2, published 2026-08-04**): five
profiles exist (MINIMUM, BASIC WL, BASIC, EN16931, EXTENDED).
**EXTENDED is explicitly "under construction, and will be published
later"** per that same page — not a real, complete option today.
EN16931 is therefore the fullest currently-published profile, and maps
directly onto the full EU semantic invoice model (mandatory mentions,
per-rate VAT breakdown, structured party/address data) this app's own
`InvoiceMentions` data already carries. No official DGFiP source was
found mandating a specific profile for the September 2026/2027 reform
itself (that's a PA/transmission-layer concern, out of scope for
generation-only Phase A) — EN16931 was chosen as the most complete,
real, currently-available option, not because a specific citation
requires it.

### 2. Library: `@stafyniaksacha/facturx`

Chosen over `node-zugferd` and `@deiz/facturx` after checking all
three's actual capabilities (not just package descriptions):
`@deiz/facturx` only supports the BASIC profile (ruled out — needed
EN16931); `node-zugferd`'s validation story was vague marketing copy
with no confirmed XSD/Schematron mechanism. `@stafyniaksacha/facturx`
(MIT, v0.6.1, confirmed via `npm view` to have **zero new
vulnerabilities** — all 9 pre-existing `npm audit` findings in this
repo trace to unrelated devDependencies, none to this package or its
6 direct dependencies) explicitly implements:

- **Real generation**: `generate({pdf, xml})` embeds CII XML into an
  existing PDF, producing PDF/A-3 bytes, via `pdf-lib` (added as an
  explicit direct dependency, pinned to the same `^1.17.1` this library
  uses, confirmed deduped to one instance via `npm ls`).
- **Real validation**: `check({xml, schematron: true})` validates
  against **the official 1.09 XSD** and, with `schematron: true`, the
  **EN16931 Schematron `BR-*` business rules** — genuine artifacts,
  confirmed by inspecting the installed package: real per-profile XSD
  directories (`dist/shared/xsd/facturx/{minimum,basicwl,basic,en16931,extended}`)
  and Schematron rules precompiled to XSLT via Saxon-JS (a real,
  established XSLT/Schematron engine, not a stub), returning
  `{valid, errors, schematronValid, schematronErrors}` — inspectable,
  not a black-box pass/fail.
- **No Java dependency** — pure npm/WASM (`libxml2-wasm`, `saxon-js`),
  which matters concretely: this sandboxed dev environment has **no
  JRE installed** (`java -version` → command not found), ruling out the
  Java-based Mustang Project / KoSIT validators used by the wider
  Factur-X community.

Field shapes in `invoice-to-cii.ts` are confirmed against the library's
own official example, `examples/Facture_FR_EN16931.xml` (fetched
directly from its GitHub repo, not derived from the raw UN/CEFACT spec
text or guessed from the TypeScript model signatures alone) — a wrong
required-field shape would only have surfaced as an opaque XSD failure.

---

## The mapping (`invoice-to-cii.ts`)

Pure(ish) function `buildCrossIndustryInvoice(mentions: InvoiceMentions):
Promise<CrossIndustryInvoiceType>` — reuses `InvoiceMentions` verbatim
as its input (the same object `invoicing.service.ts`'s `finalize()`/
`getMentions()` already produce and tie to the posted écriture), adding
no new business computation. Async only because of the ESM-interop
constraint below, not because the mapping itself does I/O.

- **`typeCode`**: `380` (invoice) or `381` (credit note) — UNTDID 1001,
  confirmed from the official example.
- **VAT category**: `S` (standard rate) only, this pass — see the
  explicit scope boundary below.
- **Unit code**: `C62` (UN/ECE Rec 20, "one"/piece) for every line —
  this app has no per-line unit-of-measure field, a stated
  simplification, not a guessed unit.
- **`toAmountNumber()`**: the one narrow, documented crossing from this
  app's `Decimal`-typed money into a plain `number` (the external
  library's typed model requires `number`, not `Decimal`/string) — the
  same class of narrow escape hatch as `Money.fromNumber()`/
  `moneyRatio()` elsewhere in this app, never a general license to use
  `Number()`/`parseFloat()` on money.

**Scope boundary, stated precisely, not silently dropped**: a
VAT-exempt line (`vatRatePercent === null`) makes
`buildCrossIndustryInvoice()` throw `NotImplementedException` rather
than guess a UNTDID 5305 VAT category code — several exist (E/exempt,
Z/zero-rated, G/export, O/out-of-scope, AE/reverse-charge) and which
one applies is a legal judgment this app's data doesn't capture (no
exemption-reason field exists on `InvoiceLine`). Only standard-rated
invoices can be rendered to Factur-X this pass. Verified live (see
below) — the guard throws with a clear message naming the offending
line.

---

## Two real bugs found and fixed before this was verified as working

### Bug 1 — an empty `ApplicableHeaderTradeDelivery` fails Schematron, not XSD

`HeaderTradeDeliveryType` has no required sub-fields, so an invoice
with nothing to say about delivery naturally produces
`new HeaderTradeDeliveryType({})` — structurally XSD-valid, but the
**Schematron rule PEPPOL-EN16931-R008** ("Document MUST not contain
empty elements") rejects the resulting empty `<ram:
ApplicableHeaderTradeDelivery/>` tag. Found live, not by inspection —
the first generation attempt's `preCheck.schematronValid` was `false`
with this exact rule id and message. Fixed by populating
`actualDeliverySupplyChainEvent` with the invoice's own issue date — a
defensible business default (this app has no separate delivery-date
field; a services invoice's delivery/service date commonly equals the
invoice date when nothing else is tracked), documented as a decision in
`invoice-to-cii.ts`'s own comment, not a silent fabrication.

### Bug 2 — `libxml2-wasm`'s Node file provider mishandles bare Windows paths

**Root-caused, not just worked around.** `check()`'s XSD validation of
the EN16931 profile failed with `"No such file or directory"` for
schema files that demonstrably existed
(`fs.existsSync()` confirmed `true` on the exact reported path).
Diagnosed by registering a throwaway `libxml2-wasm` input provider that
logs every filename it's asked to resolve — confirmed libxml2 was
requesting the exact correct path every time; the file was never
actually missing, only mis-detected.

The actual defect: `libxml2-wasm/lib/nodejs.mjs`'s `filePath()` helper
calls `new URL(filename)` on whatever string libxml2 hands it. A bare
Windows absolute path like `"C:/Users/.../schema.xsd"` is **not**
rejected by `new URL()` — the WHATWG URL grammar accepts any single
ASCII letter followed by `:` as a valid scheme, so
`new URL("C:/Users/...")` parses successfully with `protocol === "c:"`
(confirmed directly: `new URL(...).protocol` → `"c:"`, not an error).
Since `filePath()` only proceeds when `protocol === "file:"`, it
silently returns `null` for **every** bare Windows path, and the
provider reports the file as absent even though it's really there.
This is a genuine, verified upstream bug in `libxml2-wasm`'s own
Node-provider helper (not in `@stafyniaksacha/facturx`'s usage of it,
and not fixable by changing how `@stafyniaksacha/facturx` calls
`generate()`/`check()`) — consistent with the library's own test suite
explicitly excluding this exact code path from Windows coverage
(`/* c8 ignore next 3, Windows only, won't be covered on other
platforms */` in `nodejs.mjs`'s own source).

**Fix**: `src/common/libxml2-windows-path-fix.ts` registers an
*additional* `libxml2-wasm` input provider (multiple providers are
supported; confirmed live that the most-recently-registered one is
tried first) that matches a filename via a plain `fs.existsSync()`
check — never `new URL()` — and serves it via plain `fs.openSync()`/
`readSync()`/`closeSync()`. This purely *adds* coverage for the case
the built-in provider mishandles; `file://` URLs and POSIX paths still
resolve exactly as before, through the original provider. Gated to
`process.platform === 'win32'` — a no-op, never registered, on Linux/
Mac, where the bug doesn't manifest (confirmed the code path: on POSIX,
`new URL("/home/.../schema.xsd")` throws — no scheme before the first
`/` — so `filePath()`'s `catch` branch returns the filename unchanged,
which is exactly correct there). Must be registered *after*
`@stafyniaksacha/facturx`'s own `libxml2-wasm/lib/nodejs.mjs` import
(a side effect of loading the library), so this fix's provider is the
more-recently-registered, higher-priority one — documented and ordered
correctly in `factur-x.service.ts`.

**Reported as a genuine finding, not filed upstream this pass** —
recorded here so a future session doesn't waste time rediscovering it,
and so the fix isn't mistaken for defensive boilerplate and deleted.
Worth an upstream issue/PR to `libxml2-wasm` at some point; out of
scope for this pass.

---

## The ESM/CommonJS interop problem — a second, separate finding

`@stafyniaksacha/facturx` and `libxml2-wasm` are both **ESM-only**
(confirmed: attempting a static `import` of a value from either throws
`ERR_PACKAGE_PATH_NOT_EXPORTED`/`ERR_REQUIRE_ESM` once compiled to
CommonJS). This backend is CommonJS throughout
(`tsconfig.json`: `"module": "commonjs"`).

**A genuine dynamic `import()` does NOT solve this on its own** —
TypeScript, targeting `module: "commonjs"`, unconditionally rewrites
`import(specifier)` (even inside an `async` function, even at
`target: "ES2022"`) to `Promise.resolve().then(() => require(specifier))`,
which still calls `require()` and still fails. Confirmed live: a naive
`await import('@stafyniaksacha/facturx')` inside this project's own
`.ts` source threw the exact same `ERR_PACKAGE_PATH_NOT_EXPORTED` as a
static import — this is why CLAUDE.md's own existing pdfjs-dist note
("pdfjs-dist's Node worker fallback needs `--experimental-vm-modules`")
didn't fully explain what was happening here: pdfjs-dist's own dynamic
import lives inside an *already-compiled* `.js` file inside
`node_modules`, which Node loads directly, untouched by this project's
own tsc/ts-node transform — a NEW dynamic import written in this
project's own `.ts` source hits a different, worse problem (TypeScript
downlevels it before Node ever sees it).

**Fix**: `src/common/esm-interop.ts`'s `importEsm()`, using the
standard, documented workaround (see TypeScript issue #43329) —
`new Function('specifier', 'return import(specifier)')`. A `Function`
constructor's body is a plain string TypeScript's AST transform never
inspects, so the `import()` inside it survives to be evaluated by
Node's own parser as a genuine ESM dynamic import at runtime. Used by
both `invoice-to-cii.ts` (for the `Models` namespace, cached after
first load) and `factur-x.service.ts` (for `check`/`extract`/
`generate`/`invoiceToXml`).

**Jest limitation, found and accepted, not fought**: this fix works
under `ts-node` and the real running NestJS app (confirmed live, see
below) but **not under Jest** — `jest-environment-node` itself throws
`"A dynamic import callback was invoked without
--experimental-vm-modules"` for *any* real dynamic import, regardless
of how it was written; the eval-wrapped trick defeats TypeScript's
transform but not Jest's own VM sandbox. Enabling that flag
project-wide for one dependency was rejected for the same reason
CLAUDE.md's pdfjs-dist precedent already rejected it — disproportionate
to the gain. `factur-x.integration.spec.ts` keeps only the
ESM-independent guard test (VAT-exempt rejection) under Jest; the real
generation+validation proof is a `ts-node` smoke test, matching the
pdfjs-dist precedent's own discipline exactly ("proven... via a plain
`ts-node` smoke test... not inside Jest").

---

## Verification — two ways, then live through the real server

1. **A `ts-node` smoke test** (temporary, deleted after use — same
   discipline as every other one-off verification script in this
   project) generated a real two-rate SALE invoice (2×500,00€ HT@20% +
   3×100,00€ HT@10%) end to end:
   - `check({xml, schematron:true})` on the constructed XML, BEFORE
     embedding: `valid: true`, `schematronValid: true`, zero errors.
   - `generate()` produced a real PDF/A-3 file (9087 bytes).
   - `extract()` pulled the XML back OUT of that generated file, and
     `check()` on THAT extracted copy — the round-trip check, proving
     the embedding step itself didn't corrupt anything — also:
     `valid: true`, `schematronValid: true`, zero errors.
   - Repeated for a CREDIT_NOTE (`typeCode: 381`, `isCreditNote: true`)
     — same clean result both pre- and post-embed.
2. **`factur-x.integration.spec.ts`** — the VAT-exempt guard, under
   Jest (the one piece that doesn't touch the ESM dependency chain).
3. **Live, through the real running NestJS dev server** (not just
   `ts-node` in isolation) — the strongest proof, since it confirms the
   ESM-interop fix and the Windows libxml2-wasm fix both work inside
   the actual app, not just a standalone script: created and finalized
   a real SALE invoice on the FR demo company (1×1000,00€ HT@20% →
   `invoiceNumber "5"`), then `GET
   /invoicing/invoices/:id/factur-x` → **HTTP 200**, `Content-Type:
   application/pdf`, a real 8831-byte file saved to disk. Since
   `FacturXService.render()` internally throws `ConflictException`
   (→ HTTP 409) if EITHER the pre-embed or post-embed `check()` fails,
   the 200 response is itself live proof both validations passed — not
   an assumption. Separately confirmed the endpoint correctly refuses a
   DRAFT invoice (409, "Mentions are only available for a FINALIZED
   invoice") before ever reaching the renderer. Test invoice's écriture
   reversed/validated afterward, confirmed via the grand livre that the
   client account's cumulative test activity nets to exactly `0.00`;
   the `Invoice`/`InvoiceLine` test rows removed via a temporary
   script, same discipline as every other Phase A live-verification
   pass.

---

## Deferred, explicitly

- **The frontend** — no UI to trigger a download exists yet; the route
  is reachable only via direct API call (`GET
  /invoicing/invoices/:id/factur-x`).
- **A `basic`/`basicwl`/`minimum`-profile fallback** for a company that
  might not need the fuller EN16931 data — not built; every invoice
  targets EN16931 uniformly.
- **VAT-exempt line support** — an explicit, documented gap (see
  above), not silently dropped.
- **Filing the `libxml2-wasm` Windows bug upstream** — the fix lives in
  this app's own code (`common/libxml2-windows-path-fix.ts`); an
  upstream issue/PR would let this workaround eventually be removed,
  not attempted this pass.
- **Monaco** — still entirely blocked at `finalize()`, per Phase A's
  own design; nothing about this pass changes that.
