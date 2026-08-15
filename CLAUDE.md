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
  period's dotation as a real validated écriture, and a "Céder
  l'immobilisation" action (cession date, price, compte de règlement
  defaulting to 462000) posts the disposal écriture(s) the same way —
  same `window.confirm()`-then-mutate pattern, since both are definitive
  ledger writes. A disposed asset stays listed (not removed), shown with
  a "Cédée" badge, its cession date/price and plus/moins-value, and its
  plan d'amortissement closed to further posting. Liasse fiscale has a real screen too
  (`LiassePage`) — bilan (2050/2051), compte de résultat (2052/2053),
  the 2054/2055 movement annexes (immobilisations/amortissements, now
  including real cessions/reprises columns), 2056 (provisions), 2057
  (état des créances et des dettes, montant brut only — its own
  maturity split is blocked, not the whole table), and 2059-A
  (plus/moins-values — Cadre A/B now populate for real per disposal,
  the court-terme/long-terme tax qualification stays unbuilt, see
  "Immobilisations / cession" below), régime réel normal only,
  read-only report — see "Liasse fiscale / bilan & compte de résultat"
  and "Liasse fiscale annexes 2056/2059" below. The régime réel
  simplifié (2033-series) variant remains honest "non implémenté"
  territory, matching the backend's own scope.
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

## Test fixtures — multi-year regression company

The seeded demo company (SIREN `123456789`, "Société Démo SARL") only ever
has one fiscal year, so it can't exercise cross-year logic — and cross-year
bugs are real: the liasse VNC-scoping bug (see "Liasse fiscale" below) only
surfaced once a second, later fiscal year existed to leak into the first.
To keep a reference for that class of bug, a second company, **"Société
Test Multi-Année"** (id `cmsm0x5cc0000o5j8z8a3rr53`, FR/`REEL_NORMAL`, no
SIREN), was built by hand through the real APIs on 2026-08-09 and is kept
around deliberately as a standing fixture:

- **Two fiscal years**: 2025 (`cmsm0xdk80002o5j89nbzom2a`) and 2026
  (`cmsm0xdlq0004o5j8ja1yc84k`), both open.
