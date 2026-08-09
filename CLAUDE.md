# compta-fr-mc

Double-entry accounting suite for French and Monegasque companies: PCG chart of
accounts, FEC export (Article A47 A-1 du LPF), Excel journal import,
depreciation (amortissements), VAT (TVA), and liasse fiscale.

## Stack

- **Backend**: TypeScript, NestJS, PostgreSQL, Prisma ORM.
- **Frontend**: TypeScript/React + Vite + Tailwind v4, sharing request-DTO
  types with the backend via `import type` (erased at build — see
  `frontend/src/api/dto.ts`). Single-company UX (auto-selects the one
  company, no company picker) even though the data model is multi-tenant —
  see "Multi-tenant data model" below. The four core screens are built:
  journal entry grid (with inline tiers creation and a "Contre-passer"
  action on validated entries for extourne/contre-passation), tiers
  management, grand livre / trial balance, Excel import
  (preview-then-confirm), and FEC export. Five admin/setup screens are also
  built: fiscal-year management (create, close — surfaces the
  draft-écritures-remaining guard directly, plus a "Générer l'à-nouveau"
  action per year that posts and validates the opening-balance
  carry-forward écriture from its closed predecessor), company profile
  (view/edit — name, SIREN/RCI, jurisdiction, structured address), VAT
  rates management plus a CA3 declaration screen that computes and
  displays the basic French case (see "VAT / CA3 declaration" below —
  a read-only report, it never writes to the ledger), and a combined
  "Comptes & journaux" screen
  for creating journals and plain (non-tiers) PCG accounts. Immobilisations
  has its own two screens: an asset list (valeur brute / amortissements
  cumulés / VNC per asset) and a per-asset detail page showing the plan
  d'amortissement, where a "Comptabiliser la dotation" action posts each
  period's dotation as a real validated écriture. Liasse fiscale is the
  one remaining honest "non implémenté" placeholder, matching its backend
  stub status — nothing to build there until the backend logic exists.
- **Package manager**: npm.
- **Testing**: Jest (unit + e2e, NestJS default).
- **Validation**: `class-validator` / `class-transformer` on all DTOs.

Repo layout:

```
backend/     NestJS API
frontend/    React/Vite app (see "Frontend" above for what's built)
specs/       Compliance / functional specs (FEC, PCG, VAT, liasse references)
samples/     Sample files (e.g. real-world FEC exports, PCG account lists)
docs/        Compliance artifacts (e.g. Test Compta Demat reports)
```

## Local dev setup

1. A local PostgreSQL instance, reachable at the connection string in
   `backend/.env` (copy from `backend/.env.example`: database `compta_fr_mc`,
   user `compta`). There is no bundled Docker Compose file yet — this
   project currently develops against a native Windows install, service
   name `postgresql-x64-17`; point `DATABASE_URL` at whatever Postgres
   instance/service you run locally.
2. `cd backend && npm install`
3. `npx prisma migrate dev` — applies `backend/prisma/migrations/` (the
   `20260711170231_init` baseline plus `20260801195325_add_company_address`
   and `20260802175438_add_fixed_asset_cession_fields`)
   and runs `npm run seed` automatically via the `prisma.seed` config in
   `package.json`. Run `npm run seed` on its own to re-seed without a
   migration. On Windows, `prisma generate` can fail with `EPERM` renaming
   `query_engine-windows.dll.node` if the dev server is running and holds
   the file open — stop `npm run start:dev` first, regenerate, then
   restart it.
4. `npm run start:dev` — watch-mode NestJS server. Seeding gives you a demo
   company (SIREN `123456789`), its 2026 fiscal year, the standard PCG
   accounts, and the five standard journals (AC, VE, BQ, OD, AN) to exercise
   the API against.
5. API docs are served at `/docs` (Swagger UI), deliberately not `/api`
   since that's the REST prefix. `/docs` loads without any tenant context —
   see the middleware note below for why that's safe.

## Multi-tenant data model — non-negotiable

The product is used as a single-company tool today, but the schema and
service layer must be multi-tenant from day one so enabling multi-company
later is a feature flag, not a migration:

- Every domain table carries a `companyId` (the tenant / "dossier") foreign
  key. There is no domain table that is implicitly global.
- **No repository/service method may query or write domain data without an
  explicit company scope.** Do not add a "trust me, there's only one company"
  shortcut anywhere, including scripts and seeds.
- The service layer receives company context explicitly (a `CompanyContext`
  passed in, not read from ambient global state), so the same service code
  works unchanged when a company picker is added later.
- Controllers resolve the active company from the request (header/session)
  via a single shared mechanism (`CompanyContextMiddleware` /
  `@CurrentCompany()`), never by re-deriving it ad hoc per controller.
- Uniqueness constraints (account numbers, journal codes, entry sequence
  numbers, etc.) are scoped **per company**, not global.
- `CompanyContextMiddleware` is wired up in `app.module.ts` via an explicit
  `forRoutes(...)` allowlist of domain controllers, not a wildcard
  `forRoutes('*')`. Two reasons: Express 5's `path-to-regexp` no longer
  accepts a bare `'*'` wildcard, and Swagger (`SwaggerModule.setup('docs', ...)`)
  registers its routes directly on the underlying HTTP adapter rather than as
  a Nest controller, so it was never reachable by Nest middleware routing in
  the first place — there's no exclusion to configure for it. When a new
  domain controller is added, it must be added to that allowlist explicitly
  or its routes will run with no company context resolved.

