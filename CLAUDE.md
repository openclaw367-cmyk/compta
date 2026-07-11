# compta-fr-mc

Double-entry accounting suite for French and Monegasque companies: PCG chart of
accounts, FEC export (Article A47 A-1 du LPF), Excel journal import,
depreciation (amortissements), VAT (TVA), and liasse fiscale.

## Stack

- **Backend**: TypeScript, NestJS, PostgreSQL, Prisma ORM.
- **Frontend** (not yet scaffolded): planned as a TypeScript/React app sharing
  types with the backend. Single-company UX for now (auto-selects the one
  company, no company picker) even though the data model is multi-tenant —
  see "Multi-tenant data model" below.
- **Package manager**: npm.
- **Testing**: Jest (unit + e2e, NestJS default).
- **Validation**: `class-validator` / `class-transformer` on all DTOs.

Repo layout:

```
backend/     NestJS API (this is what's scaffolded so far)
specs/       Compliance / functional specs (FEC, PCG, VAT, liasse references)
samples/     Sample files (e.g. real-world FEC exports, PCG account lists)
```

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
- Frontend (once scaffolded): monetary values are parsed into a `Decimal`
  immediately on receipt and formatted for display only at the last
  possible moment. No arithmetic on `parseFloat()`'d money, ever.
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
   (extourne / contre-passation) that references the original. Draft
   (unvalidated) entries, e.g. freshly imported from Excel, may still be
   edited before validation.
4. **One posting side per line.** A journal entry line has either a debit
   or a credit amount, never both, and the amount is always positive.
5. **Chart of accounts (PCG) structure.** Account numbers follow the Plan
   Comptable Général class structure (class 1 capitaux, 2 immobilisations,
   3 stocks, 4 tiers, 5 financiers, 6 charges, 7 produits, 8 comptes
   spéciaux). Account creation validates the leading digit against a known
   class; unclassifiable accounts are rejected, not silently accepted.

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
- **Only validated écritures are exportable.** An export over a period that
  contains unvalidated (draft) entries must fail loudly, not silently skip
  them.
- Field-name and column-order changes are compliance-breaking. Any change
  to `src/modules/fec/fec-export.service.ts`'s output shape requires a
  matching update to the fixture tests in `src/modules/fec/*.spec.ts`
  before merging — never adjust the test to match new output without
  re-checking it against `specs/LEGIARTI000027804775_Article_A47_A-1_LPF.md`.

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
  this field explicitly rather than assuming France.

## Conventions

- **Domain naming**: entities that map 1:1 to legal/regulatory concepts use
  the French terms from the legal text, matching the FEC field names
  exactly, to avoid transcription bugs between the schema and the export
  (`Ecriture`, `EcritureLigne`, `Journal`, `Compte`/`Account` — see Prisma
  schema for the authoritative naming). General application code (modules,
  controllers, services, DTOs) follows normal NestJS/English conventions.
- **Modules**: one NestJS module per bounded domain concept under
  `src/modules/*` (companies, accounts, journals, entries, fec,
  import-excel, depreciation, vat, liasse). Cross-cutting concerns
  (Prisma client, company context, Decimal helpers) live under
  `src/common/*`.
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
