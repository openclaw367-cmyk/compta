# Invoicing — Phase A implementation spec (compliant generation + gated ledger posting)

**Status: design resolved AND implemented 2026-08-30, backend-only as
scoped, verified live on both required companies — see CLAUDE.md
"Invoicing — Phase A (compliant generation + gated ledger posting)"
for the full verification record.** This is the design-then-verify pass for Phase A specifically, per
`specs/invoicing-plan.md` (the regulatory research + phased plan this
spec assumes as read). Reviewed against real precedent already shipped
in this codebase (cession's `disposeFixedAsset()` for the écriture-
posting pattern, VAT/liasse's jurisdiction-branching for the mentions
engine, à-nouveau/ecritureNum for numbering) — every decision below
reuses an existing pattern rather than inventing a new one, per this
app's own build discipline.

**Scope, stated precisely**: backend only, this pass. Data model,
mandatory-mentions computation (France; Monaco an honest stub),
numbering, avoir (credit note) handling, and the gated invoice→écriture
posting. **PDF/Factur-X rendering and the frontend UI are explicitly
NOT built this pass** — see "Deferred, explicitly" at the end. This
mirrors this app's own precedent of sequencing a compute/data layer
before its rendering layer (e.g. the 2050-series bilan/CDR compute
functions existed and were curl-verified before `LiassePage` was built;
cash-flow was "backend only, deliberately, per the build instruction: no
UI this pass").

---

## The five decisions, resolved

### 1. Invoice numbering scheme and its legal continuity requirement

**Resolved: a separate `Company.nextInvoiceNum` sequence, distinct from
`nextEcritureNum`**, assigned only at finalization (never at draft
creation), atomically incremented in the same transaction that marks the
invoice `FINALIZED` — the exact same mechanism `Company.nextEcritureNum`
/ `EntriesService.validate()` already uses for écritures, reused
verbatim rather than reinvented. `invoiceNumber` is a plain string of
the incrementing integer (e.g. `"1"`, `"2"`, ...) — no year/prefix
baked into the stored value; a display prefix (e.g. `"F2026-0001"`) is a
presentation concern for whenever a UI renders it, not a change to the
underlying counter, same "don't derive from a formatted string" caution
`ecritureNum` itself already documents.

**Why finalization-time, not creation-time**: assigning the number only
once an invoice is finalized means an abandoned/deleted DRAFT never
creates a numbering gap — the same reasoning `ecritureNum` already
applies (draft écritures are freely deletable; only validation assigns
a number). This is *more* conservative than some real-world invoicing
tools (which sometimes number at creation) but matches this app's own
already-established "no gaps, ever" discipline exactly rather than
introducing a softer standard just for invoices.

**One accepted, documented risk, matching an existing precedent, not a
new one**: `finalize()` calls `EntriesService.create()` +
`EntriesService.validate()` first (posting the écriture), THEN — as a
separate step — assigns `invoiceNumber`/`postedEcritureId` and flips
`status` to `FINALIZED`. If the second step fails after the first
succeeds, a validated écriture would exist with no invoice number yet.
This is the **exact same shape of accepted risk** `disposeFixedAsset()`
already carries (the cession écriture validates, *then* a separate
`prisma.fixedAsset.update()` sets `cessionEcritureId` — a failure
between the two leaves a posted écriture with no disposal record). Not
solved with heavier transaction machinery here, for the same reason it
wasn't solved there: this codebase's own established risk tolerance
already accepts this shape of two-step write for a posting action, and
inventing a stronger guarantee only for invoicing would be inconsistent
with that precedent, not safer in a way this app currently values.

### 2. Credit notes / avoirs

**Resolved**: a **single `Invoice` model with a `type` discriminator**
(`SALE` | `CREDIT_NOTE`), not a separate model. A `CREDIT_NOTE` invoice
requires `correctsInvoiceId`, a required FK to an existing, **finalized**
`SALE` invoice on the same company (enforced in the service, not the
schema — mirrors how `EntriesService` enforces its own cross-references
in the service layer). A credit note's own line items are entered
independently (not required to mirror the original invoice's lines 1:1
— a partial credit is a normal, legitimate case) and use the **same
positive-amount convention** as a sale line (a credit note line
describes "amount credited," never a negative number) — the *posting*
step is what reverses the debit/credit direction, not the data entry.

**Numbering**: credit notes draw from the **same** `nextInvoiceNum`
sequence as sale invoices — one continuous sequence covering both types,
not two separately-maintained counters. This is a **documented design
choice, not a research-confirmed legal requirement** (§1's own research
pass didn't find a citation either requiring or forbidding a shared
sequence) — flagged honestly per the plan doc's own instruction, and
revisitable if a future source says otherwise. The simplicity of one
counter (matching `nextEcritureNum`'s own single-sequence precedent)
was preferred over inventing a second counter with no confirmed
requirement driving it.

### 3. The gated invoice→écriture posting

**Resolved, reusing the cession pattern exactly**:

- **A `SALE` invoice posts**: débit `clientAccountId` (411-family, the
  invoice's TTC total) = crédit revenue account(s) (707/706-family, HT
  per line) + crédit the TVA collectée account (445710) per distinct
  VAT rate used, **tagging each TVA ligne's own `vatRateId`** — the
  exact per-ligne rate-tagging convention `ca3-declaration.ts`/the
  Tier-3 drill-down already established and verified (the same account
  can carry multiple lignes at different rates). Lines are grouped by
  `(revenueAccountId, vatRateId)` pair before posting — one HT ligne and
  one TVA ligne per distinct pair, not one ligne per raw invoice line —
  mirroring how a human would naturally consolidate a multi-line
  invoice into a compact écriture.
- **A `CREDIT_NOTE` posts the mirror image**: crédit `clientAccountId`
  = débit revenue account(s) + débit TVA collectée, same grouping.
- **Zero-amount groups are simply omitted** — a VAT-exempt line (no
  `vatRateId`) contributes to its revenue group's HT-only total with no
  TVA ligne at all, same "a 0,00 line is omitted, never posted" rule
  `disposeFixedAsset()`'s own zero-value handling already established.
- **Posted through the ordinary `EntriesService.create()` +
  `.validate()`, never a privileged write path** — identical discipline
  to cession, à-nouveau, `propose_ecriture`, and the batch invoice
  queue. The journal is the company's own `VENTES`-type journal,
  resolved by type lookup (`NotFoundException` naming the gap if none
  exists), same pattern `disposeFixedAsset()` uses for
  `OPERATIONS_DIVERSES`.
- **The balance check is free, and already exists**: `EntriesService`'s
  own `EntryValidationService` independently re-verifies that the
  posted lines balance (rule 1, "every écriture balances") — if the
  posting-lines builder's arithmetic is ever wrong, the écriture write
  itself throws. This is the oracle for this piece, already built and
  already enforced, not something this pass needs to invent — the same
  "verified two ways" discipline this app applies everywhere, except
  here one of the two is an existing invariant rather than a new test.
- **A `SALE` invoice can only be finalized once** (status transitions
  `DRAFT → FINALIZED`, never back) — mirrors écriture immutability
  after validation exactly. Editing a finalized invoice's content is not
  supported this pass (a correction is a credit note, same as an
  écriture correction is a reversing entry) — no analog of `lettrage`'s
  narrow post-validation-editable exception exists for invoicing, and
  none is being invented here.

### 4. Multi-currency

**Resolved: out of scope, exactly as flagged in the plan doc.** No
currency field anywhere on `Invoice`/`InvoiceLine`. All amounts are
plain money strings in the app's one implied currency, following this
app's own hard money rule (`NUMERIC(15,2)`, `Decimal`-typed, never a
native `number`). If multi-currency is ever needed, it is new work on
top of this schema (an added `currency`/`montantDevise`-shaped field,
mirroring `EcritureLigne`'s own existing but display-only
`montantDevise`/`idDevise` pair) — not attempted here.

### 5. The mandatory-mentions data model (France implemented, Monaco pending)

**Resolved**: a pure function, `computeInvoiceMentions(jurisdiction,
company, invoice, client, lines)`, branching exactly like
`VatService.computeDeclaration()` already branches on
`Company.jurisdiction`:

- **`computeInvoiceMentionsFR()` is implemented**, returning a
  structured `InvoiceMentions` object covering every mention confirmed
  in `specs/invoicing-plan.md` §1.3: seller/buyer identity (from
  `Company` + the invoice's own client snapshot — see below), VAT
  numbers, the finalized `invoiceNumber` and `invoiceDate`, per-line
  quantity/description/unit-price-HT/rate, VAT totals broken out by
  rate, and the static Code de commerce art. L441-10 boilerplate
  (late-payment penalty wording, the 40 € forfaitary indemnity, escompte
  conditions) as fixed, sourced strings. This is a **data model for the
  mentions, not a renderer** — no PDF/print layout is produced this
  pass (see "Deferred, explicitly").
- **`computeInvoiceMentionsMC()` is an honest, explicit stub**: throws
  `NotImplementedException` with a message naming exactly what's
  missing — *"Monaco invoicing rules pending official confirmation —
  see specs/invoicing-plan.md §1.6. Re-check monentreprise.gouv.mc
  before implementing."* This is called from `finalize()`, meaning an
  MC-jurisdiction company **can create and edit DRAFT invoices** (the
  data-entry/architecture is jurisdiction-agnostic end to end) but
  **cannot finalize one** — the one legally-sensitive step is where the
  gap is enforced, mirroring exactly how `LiasseService.generate()`
  already refuses `REEL_SIMPLIFIE`-specific annexes that aren't built
  yet, rather than silently degrading or guessing.
- **The client-identity snapshot, resolved as part of this decision**:
  `Invoice` reuses the existing 411-family auxiliary `Account` (Tiers)
  mechanism for `clientAccountId` — no new client/customer model, since
  this app's tiers mechanism already exists and is already tested. But
  a `Tiers` account today carries no address/SIREN/RCI fields, and an
  invoice is a legal document whose printed mentions must never
  retroactively change if the underlying tiers record is edited later
  — so `finalize()` **snapshots** `clientNameSnapshot`/
  `clientAddressSnapshot`/`clientSirenOrRci`/`clientVatNumber` onto the
  `Invoice` row at finalization time (currently caller-supplied at
  finalization, since `Account` has no such fields to read from yet —
  a natural, small follow-up would be adding these fields to `Account`
  itself for a future "type the client's address once" UX, explicitly
  not attempted this pass).

---

## Data model

New Prisma models (migration to follow):

```prisma
enum InvoiceType {
  SALE
  CREDIT_NOTE
}

enum InvoiceStatus {
  DRAFT
  FINALIZED
}

model Invoice {
  id           String     @id @default(cuid())
  companyId    String
  company      Company    @relation(fields: [companyId], references: [id])
  fiscalYearId String
  fiscalYear   FiscalYear @relation(fields: [fiscalYearId], references: [id])

  type   InvoiceType   @default(SALE)
  status InvoiceStatus @default(DRAFT)

  // Assigned only at finalize() — see decision 1. Null while DRAFT.
  invoiceNumber String?
  invoiceDate   DateTime?

  clientAccountId String
  clientAccount   Account @relation(fields: [clientAccountId], references: [id])

  // Snapshotted at finalize() — see decision 5. Null while DRAFT.
  clientNameSnapshot    String?
  clientAddressSnapshot String?
  clientSirenOrRci      String?
  clientVatNumber       String?

  // Required, and must reference a FINALIZED SALE invoice, when type = CREDIT_NOTE.
  correctsInvoiceId String?
  correctsInvoice   Invoice?  @relation("InvoiceCorrection", fields: [correctsInvoiceId], references: [id])
  correctedBy       Invoice[] @relation("InvoiceCorrection")

  // Set at finalize(), alongside invoiceNumber — see decision 3's accepted-risk note.
  postedEcritureId String?

  lines InvoiceLine[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([companyId, invoiceNumber])
  @@index([companyId])
}

model InvoiceLine {
  id        String  @id @default(cuid())
  companyId String
  company   Company @relation(fields: [companyId], references: [id])
  invoiceId String
  invoice   Invoice @relation(fields: [invoiceId], references: [id])

  description String
  quantity    Decimal @db.Decimal(15, 2)
  unitPriceHT Decimal @db.Decimal(15, 2)

  revenueAccountId String
  revenueAccount   Account @relation(fields: [revenueAccountId], references: [id])

  vatRateId String?
  vatRate   VatRate? @relation(fields: [vatRateId], references: [id])

  createdAt DateTime @default(now())

  @@index([companyId, invoiceId])
}
```

Plus `Company.nextInvoiceNum Int @default(1)` (mirroring
`nextEcritureNum` exactly) and the corresponding relation arrays on
`Company`/`FiscalYear`/`Account`/`VatRate`.

**Quantity is modeled as a `Decimal`/money-string, same as every other
numeric value in this app** — not a plain `number`, even though it
isn't literally money, for consistency with this app's blanket "no
native `number` for anything Decimal-shaped" discipline and because it
participates directly in a money computation (quantity × unit price).

---

## Deferred, explicitly

- **PDF/Factur-X rendering.** This pass produces the `InvoiceMentions`
  data (everything a renderer would need) but no actual file. Per
  `specs/invoicing-plan.md`, this app has no PDF-generation dependency
  anywhere yet (roadmap item 7 flags this as its own future work) —
  adding one is a real, separate decision, not a rider on this pass.
- **Frontend UI.** Backend-only this pass, same as cash-flow's own
  precedent.
- **Monaco rules.** Architecturally wired (jurisdiction parameter flows
  end to end), content intentionally absent — see decision 5.
- **`Account` gaining address/SIREN/RCI fields for a "fill once" client
  UX.** Noted as a natural follow-up, not attempted — `finalize()` takes
  the snapshot fields as caller-supplied input this pass.