## Money handling — hard rule, non-negotiable

**A JavaScript `number` must never hold a monetary value.** Not in the
domain layer, not in DTOs, not in the UI, not in a "just for display"
helper, not in a test fixture that pretends to be temporary.

- Database: every monetary column is `NUMERIC(15,2)`. Never `FLOAT`,
  `DOUBLE PRECISION`, or `REAL`.
- Prisma: every monetary field is typed `Decimal` (Prisma's `Decimal.js`
  wrapper), mapped from `NUMERIC(15,2)`. Arithmetic on money uses the
  `Decimal` API (`.plus()`, `.minus()`, `.times()`, `.equals()`, ...), never
  native `+ - * /` on a value that originated from a `Decimal`.
- API boundary: monetary values are **serialized as strings** in JSON
  request/response bodies (e.g. `"1234.56"`), never as JS numbers. DTOs use
  a `Decimal`-aware validator/transformer, not `@IsNumber()`.
- Frontend: money is a string everywhere — API responses, component
  props, form state — never a JS number. `frontend/src/lib/money.ts` does
  all formatting and summing via string/BigInt operations
  (`formatMoneyFr`, `addMoneyStrings`, `subtractMoneyStrings`); no
  `Number()`/`parseFloat()` ever touches an amount.
- Enforcement: an ESLint rule (`backend/eslint-rules/no-float-money.js`,
  wired into `eslint.config.mjs`) flags arithmetic operators applied to
  values typed or named as money outside the `Decimal` API. Unit tests in
  `src/common/decimal/*.spec.ts` assert that ledger balancing logic rejects
  float contamination (e.g. a plain `number` passed where a `Decimal` is
  expected must fail construction, not silently coerce).
- If a change looks easier by reaching for a `number` "just this once" for a
  monetary value, that's a signal the design is wrong, not that the rule
  should bend.

## Ledger integrity — hard compliance rules

These map directly to French statutory bookkeeping requirements
(Code de commerce, art. L123-12 s., and Article A47 A-1 du LPF for FEC).
Treat them as invariants enforced in the service layer, not conventions
enforced by code review:

1. **Every journal entry (écriture) balances.** `sum(debit lines) ===
   sum(credit lines)` for the entry, checked with `Decimal`, before it is
   persisted. No écriture is ever partially written.
2. **Sequential, gapless numbering.** Each écriture gets a company-scoped,
   strictly sequential `ecritureNum` with no gaps and no reuse, assigned at
   validation time in creation order. Never renumber on delete — deletion
   of a validated entry is not allowed (see immutability below).
3. **Immutability after validation.** Once an écriture is validated
   (`validDate` set — typically at period close), it can never be edited or
   deleted. Corrections happen via a new reversing/offsetting entry
   (extourne / contre-passation) that references the original — reachable
   from the journal grid via the "Contre-passer" action on a validated
   row, not just `POST /entries/:id/reverse` directly. Draft (unvalidated)
   entries, e.g. freshly imported from Excel, may still be edited before
   validation.
4. **One posting side per line.** A journal entry line has either a debit
   or a credit amount, never both, and the amount is always positive.
5. **Chart of accounts (PCG) structure.** Account numbers follow the Plan
   Comptable Général class structure (class 1 capitaux, 2 immobilisations,
   3 stocks, 4 tiers, 5 financiers, 6 charges, 7 produits, 8 comptes
   spéciaux). Account creation validates the leading digit against a known
   class; unclassifiable accounts are rejected, not silently accepted.
6. **A closed fiscal year rejects new or mutated écritures.** Enforced by
   `assertFiscalYearOpen()` (`src/common/ledger/assert-fiscal-year-open.ts`),
   shared by `EntriesService` (create/update/reverse) and
   `ImportExcelService` — one check, every posting path, not a rule each
   service remembers independently.
7. **A fiscal year cannot be closed while it still has draft écritures.**
   `FiscalYearsService.close()` counts unvalidated écritures first and
   refuses (naming the count) rather than closing around them — otherwise
   rule 6 would leave those drafts permanently stuck, neither editable nor
   postable.

## FEC export (Article A47 A-1 du LPF)

The FEC (Fichier des Écritures Comptables) is the mandatory tax-audit
export for French companies. Implementation lives in `src/modules/fec/`
and must stay byte-for-byte compliant with the legal spec. The primary
source is `specs/LEGIARTI000027804775_Article_A47_A-1_LPF.md` (fetched
from legifrance.gouv.fr) — the BOI-CF-IOR-60-40-20 document also in
`specs/` is DGFiP commentary on this article, not the article itself, and
its own illustrative tables use inconsistent field orderings from example
to example; don't treat those as authoritative for column order.

- **18 columns, exact order, exact header names** (Article A47 A-1 §VII):
  `JournalCode`, `JournalLib`, `EcritureNum`, `EcritureDate`, `CompteNum`,
  `CompteLib`, `CompAuxNum`, `CompAuxLib`, `PieceRef`, `PieceDate`,
  `EcritureLib`, `Debit`, `Credit`, `EcritureLet`, `DateLet`, `ValidDate`,
  `Montantdevise`, `Idevise`. Pinned by a literal (non-DRY-on-purpose)
  hardcoded list in `fec-format.spec.ts` so an accidental reorder of
  `FEC_COLUMNS` fails a test instead of drifting silently.