- **16 validated écritures**: the original opening block plus 2
  immobilisation acquisitions and 7 dotation postings spread across both
  years (`tableau-2054-2055-oracle-fixture.ts`'s dataset); 4 more added
  2026-08-09 for the 2056 verification — a vente à crédit, a dotation +
  partial reprise on a "provisions pour garanties clients" (151200),
  and a dotation on a "dépréciation clients douteux" (491000) —
  matching `tableau-2056-oracle-fixture.ts`; and 2 more added
  2026-08-15 for the cession verification (see below) — a prorated
  final dotation and the disposal écriture itself.
- **6 `FixedAsset` records** spanning both years and multiple 2054/2055
  categories on purpose (a 2025 terrain, a 2025 bâtiment, a 2026 entrepôt,
  a 2025 machine, a 2026 office-equipment purchase, a 2025 véhicule) —
  chosen specifically to exercise "début vs. this year's movement"
  splitting in `tableau-2054.ts`/`tableau-2055.ts`, not just closing
  balances. **One of them, Entrepôt C (214000), is now genuinely
  disposed** — see "Immobilisations / cession" below for the full
  écriture design this reproduces: acquired 2026-04-01 for 80 000,00,
  disposed 2026-09-01 for 90 000,00. `computeFinalPeriodDotation`
  prorates a 1 677,78 final dotation (151 days on the 30E/360
  convention, from serviceStartDate since this is the asset's first
  year), giving VNC 78 322,22 at disposal and a plus-value of
  11 677,78 — booked through the real `POST
  /depreciation/fixed-assets/:id/cession` endpoint, not a temporary
  script. This is a **deliberate, permanent extension** of the fixture
  (matching the "don't post ad-hoc test entries" rule below by being
  documented here), kept specifically so 2054's Cessions column, 2055's
  Reprises column, and 2059-A's Cadre A/B all have a real, hand-traceable
  example to check against — not reverted after verification, unlike
  the temporary Prisma script used earlier to prove 2059-A's
  now-removed throw-on-cessionDate guard. The other 5 assets still have
  `cessionDate: null`. Verifying this also required creating three
  accounts on this company that the shared `PCG_ACCOUNTS` seed didn't
  yet have at the time this fixture was built by hand (now fixed for
  future companies, see "Immobilisations / cession" below): `675200`,
  `775200`, `462000`.
- This is the exact dataset hand-traced in
  `backend/src/modules/liasse/tableau-2054-2055-oracle-fixture.ts` and
  `tableau-2056-oracle-fixture.ts`, used as the unit-test oracles — the
  fixture company reproduces both as real rows so the same numbers can
  be checked live through the actual API/UI, not just against mocks.

**Rules for this company, so it stays trustworthy as a reference:**

- **Don't post ad-hoc test entries into it.** Any écriture added here
  should be a deliberate, documented extension of the fixture (updating
  the oracle fixture file to match), not a one-off — otherwise its
  numbers stop matching the hand-traced oracle and it stops being useful
  as a regression check.
- **It's not created by `npm run seed`.** It only exists in whatever
  local Postgres database it was created in; a fresh `prisma migrate
  dev`/reseed on a different machine or a wiped local DB won't recreate
  it. There's no seed script for it (yet) — if that becomes a problem,
  the fix is a dedicated `seed-multi-annee.ts` following the
  `seed-sample.ts`/`seed-monaco.ts` precedent, not recreating it by hand
  again.
- **No company picker exists in the frontend** (see "Multi-tenant data
  model" below), so viewing this company's data in the browser requires
  temporarily pointing `x-company-id` at it (e.g. a temporary edit to
  `frontend/src/api/client.ts`'s `request()`, reverted immediately after)
  rather than clicking to it — don't leave that override in place.

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

## Immobilisations / cession

`src/modules/depreciation/`'s `DepreciationService.disposeFixedAsset()`
(as of 2026-08-15) posts a fixed asset's disposal as real, validated
écritures — `POST /depreciation/fixed-assets/:id/cession`. Built the
same review-first-then-post discipline as à-nouveau and dotation
posting: the écriture structure was reviewed and confirmed before any
posting code was written, quoting Art. 942-20 and Art. 944-46 of
`specs/Reglt 2014-03_Plan comptable general.pdf` (the PCG regulation
text itself, not the DGFiP commentary).

- **The écriture, confirmed against the PCG's own commentary**: "Lors
  des cessions, la valeur d'entrée des éléments cédés et les
  amortissements correspondants sont sortis des comptes où ils
  figurent. Le montant net en résultant est porté au débit du compte
  675 «Valeurs comptables des éléments d'actifs cédés». Simultanément,
  le compte 775 «Produits des cessions d'éléments d'actif» est crédité
  par le débit du compte 462 «Créances sur cessions d'immobilisations»"
  (Art. 942-20). One combined écriture per disposal (not two): débit
  amortissementsCumules (28x) + débit VNC (675x) = crédit valeurBrute
  (21x); débit compte de règlement = crédit produit de cession (775x).
  Zero-valued lines are omitted (`EntriesService` rejects a 0,00 line)
  — a `cessionPrice` of "0.00" (mise au rebut, no resale value) simply
  drops the produit/règlement pair entirely, leaving only the VNC
  write-off. Posted through `EntriesService.create()`/`validate()`
  exactly like every other écriture in this app — no privileged write
  path.
- **Depreciation is brought current FIRST.** A mid-year disposal needs
  that year's own (necessarily partial) dotation posted before VNC can
  be computed — `disposeFixedAsset()` reuses `postDotation()` itself
  for this (no duplicated posting logic), after upserting a
  `DepreciationEntry` with the prorated amount. Refuses outright,
  naming the posted amount, if that year's dotation was already posted
  in full before the disposal was known about (the fix is to reverse
  that écriture first, not silently repost).
- **Prorata temporis: 30E/360 ("commercial year"), inclusive of both
  endpoints, counted from date de mise en service.** A confirmed
  decision, not a default — `computeLinearSchedule()` has never
  supported ANY proration (it throws on a partially-overlapping fiscal
  year, including for acquisition-year proration, which remains
  unbuilt); cession's day-count (`cession-proration.ts`) is the first
  place in this app any proration actually happens, and the SAME
  convention is meant to apply symmetrically if/when acquisition-year
  proration is ever built. Every month = 30 days, both the period-start
  day and the disposal day count as a day of use (not the exclusive
  interest-accrual convention some finance day-counts use) — verified
  by a test asserting a disposal exactly on a fiscal year's own last day
  reproduces the same amount a normal full dotation would.
- **Compte de règlement is caller-supplied, not hardcoded** — 462
  "Créances sur cessions d'immobilisations" (paid later, reconciled by
  a normal separate écriture, mirroring how 411 client receivables
  already work here) by default, or any class-5 cash/bank account for
  an immediate sale. `assertValidCompteReglement()` rejects anything
  else.
- **VAT on the cession is explicitly out of scope this pass** —
  `cessionPrice` is booked as the full proceeds, no TVA collectée line.
  `FixedAsset` has no `vatRateId`/HT-vs-TTC field to build this
  properly, and whether a disposal is even in-scope for this app's
  basic-case CA3 treatment (`ca3-declaration.ts`) was never decided —
  see "VAT / CA3 declaration" above for the same discipline applied to
  every other deferred VAT case. Mechanically, tagging the 775x line
  with a `vatRateId` matching an existing `VatRate` would fold straight
  into the existing rate buckets with zero `ca3-declaration.ts` changes
  — the gap is the schema field and the scope decision, not the VAT
  engine.
- **675x/775x account resolution is automatic, not caller-chosen** —
  `resolveCessionNature()` reads the FixedAsset's own account prefix
  (20x → incorporelle, `675100`/`775100`; 21x/218x family → corporelle,
  `675200`/`775200`) and requires the resolved account to already exist
  (`NotFoundException` naming it, never auto-created — same discipline
  as à-nouveau's 120/129 lookup). Financières (26x/27x — participations,
  titres) are explicitly rejected as not implemented: PCG Art. 944-46's
  TIAP treatment is a genuinely different pattern (462 credited by 775
  OR debited by 675 depending on gain/loss, never both), and no fixture
  data or real usage exercises a financial immobilisation in this app.
  **A real, latent chart-of-accounts gap was found and fixed while
  building this**: the seeded `PCG_ACCOUNTS` had `775000` as a bare,
  unsubdivided account — `compte-resultat-2052-2053.ts` only ever
  matched the 4-digit CERFA subdivisions (`7751`/`7752`/`7756`/`7758`),
  so posting to bare `775000` would have thrown "no CDR line mapped" the
  moment a liasse was generated. Fixed: the seed now has `675100`,
  `675200`, `775100`, `775200`, and `462000` (`775000` removed, nothing
  else in the app ever referenced it).
- **A second real bug, found by the end-to-end test, not by
  inspection**: `buildVncByLine()`'s bilan tie-out
  (`assertVncTiesToLedger`) compared the immobilisations module's VNC
  figures against the ledger for EVERY fetched asset, including ones
  disposed within the reported year. `computeFixedAssetSummary()`'s
  `valeurBrute` is always `FixedAsset.acquisitionValue`, "independent of
  residualValue or postings" (its own doc comment) — meaning it kept
  reporting a disposed asset's full historical gross value forever,
  while the ledger (correctly) nets that account to zero once the
  disposal écriture lands. Comparing those for a disposed asset would
  always mismatch. Fixed: `buildVncByLine()` now excludes assets
  disposed within the reported year from this specific tie-out — the
  bilan's own, fully independent Actif=Passif check is what actually
  verifies a disposal posted correctly, and did, live (see below).
- **`fetchImmobilisations()` now also excludes assets disposed BEFORE
  the reported fiscal year** — the disposal-side analog of the
  already-fixed acquisitionDate-scoping bug (see "Liasse fiscale / bilan
  & compte de résultat" below): without this, a disposed asset would
  keep contributing its full valeurBrute/amortissementsCumules to every
  LATER year's bilan forever. An asset disposed WITHIN the reported year
  is still included (its 2054/2055/2059-A movement needs to show for
  that year) — only a disposal strictly before the reported year's
  start excludes it entirely, from début onward.
- **FixedAsset is marked disposed on the same row, never deleted** —
  `cessionDate`/`cessionPrice` (already in the schema, added
  pre-emptively before this feature existed) are simply set at the end
  of `disposeFixedAsset()`'s transaction. 2054's Cessions column, 2055's
  Reprises column, and 2059-A's Cadre A/B all key off this same flag.
- **2059-A's court-terme/long-terme tax qualification remains
  unbuilt, deliberately** — see "Liasse fiscale annexes 2056/2059"
  below for what IS computed (Cadre A/B populate for real per disposal)
  vs. what stays a genuine, stated gap (which CGI tax bucket a gain
  falls into needs holding-period/nature-of-asset judgment this app
  doesn't attempt).
- **Verified two ways.** `cession-proration.spec.ts` and
  `cession-invariants.spec.ts` cover the day-count/nature-resolution
  logic in isolation; `disposal.service.spec.ts` is a full hand-computed
  oracle (mid-year disposal, plus-value and moins-value cases, every
  guard) against a mocked-but-stateful Prisma layer. Separately, live
  against the "Société Test Multi-Année" fixture (see "Test fixtures"
  above): disposed Entrepôt C for real through the actual endpoint,
  confirmed the exact same VNC/plus-value figures the oracle predicted,
  confirmed the écriture lines posted exactly as designed, confirmed the
  guard correctly refuses a disposal when that year's dotation was
  already posted in full (tried on Véhicule F), and confirmed the full
  liasse (`POST /liasse/generate`) generates successfully afterward with
  every articulation check passing on real data — bilan Actif=Passif,
  the 2054/2055 tie-out, and 2059-A's own compte-de-résultat tie-out all
  held.
- **Frontend built (2026-08-15, same day as the backend)**: a "Céder
  l'immobilisation" action on `FixedAssetDetailPage` — see "Stack"
  above for the form fields and post-disposal display state. The
  liasse annexe screens (2054/2055/2056/2057/2059-A) needed no changes
  at all to show the real cession data — they were already wired
  correctly in the backend-only pass above; re-verified live against
  the already-disposed Entrepôt C fixture asset rather than posting a
  new disposal into the fixture.

## Liasse fiscale / bilan & compte de résultat

`src/modules/liasse/` computes the two foundational forms of the régime
réel normal liasse — **bilan (2050 Actif / 2051 Passif)** and **compte
de résultat (2052/2053)** — and `LiassePage` displays them, read-only,
in the real form's own layout. Built the same way as FEC/CA3/Monaco:
against the primary forms in `specs/`, mapping confirmed and reviewed
before any computation was written. Full line spec, account mapping,
and the ten flagged mapping gaps are in
`specs/liasse-2050-implementation-spec.md`; this section records the
facts that must never be re-derived from memory.

- **`Company.regime` (`REEL_NORMAL` | `REEL_SIMPLIFIE`) selects which
  liasse is official**, same role as `Jurisdiction` for VAT — defaults
  to `REEL_NORMAL`, the regime this pass implements. `LiasseService`
  refuses (`NotImplementedException`) for a `REEL_SIMPLIFIE` company
  rather than silently handing it a réel-normal liasse. No delete/
  update surface for this field yet beyond what `CreateCompanyDto`/
  `UpdateCompanyDto` already expose.
- **One shared, regime-agnostic engine; a mapping layer on top.**
  `trial-balance-engine.ts` aggregates validated-only ledger lines into
  one signed balance per account — the same shape a future 2033-series
  (régime réel simplifié) mapping would consume, unbuilt so far.
  `liasse-line-rules.ts`'s `classifyAccounts()` is the actual
  enforcement: every account is assigned to **exactly one** line, with
  the line's own sign convention (a contra account like `6091` "rabais
  obtenus" nets against its parent `601` "achats" automatically, no
  per-account special-casing needed). **An account matching zero lines,
  or more than one, throws** — never guesses, never silently drops a
  balance. `bilan-2050.ts` / `compte-resultat-2052-2053.ts` hold the
  2050-series rule tables and the pure compute functions.
- **Actif = Passif is the one real independent articulation check** —
  not a tautology. Actif is summed only from asset-nature accounts,
  Passif only from liability/equity-nature accounts: two disjoint
  partitions of the same trial balance via separate rule sets. It only
  holds if `classifyAccounts` partitions every account exactly once
  with the correct sign — get the overdraft case below wrong, or drop
  an account, and it breaks. `liasse-articulation.ts` asserts this
  (`ConflictException`, not silently accepted).
- **DI (bilan's "Résultat de l'exercice") is not a ledger read — it's
  constructed from the compte de résultat's HN.** Account 120/129
  reads 0.00 within the fiscal year itself in this app:
  `a-nouveau.service.ts` only posts a year's result into 120/129 as
  part of the *following* year's opening écriture. This makes the
  compute order load-bearing, not incidental —
  `computeCompteResultat2052_2053()` must run before
  `computeBilan2050()`, which takes the résultat as a parameter rather
  than deriving it. An earlier draft of this design treated `HN ===
  DI` as an independent cross-check; that was wrong (it would have
  trivially compared HN to a hardcoded zero) and was caught and fixed
  before anything shipped.
- **The immobilisations module's VNC still ties out as a genuine
  cross-check** — `fixed-asset-invariants.ts`'s `valeurBrute`/
  `amortissementsCumules` (independently sourced from
  `FixedAsset.acquisitionValue` and posted `DepreciationEntry.amount`,
  never from re-reading the ledger's 21x/28x balances) must equal the
  same lines' ledger-derived Brut/Amortissements, grouped via
  `resolveImmobilisationLineCode()`. Scoped to depreciation entries
  posted in or before the reported fiscal year, so it stays comparable
  to a trial balance scoped the same way.
- **Two confirmed high-risk regroupings, verified against the rendered
  form images, not assumed:**
  - **Bank overdrafts sign-reclassify from Actif to Passif.** A
    class-5 account (512/514/516/517) with a net *credit* balance
    routes to passif **DU** ("Emprunts et dettes auprès des
    établissements de crédit"), not netted against **CF**
    (Disponibilités) — confirmed by the 2051 form's own memo line EH
    ("dont concours bancaires courants, et soldes créditeurs de
    banques et CCP"). `DualNatureRule`s in `liasse-line-rules.ts`
    route by the account's *own* balance sign, bypassing normal
    per-line rule matching entirely. Same mechanism covers the
    personnel/social "charges à payer" family (428/438/448 → DY) and
    the associés-divers family (455/458/467/468 → EA).
  - **775/675 "cessions d'éléments d'actif" splits across three
    different compte-de-résultat sections by sub-account, not by PCG
    class.** 7751/7752 (incorporelles/corporelles) → **F1**, inside
    *produits d'exploitation*; 7756 (financières) → **G2**, inside
    *produits financiers*; only 7758 stays in **HD**, *produits
    exceptionnels* — confirmed from where F1/G2 actually sit on the
    rendered form. Mirrored on charges (675 → G1/G3/HH). Cession is now
    implemented (see "Immobilisations / cession" below) and F1/G1 carry
    real amounts on a company with a real disposal — confirmed live
    against the "Société Test Multi-Année" fixture.
- **Verified two ways.** A hand-computed oracle
  (`liasse-oracle-fixture.ts`, 26 tests across four spec files) — a
  23-transaction dataset, individually balanced by construction, hand-
  traced line by line including the overdraft and dual-nature cases,
  landing on Actif net = Passif total = 200 900,00 and a loss of
  36 100,00. Separately, a live call against the seeded FR demo
  company balanced on real data too (21 855,00 = 21 855,00). One real
  gap was caught while building the oracle: account 764 (Revenus des
  VMP) was missing from the compte de résultat mapping entirely —
  fixed, routed to `GL`.
- **`LiassePage` renders in the real form's layout**, not just a data
  dump: Actif's three columns grouped into the form's own rubriques,
  Passif with DI inserted at its actual position (between Report à
  nouveau and Subventions d'investissement) even though it's a
  separate field on the wire, and the compte de résultat's subtotal/
  résultat rows visually distinguished from the itemized lines feeding
  them. The Actif=Passif balance is its own banner, showing both
  totals rather than just asserting equality. Same drafts-block guard
  as FEC/CA3 (client-side, names the count, mirrors the backend's
  refusal rather than letting the button hit a 409).
- **2054 (immobilisations) and 2055 (amortissements) are now built
  too** (as of 2026-08-09) — see
  `specs/liasse-2054-2055-implementation-spec.md`. Movement tables, not
  closing-balance tables: `immobilisation-categories.ts` resolves each
  account to a finer category than `bilan-2050.ts`'s coarser lines via
  longest-prefix-match (a bare `213` defaults to "sur sol propre", a
  documented convention, not a silent guess; a specific `2135`/`214`
  always wins over that default), and `tableau-2054.ts`/
  `tableau-2055.ts` split "début" from "this year's movement" using
  `FixedAsset.acquisitionDate` and `DepreciationEntry.fiscalYearId`
  respectively — both already shaped for exactly this. Cessions (2054)
  and reprises (2055) are now real — see "Immobilisations / cession"
  below; virements de poste à poste and 2055's Cadre B remain genuinely
  N/A/zero, not faked (no reclassify endpoint exists; this app only
  computes linéaire, so book and tax amortization never diverge) — see
  "Known scope boundaries" below. `assertTableauxTieToBilan()` is the
  annexe's version of Actif=Passif:
  one aggregate identity (2054 fin − 2055 fin = bilan's total
  immobilisations net), verified on a hand-traced, multi-asset,
  multi-year oracle. `LiassePage` renders both tables in form order
  with a matching articulation banner.
- **2056 (provisions), 2057 (état des créances et des dettes), and
  2059-A (plus/moins-values) are all computed by the backend and
  displayed by `LiassePage`** (2056/2059 as of 2026-08-09, 2057 added
  2026-08-09 in a later pass) — see
  `specs/liasse-2056-2059-implementation-spec.md`. **2056** renders as
  a movement table in the same shape as 2054/2055, grouped into the
  CERFA form's three sections (TOTAL I/II/III) with subtotal rows, plus
  a client-side articulation banner covering TOTAL I + TOTAL II only
  (bilan's DK+DP+DQ) — TOTAL III (dépréciations) has no bilan-only
  figure the browser can recompute (the bilan's amortissements column
  mixes 28x with 29x per asset line), so that portion stays verified
  server-side only, noted under the table. `provision-categories.ts`'s
  account mapping is confirmed against the PCG 2014-03 text; two
  CERFA-named provisions with no PCG account number at all (prêts
  d'installation, congés à payer) fold into their family's documented
  "autres" bucket rather than being guessed a number. Its full backend
  articulation (`assertTableau2056TiesToBilan`) compares two
  independently-derived totals rather than tying to a bilan subtotal,
  since the bilan has none to offer for TOTAL III. **2057** turned out
  NOT to need the maturity-tracking decision once actually scoped:
  rather than re-classifying raw ledger accounts a third time,
  `tableau-2057.ts` computes it as a pure REGROUPING of the
  already-computed `Bilan2050` — every 2057 row (montant brut only) is
  exactly one bilan actif/passif line, relabeled into the CERFA form's
  own Cadre A (créances) / Cadre B (dettes) layout, with a client-side
  articulation banner (Cadre A/B totals tie to the same bilan lines,
  summed independently in the browser). The maturity split itself (à
  un an au plus / à plus d'un an, échéancier 1/5 ans) is still
  genuinely blocked — no due-date field exists anywhere in the schema
  — stated explicitly in the table's own `note` field rather than
  guessed or silently omitted. Some CERFA sub-lines (clients douteux
  vs. autres créances clients; personnel/sécurité sociale/impôts/TVA
  shown separately) aren't separable either, because `bilan-2050.ts`
  already merges them (BX, DY) or `DualNatureRule` merges them further
  (groupe et associés into BZ/EA/DY alongside unrelated families) — not
  a mapping problem the account numbers can solve, so 2057 reproduces
  the bilan's own (coarser) line groupings instead, each row stating
  which bilan line it reproduces. **2059-A** (as of 2026-08-15) renders
  real Cadre A (valeur d'origine / amortissements / valeur résiduelle)
  and Cadre B (prix de vente / montant global de la plus-value) rows,
  one per asset actually disposed within the reported fiscal year — see
  "Immobilisations / cession" above for the écriture side this reads
  off of. When there are no disposals this year, it still renders as a
  status card (not an empty table with nothing in it) showing the
  backend's note. `qualification` (court terme / long terme / taxable à
  19 %) stays `null` on every row and `totalCourtTerme`/`totalLongTerme`
  stay "0,00" even with real disposals — allocating a gain between them
  needs CGI tax judgment (holding period, nature of the asset) this app
  doesn't attempt; the real, computed net figure is still surfaced via
  `totalNonQualifie` rather than silently dropped, same "flag, don't
  fake" discipline as 2057's maturity split. `assertTableau2059TiesToCompteResultat`
  ties `totalNonQualifie` (not the always-zero court/long-terme split)
  to the compte de résultat's own 775/675 lines — the real, live
  articulation check. All four annexe tables verified live against the
  "Société Test Multi-Année" fixture, matching the backend verification
  exactly, including a real disposal (see "Immobilisations / cession"
  above).
- Remaining liasse work: the 2033-series (régime réel simplifié)
  mapping as a second pass over the same shared engine — the concrete
  test of whether the engine shape actually supports a second mapping
  layer the way it was designed to. Real 2057 maturity tracking (a new
  schema field + UI to set it) remains open if ever wanted, but the
  montant-brut version is a complete, real screen on its own — not a
  placeholder waiting on that decision. 2059-A's court-terme/long-terme
  tax qualification remains open too, same reasoning.

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
- **Liasse fiscale covers bilan, compte de résultat, 2054/2055, 2056,
  2057, and 2059 — all computed and displayed.**
  `computeBilan2050()`/`computeCompteResultat2052_2053()`/
  `computeTableau2054()`/`computeTableau2055()`/`computeTableau2056()`/
  `computeTableau2057()`/`computeTableau2059A()` are all real (see
  "Liasse fiscale / bilan & compte de résultat" and "Liasse fiscale
  annexes 2056/2059" above), and `LiasseService.generate()` returns all
  seven; `REEL_SIMPLIFIE` companies are refused outright
  (`NotImplementedException`), not handed a wrong liasse. `LiassePage`
  renders all seven. 2057's own maturity split (à un an au plus / à
  plus d'un an) is still blocked — no due-date field exists anywhere in
  the schema — but that's a real, narrower gap within a real table, not
  the whole annexe being absent. Only the 2033-series (régime réel
  simplifié) mapping remains genuinely unbuilt.
- **VAT's `computeDeclaration()` is no longer a stub for either
  jurisdiction** — it branches to `computeCa3Declaration()` (FR) or
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
- **Immobilisations: cession is now built (as of 2026-08-15); dégressif
  remains deferred.** See "Immobilisations / cession" above for the full
  écriture design, the prorata-temporis convention, and the two real
  bugs its own build surfaced and fixed (the bare-775000 chart gap, and
  `buildVncByLine`'s tie-out never excluding disposed-this-year assets).
  `DepreciationMethod.DECLINING` (dégressif) still throws
  `NotImplementedException` in `generateSchedule()`; only linéaire is
  computed — which is also why 2055's Cadre B (amortissements
  dérogatoires) isn't represented at all: it only exists when the tax
  method diverges from the book method, which can't happen here.
  Acquisition-year proration (as opposed to cession's disposal-year
  proration, now built) also remains unbuilt —
  `computeLinearSchedule()` still throws on a partially-overlapping
  fiscal year. `DepreciationService.postDotation()` posts a period's
  dotation (débit compte 681x / crédit compte 28x) through the normal
  `EntriesService.create()`/`validate()` layer — no privileged write
  path — and sets `DepreciationEntry.postedEcritureId`; VNC on the
  list/detail screens is computed from posted entries only, so it ties
  to the bilan rather than the projected schedule.
- **Orphaned-immobilisation guard is now built (2026-08-15)** — closes
  the gap below. `EntriesService.create()`/`update()` both compute a
  non-blocking warning (`EcritureWriteResult.warnings: string[]`) when
  a line **debits** a class-2 account (excluding 28x/29x
  contra-accounts, same predicate as `ImmobilisationsPage.tsx`'s own
  filter, factored out to `orphaned-immobilisation.ts`'s
  `isImmobilisationAccount()`) that has no `FixedAsset` linked to it
  for this company. Deliberately a warning, not a hard block — there
  are legitimate reasons an account might not have a fiche yet (e.g.
  registering it right after) — but it's now surfaced at entry time
  via the journal grid's own save flow (`JournalEntriesPage.tsx` shows
  it as a dismissible warning-styled banner after save, not inline
  validation, since it doesn't block the write), not just discovered
  months later by the 2054/2055 tie-out. Verified live against the FR
  demo company: debiting `218200` (Matériel de transport, no
  `FixedAsset`) returned the warning naming that account; the écriture
  still posted (non-blocking, confirmed); the test draft was deleted
  after. **Scoped to `EntriesService.create()`/`update()` only** — the
  journal grid's own write path. À-nouveau and Excel import both write
  écritures directly via Prisma, bypassing `EntriesService` entirely
  (a pre-existing structural fact, not new), so neither goes through
  this check; not extended to them this pass. Original bug this closes,
  kept for context: the journal entry grid let you debit any account,
  including class 2, with no check that a `FixedAsset` existed for it.
  Found live (2026-08-09): the FR demo company had exactly this — a
  validated écriture debiting 218300 for 450,00 € with no `FixedAsset`
  behind it at all. The *old* VNC check (`assertVncTiesToLedger`) never
  caught it (it only validates lines that already have `FixedAsset`
  data — a line with none was silently skipped). The 2054/2055 tie-out
  (`assertTableauxTieToBilan`, exhaustive by construction) does catch
  it, refusing to generate the liasse — which is how this one was found
  and fixed originally (a `FixedAsset` created for the existing asset
  via the real API). That tie-out remains a real, independent backstop
  at liasse-generation time; the new guard above is the entry-time
  warning that was missing alongside it.
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
from posted entries only. **Cession (disposal) is also done, backend and
frontend** (as of 2026-08-15) — see "Immobilisations / cession" above
for the full écriture design, verified live against the multi-year
fixture, and the "Céder l'immobilisation" action on
`FixedAssetDetailPage` (see "Stack" above) to trigger it. The
"orphaned immobilisation" gap is also closed (same day, later pass) —
`EntriesService.create()`/`update()` now warn (non-blocking) when a
line debits a class-2 account with no linked `FixedAsset`, see "Known
scope boundaries" above. What's still deferred: dégressif,
acquisition-year proration.

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

**Liasse fiscale** — bilan (2050/2051), compte de résultat
(2052/2053), the 2054/2055 movement annexes, 2056 (provisions), 2057
(état des créances et des dettes, montant brut only), and 2059-A
(plus/moins-values, a guarded N/A stub) are all computed AND displayed
(2056/2059 as of 2026-08-09, 2057 added in a later pass the same day),
régime réel normal, by a shared trial-balance engine plus 2050-series
mapping layers, verified by hand-traced oracles and live runs against
the FR demo company / the multi-year fixture company. See "Liasse
fiscale / bilan & compte de résultat" and "Liasse fiscale annexes
2056/2059" above for the core architecture (the Actif=Passif
independent check, DI constructed from HN, the confirmed overdraft/
775-675/immobilisation-category regroupings, the 2054/2055 tie-out,
2057's regroup-the-bilan approach). **2057's own maturity split is
still blocked** — both its cadres would need a maturity/échéance split
nothing in the schema can produce — see "Liasse fiscale annexes
2056/2059" above and `specs/liasse-2056-2059-implementation-spec.md`
§3; the montant-brut table itself is real and complete, not a
placeholder. Verifying 2054/2055 live also surfaced and closed a real,
structural gap — see "Known scope boundaries" below, "orphaned
immobilisation." Other logged gaps remain open too (`dateLettrage` not
API-settable, no import-batch listing endpoint, no delete/deactivate on
Journal/Account/VatRate/FiscalYear, Article A47 A-1 §VIII
uncross-checked).

**Build order for what's next**, roughly in priority:

1. **Liasse fiscale**: the 2033-series (régime réel simplifié) mapping
   as a second pass over the same shared engine — the concrete test of
   whether the engine shape actually supports a second mapping layer
   the way it was designed to. Real 2057 maturity tracking (a new
   schema field + UI to set it) remains open if ever wanted, not
   blocking; 2059-A's court-terme/long-terme tax qualification is the
   same kind of open, non-blocking item. Separately, worth picking up
   soon: the "orphaned immobilisation" guard logged in "Known scope
   boundaries" — warning at journal-entry time rather than relying on
   the liasse tie-out as the only backstop.
2. **Cash flow statement** — bilan and compte de résultat are already
   covered by the liasse work above.
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