- **Delimiter**: `|` (pipe). One line per écriture line, plus a header row.
- **Dates**: `AAAAMMJJ` (`YYYYMMDD`), no separators.
- **Amounts use a decimal COMMA, not a point** (Article A47 A-1 §XII —
  "comma as the decimal separator, no thousands separator"). This is the
  opposite of the JSON API boundary convention. `Money.toFecString()`
  emits the comma form (`"1234,56"`); `Money.toApiString()` (decimal
  point, `"1234.56"`) is for the JSON API only — never use one where the
  other belongs. `formatFecAmount()` in `fec-format.ts` always calls
  `toFecString()`.
- **PieceRef/PieceDate must never be blank**, even when an écriture has no
  natural supporting document (Article A47 A-1 §180/§190 commentary —
  distinct from the "blank if unused" rule that applies to
  EcritureLet/DateLet/Montantdevise/Idevise/CompAuxNum/CompAuxLib). Use the
  documented conventional values: `"NA"` for PieceRef, the écriture's own
  EcritureDate for PieceDate. These conventions are declared in the
  accompanying description file produced by
  `FecExportService.generateDescription()` (required by Article A47 A-1
  §XI) — if you add another conventional fallback anywhere in the export,
  it must be documented there too.
- **EcritureNum is a `String`, not an `Int`.** Article A47 A-1 §100
  (via BOI commentary) allows either one continuous numeric sequence for
  the whole file or a per-journal sequence, and the per-journal scheme is
  commonly alphanumeric (e.g. `AN0001`). This project currently implements
  only the single global sequence, assigned from `Company.nextEcritureNum`
  — **never derive "next number" by sorting existing `ecritureNum` values**
  once the column is a string (lexical sort puts `"10"` before `"2"`).
  Export ordering uses `validatedAt` ascending for the same reason.
- **File name**: `{SIREN}FEC{ClotureDate:YYYYMMDD}.txt`, e.g.
  `123456789FEC20261231.txt`. The company record must have a valid SIREN to
  export.
- **Only validated écritures are exportable — and this blocks the whole
  export, not just the drafts.** If any écriture in the fiscal year is
  still a draft, `FecExportService.generate()` throws a
  `ConflictException` naming the count; it never silently exports the
  validated subset and skips the rest. This was learned the hard way
  once already: the FEC export screen's first draft assumed drafts would
  just be *excluded* and left "Générer" clickable, which meant clicking
  it just threw. `FecExportPage` now counts drafts client-side (from the
  already-fetched écritures list) and disables Generate while any exist,
  with copy that says "blocks", not "excludes" — if you touch that
  screen, keep those in sync with this rule rather than re-deriving it.
- **Any new file-download endpoint needs `exposedHeaders` in CORS, not
  just a `Content-Disposition` header.** `Content-Disposition` isn't in
  the browser's default CORS-safelisted header set, so
  `response.headers.get('Content-Disposition')` silently returns `null`
  in frontend code unless the backend's `app.enableCors()` call in
  `main.ts` explicitly exposes it. Already fixed for the two `/fec/*`
  download routes; a future download endpoint (e.g. a liasse PDF) needs
  the same header added to that `exposedHeaders` array, not a new CORS
  config.
- Field-name and column-order changes are compliance-breaking. Any change
  to `src/modules/fec/fec-export.service.ts`'s output shape requires a
  matching update to the fixture tests in `src/modules/fec/*.spec.ts`
  before merging — never adjust the test to match new output without
  re-checking it against `specs/LEGIARTI000027804775_Article_A47_A-1_LPF.md`.

## VAT / CA3 declaration

`src/modules/vat/` computes a French CA3 (régime réel normal — cerfa
n°10963*31) for a period, basic case only. Built the same way as FEC:
against the primary sources in `specs/`, not from memory. Full line
spec, account-mapping table, and Monaco inventory are in
`specs/vat-ca3-implementation-spec.md`; this section records the facts
that must never be re-derived from memory or re-litigated without
re-checking the source, because this exact mapping was independently
misstated twice during development before being pinned down here.

- **Account-to-ligne mapping — confirmed against the form and PCG text,
  not assumed:**
  - `445662` ("TVA déductible sur immobilisations", per
    `backend/prisma/seed.ts`) → **ligne 19**, verbatim form label
    *"Biens constituant des immobilisations"* (`specs/3310-ca3-sd_5377.pdf`,
    Cadre B, case 0703).
  - `445660` ("TVA déductible sur autres biens et services") → **ligne
    20**, verbatim form label *"Autres biens et services"* (same source,
    case 0702).
  - Cross-checked against the PCG itself (`specs/Reglt 2014-03_Plan
    comptable general.pdf`): account class `4456` "Taxes sur le chiffre
    d'affaires déductibles" subdivides into `44562` "TVA sur
    immobilisations" and `44566` "TVA sur autres biens et services" —
    this app's `445662`/`445660` are its own 6-digit numbering, not a
    literal extension of the PCG's 5-digit codes, but they carry the
    same category split (immobilisations vs. autres biens et services)
    and route the same way.
  - Implemented in `ca3-declaration.ts`: `DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT
    = '445662'` feeds `ligne19`; `DEDUCTIBLE_AUTRES_ACCOUNT = '445660'`
    feeds `ligne20`. If you touch this routing, re-check it against the
    form image (render `specs/3310-ca3-sd_5377.pdf` and read the printed
    label next to the line number), not against this file's prose or
    any prior conversation summary.
- **Rate tracking**: `EcritureLigne.vatRateId` (nullable FK to
  `VatRate`), tagged at entry time on both a collectée line (a `4457x`
  account) and its corresponding revenue line (PCG class 7) — one
  line-level tag drives both the collectée-by-rate and the
  base-HT-by-rate aggregation, rather than proliferating rate
  sub-accounts. `EntriesService` validates a tagged `vatRateId` belongs
  to the company, same rule as every other reference. No accounts exist
  for TVA à décaisser/crédit à reporter yet — those are declaration
  *outputs*, not ledger reads; whether/how the result later gets posted
  as a liquidation écriture is separate, later work (same shape as
  `DepreciationService.generateSchedule()` vs. `postDotation()`).
- **Four implemented rates**: 20 %, 10 %, 5,5 % (lignes 08/9B/09), plus
  **T6 (2,1 % France continentale)** — structurally a "taux particulier"
  on the real form, deliberately implemented anyway since it's a common
  mainland rate (presse, médicaments), not a territorial/exotic one.
  DOM, Corse, produits pétroliers, and the rest of "taux particuliers"
  are not implemented — `computeCa3Declaration()` throws naming the
  unmapped rate rather than silently dropping or misbucketing it.
- **Ligne 25 (crédit) vs. ligne TD (due)**: `ligne25 = ligne23 − ligne16`
  when 23 > 16; `ligneTD = ligne16 − ligne23` when 16 ≥ 23. **Not**
  "16 − 24" — 24 is a memo sub-line of 23, never itself subtracted. Get
  this from the rendered form (Cadre B, "TVA due ou crédit de TVA"), not
  from recollection.
- **Rounding**: nearest euro, fractions <0,50 dropped, ≥0,50 rounded up
  — identical rule independently confirmed on both the French notice
  (`specs/3310-ca3-sd_5047.pdf`) and the Monaco notice (Ordonnance
  Souveraine n°13.844, `specs/Monaco notice TVA.pdf`). Applied only at
  each declaration-line boundary, from full-precision internal sums —
  never applied to a ledger value, and never derived from another
  already-rounded output figure.
- **Guards, all throw rather than guess**: a collectée line with no
  `vatRateId`; a `vatRateId` resolving to a rate outside the four
  implemented; a `4456x` account that isn't exactly `445660`/`445662`;
  any bucket landing negative (the notice is explicit: *"Ne jamais
  indiquer de sommes négatives"*); any draft écriture dated within the
  requested period (mirrors `FecExportService.generate()`'s
  draft-blocking rule).
- **Monaco is a separate declaration, not a CA3 variant — see "VAT /
  Monaco declaration (Case B)" below.** Two distinct cross-border cases,
  kept strictly separate (per `specs/vat-ca3-implementation-spec.md`
  §4b): **Case A** — a *French*-jurisdiction entity with some
  Monaco-destined operations still files the French CA3, with a memo
  sub-line (ligne 18, *"Dont TVA sur opérations à destination de
  Monaco"*) reserved for it — **documented in the spec but not yet
  implemented**; `ca3-declaration.ts` has no `ligne18` today. **Case
  B** — a *Monaco*-jurisdiction (`Company.jurisdiction === 'MC'`)
  entity files its own Monegasque DSF declaration, a genuinely
  different form with different line numbers — **implemented**, see
  below.
- **Everything else deferred**: AIC/imports beyond the informational
  lines, groupe TVA / assujetti unique, régularisations, annexe 3310-A
  (taxes assimilées), accise sur les énergies (a different tax bundled
  onto the same form, not VAT at all), réel simplifié / CA12 (a
  different form).
- **Verified two ways, not just unit-tested.** `ca3-declaration.spec.ts`
  has a hand-computed-oracle test suite (`computeCa3Declaration()` is a
  pure function, no I/O — build a dataset, work out the expected CA3 by
  hand, assert every line). Separately, `backend/prisma/seed-sample.ts`
  carries a real, rate-tagged April 2026 dataset (two ventes at 20 %/10 %,
  one immobilisation achat, one autres-biens achat) with the expected
  result worked out in a comment above `SAMPLE_VAT_RATES` — calling
  `POST /vat/declaration` with `periodStart: "2026-04-01"`,
  `periodEnd: "2026-04-30"` against the real dev DB reproduced that
  comment's numbers exactly (ligne 16 = 250.00, ligne 23 = 150.00, ligne
  TD = 100.00). The original `SAMPLE-VE-0001`/`0002` lines are
  deliberately left untagged (no `vatRateId`) — not an oversight, a
  permanent demonstration that the untagged-collectée-line guard
  actually refuses real historical data rather than silently passing it.
- **Guards must throw a NestJS exception, never a plain `Error`.** Found
  live while verifying the declaration screen: `ca3-declaration.ts`'s
  guards originally used `throw new Error(...)`, which Nest's default
  exception filter collapses into a generic 500 "Internal server error"
  — the actual guard message never reached the client, so the screen
  showed a blank/unhelpful error instead of the real problem. Fixed to
  `BadRequestException`/`ConflictException`, matching the pattern
  already established in `fixed-asset-invariants.ts`. If you add a new
  guard anywhere in this "pure function, no I/O" style, throw a real
  `@nestjs/common` exception class — importing it doesn't compromise the
  "pure" claim (no I/O happens), and a plain `Error` here is a silent-500
  bug waiting to happen.

## VAT / Monaco declaration (Case B)

`src/modules/vat/monaco-declaration.ts` computes the Monegasque DSF
declaration (basic case) for a Monaco-jurisdiction company filing its
own return — Case B above, distinct from Case A's not-yet-built ligne
18 memo line on the French CA3. Full line spec, three-bucket divergence
table vs. France, and account-mapping analysis are in
`specs/vat-monaco-implementation-spec.md`; built against that document's
primary sources (the actual DSF form + its notice), never inferred from
the French form or "the convention probably says."

- **Jurisdiction drives both the account structure and the declaration
  module — one switch, `Company.jurisdiction` (`FR`|`MC`).**
  `VatService.computeDeclaration()` looks up the company, then branches:
  `FR` → `computeCa3Declaration()`, `MC` → `computeMonacoDeclaration()`,
  anything else throws `NotImplementedException`. This closed a real gap
  — the method previously had no jurisdiction check at all and would
  silently compute a French CA3 for a Monaco company.
- **Account scheme: Monaco reuses the same account numbers as France**
  (`445710` collectée, `445662` immobilisations déductible, `445660`
  autres-biens déductible) — same numbers and labels, not a parallel
  Monaco-specific chart. This is safe because the scoping is per
  company, not global: an MC-jurisdiction company only ever has its own
  accounts (seeded by `backend/prisma/seed-monaco.ts`, sharing
  `PCG_ACCOUNTS`/`JOURNALS` from `backend/prisma/pcg-accounts.ts` with
  the FR seed), so there's no collision — a given `445710` row always
  belongs to exactly one company, whichever jurisdiction it's in.
  `computeCa3Declaration()` is untouched by any of this; the FR path
  reads the same accounts it always did.
- **Four rates implemented, same as the CA3 side**: the three named on
  ligne 32 (5,5 % réduit, 10 % intermédiaire, 20 % normal) **plus 2,1 %
  via ligne 30.** Ligne 31 ("anciens taux") stays deferred — no taxonomy
  for what it contains is shown in either Monaco document.
  - **The 2,1 % rate was dropped once, then corrected — don't
    re-litigate this without re-reading the source.** An earlier pass
    concluded 2,1 % was unconfirmed for Monaco because the form has no
    pre-printed 2,1 % line the way France names T6. That reasoning
    conflated *how* a rate is declared with *whether* it exists: ligne
    30 reads *"Taux particuliers ___%"* — a blank, fillable field,
    Monaco's generic slot for a non-standard rate, functionally
    equivalent to France giving each taux particulier its own named
    sub-line instead of one blank one. Monaco's rate set is confirmed
    to include 2,1 % (presse, médicaments, same as France, under the
    1963 Franco-Monégasque convention — see "Monaco compliance"
    below). **Do not drop a rate just because a given form variant
    doesn't print a dedicated line for it** — check whether it's
    declared through a generic field first.
- **Verified two ways, same discipline as the CA3.** Hand-computed
  oracle in `monaco-declaration.spec.ts` covering all four rates
  together (ligneB1/ligne48 assembled from all four buckets, not just
  the three named ones). Separately, live-verified against the seeded
  Monaco demo company (`seed-monaco.ts`): a real 2,1 %-tagged, validated
  écriture reported correctly under `ligne: "30"` and fed `ligneB1`/
  `ligne48`, via `POST /vat/declaration` against the real dev DB — not
  just the unit test. Test data was cleaned up afterward (temp Prisma
  script pattern, same as the CA3 verification).
- **Open items, not yet resolved from the documents** (see
  `specs/vat-monaco-implementation-spec.md` §4c/§7 for the full list):
  - **"TMP" (ligne 49, taxes assimilées)** — undefined in both the form
    and the notice; full name and computation basis unknown.
  - **"Acomptes provisionnels" (ligne 52)** — referenced but not
    explained by either source.
  - **Filing-frequency mechanics.** Monthly is the general/default
    filing case; quarterly or annual are requested exceptions (the
    notice ties this to an annual-VAT-due threshold). The exact
    administrative mechanics of qualifying for or requesting the
    exception — and how that reconciles with the example form's own
    period field reading "AN" (apparently annual) — are not confirmed
    from the documents themselves. Treat as open, not settled.
  - **The cross-border/account-mapping line was never fully resolved.**
    Whether a Monaco-jurisdiction company's declaration needs its own
    equivalent of France's Case A ligne-18 memo line (for the mirror
    case: Monaco entity with French-destined activity) isn't addressed
    by either Monaco source document — neither confirmed present nor
    confirmed absent. Don't assume symmetry with Case A without a cited
    source.
- **Everything else deferred**, same categories as the CA3 side where
  applicable: régularisations, groupe TVA / assujetti unique equivalent,
  Cadre C (lignes 70-75, supplier-origin breakdown of déductible TVA —
  informational only per the form's own note, doesn't feed B1/B2/B3/48).

## Known scope boundaries

Things that are deliberately incomplete right now — not bugs, but don't
assume they're covered either:

- **FEC structural validation: passed once, on a sample dataset — not a
  blanket clearance.** On 2026-08-01, the export for the demo company's
  FY2026 (SIREN `123456789`, `123456789FEC20261231.txt`) was run through
  DGFiP's official **Test Compta Demat v1_00_10b** validator. The sample
  dataset covered all five journals (AC, VE, BQ, OD, AN), a lettered pair
  (EcritureLet/DateLet), and a reversal (contre-passation) — see
  `backend/prisma/seed-sample.ts`. Result: structurally conforme to
  Article A.47 A-1 du LPF, all 18 fields detected with the expected names
  in the expected order, no extra fields. Report saved at
  `docs/compliance/rapport_123456789FEC20261231_test-compta-demat_1_00_10b.pdf`.
  Per the tool's own disclaimer, this checks file *structure* only — it
  "ne présage pas de la régularité de la comptabilité, ni de sa valeur
  probante" and isn't an official attestation of compliance. It also
  doesn't cover every shape of data this module can produce (e.g. a real
  filing's volume, edge-case account numbers, or a Monaco company) — treat
  each materially different dataset as needing its own run, not covered
  by this one.
- **Frontend has no screen for liasse fiscale** — deliberately: see
  "Stack" above. There's nothing to build there until the backend stub
  below is implemented; the nav entry is an honest "non implémenté"
  placeholder, not a faked screen. VAT is further along: rate management
  and a CA3 declaration report screen are both real (`VatPage`),
  computing and displaying the basic French case (see "VAT / CA3
  declaration" above) — read-only, it never posts to the ledger — and
  the journal entry grid can tag a line with a rate.
- **Liasse fiscale (`src/modules/liasse/`) is a stub** — throws
  `NotImplementedException`, not a plausible-looking fake computation.
  Don't build on top of it assuming real logic exists. VAT's
  `computeDeclaration()` is no longer a stub for either jurisdiction —
  it branches to `computeCa3Declaration()` (FR) or
  `computeMonacoDeclaration()` (MC) — but each only covers its own
  basic case; see "VAT / CA3 declaration" and "VAT / Monaco declaration
  (Case B)" above for exactly what's deferred on each side (taux
  particuliers beyond T6/2,1 %, AIC/imports, groupe TVA,
  régularisations, annexe 3310-A on the FR side; TMP, acomptes
  provisionnels, filing-frequency mechanics, and the cross-border
  memo-line question on the MC side).
- **No delete/deactivate endpoint exists for `Journal`, `Account`,
  `VatRate`, or `FiscalYear`.** Each has create + list (+ close, for
  FiscalYear), nothing more — discovered directly while building their
  admin screens, when cleaning up test data required a raw Prisma script
  instead of the API. `Account` and `Journal` also have no update beyond
  `Account.rename()`. If a future screen needs to remove or correct one
  of these, that's new backend work, not existing-but-unwired UI.
- **`VatPage.tsx` only renders the CA3 shape — it doesn't handle Monaco
  yet.** The frontend declaration screen is typed and hardcoded to
  `Ca3Declaration` (`ligne16`/`ligne19`/`ligne20`/`ligne23`/`ligne25`/
  `ligneTD`, ...); `computeMonacoDeclaration()`'s response uses different
  field names entirely (`ligneB1`/`ligne44`/`ligne45`/`ligneB2`/`ligne48`,
  ...). Pointing this screen at an MC-jurisdiction company today would
  render `undefined` values, not a correct Monaco declaration — the
  backend computation is done and verified (see "VAT / Monaco
  declaration (Case B)" above), the frontend consumption of it is not.
  New work, not existing-but-unwired UI.
- **Monaco rules are largely unverified, VAT (Case B) is the exception.**
  See "Monaco compliance" below. Nothing Monaco-specific should be
  treated as settled without a cited source — with the narrow exception
  of "VAT / Monaco declaration (Case B)" above, which is built and
  verified against Monaco's own primary documents. That section's own
  "open items" list still applies; verified doesn't mean complete.
- **Article A47 A-1 §VIII** (simplified/micro-BIC reporting variants) has
  not been cross-checked against `src/modules/fec/`. Everything else in
  the FEC section above has been verified against
  `specs/LEGIARTI000027804775_Article_A47_A-1_LPF.md`; §VIII specifically
  has not.
- **Immobilisations: cession, dégressif, and the 2054/2055 report
  structure are still deferred.** `FixedAsset` has `cessionDate` /
  `cessionPrice` columns so disposal doesn't need a schema retrofit later,
  but no cession logic exists yet (plus/moins-value computation, posting
  the disposal écriture) — both fields stay null and there's no DTO/UI
  surface for them. `DepreciationMethod.DECLINING` (dégressif) still
  throws `NotImplementedException` in `generateSchedule()`; only linéaire
  is computed. The tableau des immobilisations / tableau des
  amortissements reports — which double as liasse forms 2054/2055 —
  haven't been designed yet; that happens once the liasse work starts
  (roadmap item 2 below), against real field needs from the now-built
  list/schedule screens rather than guessed in advance. What *is* done
  (as of 2026-08-02): `DepreciationService.postDotation()` posts a
  period's dotation (débit compte 681x / crédit compte 28x) through the
  normal `EntriesService.create()`/`validate()` layer — no privileged
  write path — and sets `DepreciationEntry.postedEcritureId`; VNC on the
  list/detail screens is computed from posted entries only, so it ties to
  the bilan rather than the projected schedule. This closes what was
  previously logged here as "depreciation never posts to the ledger."
- **`EcritureLigne.dateLettrage` isn't settable through the API.**
  `lettrage` (EcritureLet) is exposed on `CreateEcritureLigneDto` and
  settable at line-creation time, but there's no lettering
  endpoint/DTO field for `dateLettrage` (DateLet) — the only way to set it
  today is a direct Prisma write (see `backend/prisma/seed-sample.ts`).
- **No way to list or inspect past Excel import batches.**
  `ImportExcelController` only exposes `POST /import-excel`; there's no
  `GET` for `ImportBatch` records, so past imports are only visible
  indirectly via the écritures they created. Relatedly, `ImportStatus.FAILED`
  is defined in the schema but never persisted — a parse failure throws
  before any `ImportBatch` row exists, so nothing is ever written as
  `FAILED` today.

## Current state & roadmap

**Where things stand (as of 2026-08-02):** the four core frontend screens
are done — journal entry grid (with inline tiers creation and entry
reversal), tiers management, grand livre / trial balance, Excel import
(preview-then-confirm), and FEC export. FEC has passed one structural
validation run against DGFiP's Test Compta Demat (see "Known scope
boundaries" above — one sample dataset, not a blanket clearance). Five
more UI gaps identified in a full frontend/backend coverage audit have
since been closed, each wiring an already-working backend endpoint to a
new screen: entry reversal (contre-passation), fiscal-year management
(create/close), company profile (view/edit, including new structured
address columns on `Company`), VAT rates management, and journal/basic
PCG account creation. Ledger integrity guards are in place at the service
layer: closed-fiscal-year rejection, refusal to close a year with draft
écritures, drafts-only deletion (`EntriesService.remove()` guards against
deleting a validated entry), and FEC export blocking entirely (not
partially) while any draft exists — all now reachable from the UI, not
just the API.

Three more bookkeeper-workflow gaps from that same audit are now closed
end to end. **À-nouveau** (`src/modules/a-nouveau/`) generates and
validates, in one action, the opening-balance carry-forward écriture for
a fiscal year from its closed predecessor — classes 1-5 carried
account-by-account and tiers-by-tiers, classes 6-7 reset and folded into
120/129 unaffected. Exact-to-the-centime by construction and tested
that way (`a-nouveau.service.spec.ts`): the generated block's débit
must equal its crédit or the service throws rather than posting an
unbalanced à-nouveau, and per-account carried amounts are asserted
against the prior year's exact closing balances, not an approximation.
Reachable from the fiscal-year management screen.

**Immobilisations** (`src/modules/depreciation/`) now has a full front
half (asset list, per-asset plan d'amortissement) and closes the
previously-logged "depreciation never posts to the ledger" gap: dotations
post through the normal entries validation layer and VNC is computed
from posted entries only — see "Known scope boundaries" above for what's
still deferred there (cession, dégressif, the 2054/2055 report
structure).

**VAT (TVA)** — `computeDeclaration()` is no longer a stub: it computes
and now also *displays* a real CA3 for the basic French case (`VatPage`'s
new declaration section, see "VAT / CA3 declaration" above), backed by
a new `EcritureLigne.vatRateId` rate-tracking field and an entry-grid
rate selector. The account-to-ligne mapping (445662 → ligne 19 "Biens
constituant des immobilisations", 445660 → ligne 20 "Autres biens et
services") is confirmed against the rendered CA3 form and the PCG
regulation text, not memory — see "VAT / CA3 declaration" above before
ever touching that routing again. The guard that refuses an untagged
TVA collectée line is real and demonstrated on purpose in the seed
sample data, not just theoretical.

**Monaco VAT (Case B)** is also done and verified (as of 2026-08-09) —
see "VAT / Monaco declaration (Case B)" above. `Company.jurisdiction`
now drives both the account structure and the declaration module:
`VatService.computeDeclaration()` branches FR → `computeCa3Declaration()`,
MC → `computeMonacoDeclaration()` (closing a real gap — it previously had
no jurisdiction check and would silently run the French CA3 for a Monaco
company). Monaco reuses the same account numbers as France
(`445710`/`445662`/`445660`), company-scoped so there's no collision;
the FR CA3 path is confirmed untouched. `computeMonacoDeclaration()`
implements four rates (5,5 %/10 %/20 % on ligne 32, plus **2,1 % via
ligne 30** — a rate dropped in an earlier pass and then corrected, see
that section for why), verified both by a hand-computed oracle covering
all four rates and by a live run against the seeded Monaco demo company
(`seed-monaco.ts`). Open items (TMP, acomptes provisionnels,
filing-frequency mechanics, the cross-border memo-line question) are
listed in that section and in `specs/vat-monaco-implementation-spec.md`
— not yet resolved from the source documents.

Liasse fiscale remains a stub — see "Known scope boundaries" below for
that and the other logged gaps (`dateLettrage` not API-settable, no
import-batch listing endpoint, no delete/deactivate on Journal/Account/
VatRate/FiscalYear, Article A47 A-1 §VIII uncross-checked).

**Build order for what's next**, roughly in priority:

1. **Liasse fiscale** — currently a stub (`src/modules/liasse/`). Includes
   designing the tableau des immobilisations / tableau des amortissements
   (forms 2054/2055) against the immobilisations module's real fields,
   now that it exists, rather than guessing the structure in advance.
2. **Cash flow statement**, plus bilan and compte de résultat if the
   liasse work above doesn't already cover them.
3. **Financial analysis** — ratios, free cash flow, and a DCF as an
   assumptions-driven model (explicit inputs the user can see and change,
   not a black-box number).
4. **AI chatbot** — last, after the above give it something real to sit
   on top of. Propose-don't-post: the LLM drafts, it never posts
   directly. It writes through the same validation layer the UI uses
   (the DTOs/service methods, not a shortcut path), and a human confirms
   every write before it lands — no exception for "obviously correct"
   changes.

Not on this numbered list but still open whenever it's picked back up:
widening either VAT computation — FR: remaining taux particuliers beyond
T6, AIC/imports, groupe TVA, régularisations, annexe 3310-A; MC: TMP,
acomptes provisionnels, filing-frequency mechanics, the cross-border
memo-line question — and building Case A's ligne 18 memo line on the
French CA3 for a French entity with Monaco-destined activity, which is
documented but not implemented. See "VAT / CA3 declaration" and "VAT /
Monaco declaration (Case B)" above.

## Monaco compliance — verify before trusting

Monaco is **not** France; treat Monaco-specific rules as a second,
independently-configured jurisdiction, not "France with a different flag":

- Monegasque companies commonly apply a PCG-aligned chart of accounts and
  VAT largely mirrors French rates/rules under the 1963 Franco-Monegasque
  tax convention, but Monaco has its own tax administration (Direction des
  Services Fiscaux de Monaco) and its own corporate profit tax rules
  (impôt sur les bénéfices, applicable mainly when >25% of turnover is
  generated outside Monaco).
- **This assistant is not a substitute for a Monegasque expert-comptable.**
  Do not hardcode assumptions about Monaco-specific filing formats
  (including whether an FEC-equivalent digital audit file is legally
  required in Monaco) without a cited source. Where Monaco rules are
  uncertain or unverified in this codebase, the code must fail explicitly
  (e.g. `NotImplementedException` / a visible TODO with the open question),
  never silently apply the French rule and call it done.
- The `Company.jurisdiction` field (`FR` | `MC`) is the single switch that
  selects which compliance ruleset (chart-of-accounts template, VAT rules,
  export formats) applies. New jurisdiction-sensitive logic must branch on
  this field explicitly rather than assuming France. VAT is the first
  fully worked example of this pattern end to end — see "VAT / Monaco
  declaration (Case B)" above for how `VatService.computeDeclaration()`
  branches on it.
- **A documented absence isn't the same as a confirmed absence.** Lesson
  learned the hard way on the 2,1 % VAT rate (see "VAT / Monaco
  declaration (Case B)" above): a Monaco source document not printing a
  dedicated line for something is not, by itself, evidence that thing
  doesn't apply to Monaco — it may just be declared through a different,
  more generic mechanism than France uses. Check for that before
  concluding a rule doesn't exist for Monaco.

## Conventions

- **Domain naming**: entities that map 1:1 to legal/regulatory concepts use
  the French terms from the legal text, matching the FEC field names
  exactly, to avoid transcription bugs between the schema and the export
  (`Ecriture`, `EcritureLigne`, `Journal`, `Compte`/`Account` — see Prisma
  schema for the authoritative naming). General application code (modules,
  controllers, services, DTOs) follows normal NestJS/English conventions.
- **Modules**: one NestJS module per bounded domain concept under
  `src/modules/*` (companies, accounts, journals, fiscal-years, entries,
  a-nouveau, fec, import-excel, depreciation, vat, liasse, ledger — trial
  balance / grand livre reporting, reads only, never writes). Cross-cutting concerns
  (Prisma client, company context, Decimal helpers, ledger guards like
  `assertFiscalYearOpen`) live under `src/common/*`.
- **DTOs validate at the boundary.** Every controller input is a class
  decorated with `class-validator` decorators; never trust a raw request
  body past the controller.
- **No silent fallbacks on compliance-relevant logic.** If a rule listed
  above can't be satisfied (unbalanced entry, missing SIREN, unvalidated
  entries in an export range, unverified Monaco rule), throw — don't warn
  and continue.
- **Tests**: colocated `*.spec.ts` next to the code they test. Ledger
  balancing, sequential numbering, immutability, and FEC formatting are
  the highest-value test targets and should be covered before any other
  module's business logic.
- Keep stub modules honestly stubbed: a scaffolded module with no business
  logic yet returns `NotImplementedException`, not a plausible-looking
  fake result.
