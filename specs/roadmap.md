# Roadmap — post-core feature map

**Status: MAP ONLY. Nothing here is designed or built.** The core
product is complete and verified: both liasse regimes (2050-series and
2033-series), VAT (CA3 + Monaco), immobilisations lifecycle including
cession, cash flow, analyse financière, résultat fiscal, the AI
assistant (local reads + gated cloud writes), document attachments
(attach/prefill/Comptable IA), the dashboard, and the app-wide UX pass.
This document maps what's next, in the priority order discussed, so we
both have a shared reference to work from and update as we go — it is
**not** authorization to build any of it. Every feature below still
gets its own design-then-verify pass, reviewed and confirmed before any
code is written, exactly like every feature already shipped (VAT, the
liasse, cession, the cloud AI tier, document attachments) went through
its own spec first.

**How to read this document**: each feature is classified, given its
real dependencies (on what's already built, and on what other roadmap
items must land first), a rough sequencing note, the one or two
decisions that have to be made before a design pass can even start, and
an honest effort/complexity read. Update this file as items ship or as
decisions get made — it should stay a living map, not a one-time
snapshot.

## Classification legend

- **GATED** — touches computation, account/écriture mapping, or a
  compliance-relevant output. Needs a design-then-verify pass (like
  every gated feature already in this app): the mapping/logic is
  reviewed and confirmed *before* code is written, and verified against
  a hand-traced oracle or a real live check *after*. No autonomous
  build, ever, for these — this is the same line the whole codebase
  already draws (see CLAUDE.md's "no silent fallbacks on
  compliance-relevant logic").
- **PRESENTATION** — pure UI/UX over already-computed, already-verified
  data. Autonomous-safe, same discipline as the 2026-08-24 UX pass: no
  new computation, no new mapping, no écriture write path.

Several features below are GATED overall but contain a presentation
*layer* on top (e.g. the batch invoice queue's UI is mostly
presentation; what's gated is the propose-then-confirm seam
underneath). Classification is for the feature's risk-bearing core, not
every pixel in it.

---

## Sequencing overview

Priority order as discussed, with the actual dependency graph noted
honestly where it diverges from strict priority order (a lower-priority
item with zero dependencies on a higher one is called out, not silently
reordered):

1. **Bank reconciliation — Layer 1a (local statement import + matching engine)** — SHIPPED 2026-08-25
2. **Bank reconciliation — Layer 1b (live aggregator connectivity)** — SHIPPED 2026-08-29, with a pre-ship blocker (real Bridge sandbox verification still needed)
3. **Batch invoice review queue** — SHIPPED 2026-08-29. No technical dependency on 1/2; reused document attachment + `InvoiceExtractionService` + `propose_ecriture`'s validation gate, all already shipped — no new backend code needed at all.
4. **Traceability drill-down — Tiers 1, 2, AND 3 SHIPPED (all 2026-08-29).** No dependency on 1–3; already has its own detailed spec (folded in below); the "→ justificatif" extension (document attachments, shipped) is done as part of Tier 1. Tier 3 (VAT rate lines, 2058 `WJ`/`WG`, 2059-A) was the spec's last defined tier — this feature's scope is now fully closed — see the spec's own §4/§5/§6 and CLAUDE.md's "Traceability drill-down (Tier 1)"/"(Tier 2)"/"(Tier 3)" sections.
5. **Invoicing / facturation — Phase A SHIPPED (backend only), 2026-08-30.** Moved up from "noted, not planned" — a key feature, not a nice-to-have. See §4 below, `specs/invoicing-plan.md` (regulatory research + phased plan) and `specs/invoicing-phase-a-implementation-spec.md` (the design-then-verify pass, now implemented and verified live). Monaco is architecturally wired (one jurisdiction-parameterized engine) but its rule content is an explicit pending stub, not guessed. Phase B (PA/e-transmission) remains a later, likely separate initiative.
6. **Anomaly surfacing** — benefits from bank-rec (lettrage/matching data) and drill-down (to explain *why* something's flagged) existing first, though not hard-blocked by either.
7. **Recurring entries / templates** — SHIPPED 2026-09-05. Was genuinely independent, no dependency on anything above — picked as the lower-risk quick win over Anomaly surfacing.
8. **Reporting/export flexibility** — SHIPPED 2026-09-05. No dependency on anything above; enhanced every report already shipped.
9. **Multi-user / roles & permissions** — SHIPPED 2026-09-05. Closes the "no who" gap this cross-cutting note originally flagged (CLAUDE.md: *"this app has no authentication/user-identity model anywhere... the log honestly records only when and what, never a fabricated actor"*) — retroactively attributing "who" to the existing document-attachment/lettrage audit logs is a natural follow-up now that `req.user` exists everywhere, not done as part of this pass.

Noted but not planned: **Mobile** — see the closing section.

---

## 1. Bank reconciliation

**Classification: GATED.** A matching engine that touches `lettrage`/
`dateLettrage` and proposes changes to the ledger's own reconciliation
state is compliance-adjacent by this app's own standard, even though
matches are never auto-applied.

### Layer 1a — statement import + matching engine — SHIPPED (2026-08-25)

Built and verified live: `src/modules/bank-reconciliation/` (CAMT.053
parsing, the tiered matching engine, preview-then-confirm import,
propose/confirm/clear/ignore/create-écriture) + `src/modules/
bank-accounts/` (the new `BankAccount` model) + `EntriesService.
setLettrage()` (the compliance-aware decision below, resolved: allowed
on a validated line, audited via `LettrageAuditLog` — see CLAUDE.md's
"Bank reconciliation" section for why this narrow immutability
exception is safe and must stay narrow). CAMT.053 only, as decided;
tiered confidence (HIGH/AMBIGUOUS/NO_CANDIDATE) as decided; a real
`BankAccount` model as decided. One real gap found live and fixed:
deleting a bank-matched draft's line silently orphaned its statement
line's `CONFIRMED` status (the FK correctly nulls `matchedLigneId`,
Prisma's own default for an optional relation, but nothing reset
`status`) — self-heals on every read now.

**⚠️ PRE-SHIP BLOCKER, not a passive note.** The CAMT.053 parser is
verified only against a hand-built, spec-compliant sample
(`__fixtures__/sample-camt053.xml`) — never against a real
bank-exported file. Banks interpret the ISO 20022 standard loosely (the
parser's own 3-deep label fallback chain is already evidence of that);
a real export could easily surprise it in ways the synthetic fixture
can't. **Do not let this feature reach a real user's real bank
statement before getting at least one genuine CAMT.053 export and
re-running verification against it** — same bar this project already
held for `InvoiceExtractionService`'s PDF fixtures and the FEC export's
Test Compta Demat run. Track this as a gating item on this feature's
ship checklist, not a someday-nice-to-have. OFX/QIF/CSV and Layer 1b
(live aggregator connectivity) remain unbuilt.

### Layer 1a (original scope note, below) — statement import + matching engine (local, build first)

- **What it is**: import a bank statement (CAMT.053 primary — the ISO
  20022 standard format, ubiquitous in France/EU banking — plus OFX,
  QIF, and CSV for broader compatibility), run a matching engine that
  proposes pairings between statement lines and unlettered ledger
  lines, and a review UI where a human confirms each match before
  anything is written. **Propose-don't-post, same discipline as
  `propose_ecriture`**: no match is ever auto-applied.
- **Dependencies (already shipped, reusable)**: `EcritureLigne.lettrage`
  exists; `EntriesService`'s validated-écriture immutability rules
  already govern what can/can't be touched. **One real, already-logged
  gap this feature will need to close**: `EcritureLigne.dateLettrage`
  is **not currently settable through the API at all** (CLAUDE.md,
  "Known scope boundaries" — the only way to set it today is a direct
  Prisma script). A real lettrage-confirmation flow needs this closed
  as part of 1a's own design, not treated as pre-existing and ignored.
- **New surface**: a statement-import model (parsed lines, not
  persisted-forever raw files unless we decide otherwise), the matching
  algorithm itself (amount + date-proximity + libellé-similarity —
  exact matching rules need their own design pass), and the review/
  confirm UI.
- **Decisions needed before design**:
  1. **Which formats ship in v1.** CAMT.053 alone, or CAMT.053 +
     CSV/OFX/QIF together? Fewer formats is a smaller, faster first
     pass; more formats is more useful day one but multiplies parsing
     surface (and CAMT.053's XML shape is a genuinely different parsing
     problem from OFX/QIF/CSV's flat/row shape).
  2. **Match confidence tiers.** Does the UI distinguish "high
     confidence, one click to confirm" from "ambiguous, pick from
     candidates" from "no match, needs a manual line," or is every
     proposed match reviewed identically regardless of confidence? This
     shapes both the matching algorithm's own output contract and the
     review screen's whole layout.
- **Effort/complexity**: substantial — a new parsing layer, a new
  matching algorithm (the actual hard part; get the heuristics wrong
  and it's either noisy or misses real matches), and a new review UI.
  Realistically the single largest item on this roadmap after
  multi-user, and explicitly called out by you as the #1 functional gap
  vs. market leaders.

### Layer 1b — live aggregator connectivity — SHIPPED WITH A PRE-SHIP BLOCKER (2026-08-29)

Built and verified (with the network layer faked — no real Bridge
account exists): `src/modules/bank-aggregator/` (`BankAggregatorPort`,
mirroring `ChatModelPort`; `BridgeAggregatorAdapter`, the one adapter
this pass ships; `BankAggregatorLink`, keyed to an existing
`BankAccount`) + a small, precise extraction in
`BankStatementImportService` (`persistParsedStatement()`) so a live
sync lands in the exact same `BankStatementLine` rows a CAMT.053 upload
does — the matching engine and review UI needed zero changes, confirmed
live by calling the already-running, unmodified proposals endpoint
against a freshly-synced line. All four decisions below resolved to the
recommended option: polling only (no webhook — this app has no public
deployment story), Monaco explicitly deferred
(`NotImplementedException`, confirmed live), Bridge as the one
reference aggregator, `CredentialEncryptionService` reused verbatim.

**⚠️ PRE-SHIP BLOCKER — precise, not a soft "needs sandbox credentials"
note.** `BridgeAggregatorAdapter` is a paper design against Bridge's
public docs only, and ZERO requests have ever been sent to the real
Bridge API from this code — every endpoint path, request/response
shape, and the scope parameter are placeholders. **The
sandbox-verification pass is a real verification pass that should be
expected to find real mismatches (a wrong field name, a different
response envelope, a scope parameter that doesn't exist under this
name) requiring adapter corrections — it is not a rubber stamp that
just confirms a key works.** Getting real Bridge sandbox credentials
(an actual account/contract — outside what an agent can do) is the
prerequisite; the checklist itself, including the read-only/AIS-scope
confirmation below, is in CLAUDE.md "Bank reconciliation — Layer 1b."

**Read-only (AIS) scope — the actual mitigation for bank-token
sensitivity, confirm it's real, don't assume it from the code alone.**
The adapter requests a `scope: 'aggregation'` parameter on every
Connect session and never requests a payment (PIS) scope — but the
real Bridge parameter name/value for this is itself UNCONFIRMED (a
placeholder), so this is a stated design intent with a regression test
guarding it in code, not yet a verified guarantee. Two things the
sandbox pass must confirm: (1) the real scope parameter, and that a
session created this way genuinely cannot be used for a payment; (2)
that this app's own Bridge registration/contract was itself granted
AIS-only capability (the business-level half of this mitigation,
outside this code — the stronger guarantee, since it holds even if a
future code change forgot the scope parameter).

See CLAUDE.md "Bank reconciliation — Layer 1b" for the full design,
the honest mid-design correction (the Connect handshake itself needs
no public backend endpoint, only ongoing sync would), the full
sandbox-verification checklist, and the exact live verification
performed. OFX/QIF/CSV remain unbuilt.

### Layer 1b (original scope note, below) — live aggregator connectivity (external, build second)

- **What it is**: instead of a manual statement upload, connect
  directly to the bank via an aggregator (Bridge, Powens, or a direct
  PSD2/DSP2-compliant integration) so statement data flows in
  automatically. Feeds the **same** matching engine 1a builds — this is
  a new data-ingestion path, not a new reconciliation feature.
- **Dependencies**: 1a's matching engine must exist first (this layer
  only changes *how* statement lines arrive, not what happens once they
  do). Also depends on choosing and contracting with an aggregator
  provider — an external, costly, ongoing relationship, unlike anything
  else in this app so far.
- **The privacy line this crosses, explicitly**: every other feature in
  this app is local-first by design (chat history, local-model
  inference, document storage). Live aggregator connectivity is the
  **first feature that requires sending bank credentials/data to a
  third party continuously**, not a one-off BYO-key call like the cloud
  AI tier. It needs the **same explicit-consent treatment already built
  for the cloud AI tier** (`CloudModelCredential`'s encrypted-storage
  pattern, the two-step `ConsentDialog` with provider-specific
  disclosure copy, the always-visible engine indicator) — reuse that
  UX vocabulary, don't invent a second consent pattern.
- **Decisions needed before design**:
  1. **Which aggregator** (Bridge vs. Powens vs. a direct PSD2
     integration) — this is a business/cost/coverage decision, not a
     technical one, and it determines the actual integration shape.
  2. **Credential storage model**: does this reuse
     `CredentialEncryptionService`'s existing AES-256-GCM pattern
     verbatim, or does bank-level access warrant a stronger threat
     model than the one explicitly documented for the cloud AI tier
     ("defends against a leaked DB backup... does NOT defend against
     full machine access")? Worth an explicit answer rather than
     inheriting the weaker precedent by default.
- **Effort/complexity**: substantial, and largely *external* — provider
  integration, credential handling, and the ongoing operational
  relationship with an aggregator are a different kind of work than
  anything else on this roadmap (less "design the algorithm," more
  "integrate a third-party API and handle its own failure modes").

---

## 2. Batch invoice review queue — SHIPPED (2026-08-29)

Built and verified live: `frontend/src/pages/BatchInvoiceQueuePage.tsx`
(route `/factures/lot`) + one small, additive `initialFile?: File` prop
on `EcritureEditor.tsx`. **No new backend code was needed** — confirmed
by research before design, then confirmed live: `/documents/extract`
and `/documents/suggest-accounts` already operate one-file-per-call,
which is exactly the shape that sidesteps the known multi-invoice
chaining reliability gap (see CLAUDE.md "AI chatbot Phase 2") — a queue
calling them independently per invoice never assembles the multi-file
prelude that gap depends on. Both decisions below resolved to the
recommended option: local-first baseline with cloud suggestion optional
per item; client-side-only queue state, nothing persisted until each
item's own confirm click. Live verification (two real Phase-2 fixture
invoices, real browser, real backend) confirmed independent per-item
extraction with zero cross-contamination, a real draft écriture created
with its file attached on confirm, and a clean "Ignorée" skip path with
no écriture created — see CLAUDE.md "Batch invoice review queue" for
the full design and verification record.

**Classification: GATED at the seam.** The queue UI itself (a stack of
draft proposals to page through) is presentation-shaped, but every
individual draft it produces must still pass through the exact same
`propose_ecriture`-equivalent confirmation gate (`EntryValidationService`,
via the ordinary `POST /entries`) a single manual proposal does — it
must **not** auto-post, no matter how "obviously correct" a batch
result looks. That seam is the gated part; nothing about batching
changed it. No bulk-confirm was built this pass, deliberately — see
CLAUDE.md for why the bank-rec Layer 1a precedent doesn't map cleanly
here.

### Original scope note, below

- **What it is**: drop a folder of invoices in → get back a reviewable
  stack of proposed drafts (one per invoice), each still requiring
  individual human confirmation before it becomes a real écriture.
- **Dependencies (already shipped, reusable)**: this is explicitly an
  **assembly of pieces that already exist and are already verified**:
  document attachment (`EcritureDocumentsService`, the viewer),
  `InvoiceExtractionService` (deterministic extraction, already
  multi-file-capable per the AI chatbot's own multi-invoice testing),
  and `propose_ecriture` / `DocumentSuggestionService`'s cloud-account-
  suggestion path for the "Comptable IA"-style per-invoice suggestion.
  **Known, already-logged reliability gap to inherit knowingly**:
  CLAUDE.md's Phase 2 section documents that multi-invoice chaining
  specifically has a *reliability* gap even though its *safety* gate
  holds ("the model's own proposal-building for the first invoice then
  used guessed literal account numbers... correctly rejected by the
  balance check, no écriture created, but a real reliability gap"). A
  batch queue built on the same mechanism inherits that same
  reliability profile — worth deciding up front whether the queue design
  works around it (e.g., each invoice's extraction/suggestion call
  stays fully independent, never chained in one model turn) rather than
  discovering it live again.
- **Decisions needed before design**:
  1. **Does every queue item route through the cloud "Comptable IA"
     suggestion, or does the queue also work in a fully local/manual
     mode** (deterministic prefill only, no AI account suggestion) for
     someone without a configured cloud provider? The document-
     attachment feature already treats these as separable layers;
     worth deciding whether the queue keeps that separation or requires
     cloud.
  2. **Queue persistence and abandonment**: if a user closes the queue
     mid-review with drafts still unconfirmed, are those drafts already
     real (unvalidated) écritures sitting in the normal Écritures list,
     or held in some queue-only staging state until explicitly
     confirmed? This affects both the data model and what "reviewed 8
     of 20, closed the tab" actually leaves behind.
- **Effort/complexity**: moderate — the individual pieces are already
  built and verified; the real work is the queue UI/UX (paging,
  bulk-vs-individual actions, progress state) and deciding the two
  points above, not new domain logic.

---

## 3. Traceability drill-down

**Classification: GATED. Tiers 1, 2, AND 3 SHIPPED (all 2026-08-29)** —
see the spec's own §4/§5/§6 and CLAUDE.md's "Traceability drill-down
(Tier 1)"/"(Tier 2)"/"(Tier 3)" sections for the verification records.
Reverse computation (line → accounts → écritures) sitting on top of
several independently-forward-verified computations — a wrong reverse
mapping is a wrong compliance artifact, not a cosmetic bug. Tier 3 was
the spec's own last defined tier (item 4 below, "Cash flow / Analyse
financière," was explicitly deferred to its own follow-up conversation,
never numbered as part of this feature's tiers) — this feature's scope
is now fully closed.

**Already fully scoped** in
`specs/liasse-drilldown-traceability-implementation-spec.md` — that
document is the actual spec for this feature; what follows is a
summary, not a replacement. Read the full spec before this feature's
design pass starts.

- **The oracle** (non-negotiable, same discipline as
  `assertVncTiesToLedger`/`assertCashFlowReconciles`): the sum of the
  detail returned for a clicked line must equal that line's own value,
  exactly, for the same fiscal year — enforced by a throwing assertion,
  proven by a hand-traced oracle test before any endpoint exists.
- **Four tiers, ordered by risk/reuse, already sequenced in that spec**:
  1. **Bilan/CDR family** (tier 1) — reuses `resolveLineCode()` +
     the existing `AccountLedgerDrilldown` component; covers 2057 for
     free once bilan traces (2057's own rows are just relabeled bilan
     lines). **One documented landmine**: dual-nature accounts
     (512/514/516/517 overdraft; the 428/438/…/468 family) must be
     classified by the account's aggregate-balance sign, never a single
     ligne's sign — the exact bug the 2057 maturity-split build already
     hit and fixed once (`buildMaturityTotals()`'s own doc comment).
  2. **2054/2055/2056** (tier 2) — simpler than tier 1, no dual-nature
     landmine at all; could ship alongside tier 1.
  3. **VAT rate lines, 2058 `WJ`/`WG`, and 2059-A** (tier 3, SHIPPED
     2026-08-29) — all three shipped together as Tier 3, per CLAUDE.md's
     "Traceability drill-down (Tier 3)". VAT's per-ligne rate tagging
     (`EcritureLigne.vatRateId`) turned out to be the real new shape (the
     same account can appear at multiple rates — confirmed live);
     `WJ`/`WG` reused the already-proven single-account pattern from VAT
     ligne 19/20 as predicted. 2059-A's schema gap (`FixedAsset` had no
     stored reference to the écriture `disposeFixedAsset()` posted, so
     tracing a disposal row would have meant *searching* by
     account+date+amount) was closed first via a new nullable
     `FixedAsset.cessionEcritureId` field, chosen over the alternatives
     through `AskUserQuestion` before any Tier 3 code was written.
  4. **Cash flow / Analyse financière** — explicitly deferred in the
     spec itself to its own follow-up conversation; most of its lines
     are deltas-between-fiscal-years or arithmetic-over-other-lines, a
     genuinely different "formula trace" UI shape from "here is a list
     of écritures," not just a harder version of tiers 1–3.
- **New extension beyond the existing spec, worth folding in explicitly
  at this feature's own design pass**: now that document attachments
  ship, the natural end of a drill-down chain is "→ the attached
  justificatif," not just the écriture list — clicking a figure → its
  accounts → its écritures → whatever invoice/receipt is attached to
  each. This ties the two features together and should be scoped as
  part of this feature's design pass, not as a third, separate feature.
- **Decisions needed before design**: the existing spec already lists
  six (API shape, shared-assertion helper, drill-down period scope,
  UI-reuse pattern, large-line filtering, drafts-are-moot) — see that
  document's §2 rather than re-deriving them here. The one *new*
  decision this roadmap surfaces: **does the "→ justificatif" extension
  ship as part of tier 1, or as its own follow-up once tiers 1–3 land**
  — worth deciding explicitly rather than assuming it's bundled.
- **Effort/complexity**: tiers 1–3 are honestly described in the
  existing spec as mechanical/low-risk given the reusable primitives;
  tier 4 (2059-A) needs a schema decision first; cash flow/analyse
  financière is explicitly out of scope for now.

---

## 4. Invoicing / facturation

**Classification: GATED — and STATUS: Phase A SHIPPED — generation +
gated posting (2026-08-30), Factur-X rendering (2026-08-31), frontend
(2026-08-31), cash-basis VAT + devis PDF + bank payment details
(2026-08-30, a later same-day pass).** Moved up from "noted, not
planned" — per the standing instruction, this is a key feature, not a
nice-to-have — but French/Monaco invoicing is entangled with the
phasing e-invoicing reform (facturation électronique), so the
regulatory ground was established against primary sources first, the
same discipline this app already applies to FEC/CA3/Monaco VAT/liasse,
before any code was written. **Full regulatory findings (cited) and
the phased plan are in `specs/invoicing-plan.md`; the two build-then-
verify passes are in `specs/invoicing-phase-a-implementation-spec.md`
(generation + ledger posting) and
`specs/invoicing-factur-x-implementation-spec.md` (the real Factur-X
1.09/EN16931 file, validated against the official XSD + Schematron);
the full verification record for all of it is in CLAUDE.md "Invoicing
— Phase A", "Invoicing — Factur-X rendering", "Invoicing — frontend",
and "Invoicing — cash-basis VAT (TVA sur les encaissements), devis
PDF, bank payment details" — this section is a summary, not a
replacement, same pointer-not-duplicate convention as every other
detailed spec referenced from this roadmap. The frontend (`/factures`)
is now built and live-verified for generation, Factur-X, devis, and
cash-basis VAT alike.**

- **The headline regulatory finding**: compliant invoice *generation*
  (correct legal mentions, a real data model, PDF/Factur-X output, and
  — the actually gated part — posting the sale to the ledger through
  the existing validated write path) needs **zero external
  accreditation** and can be built now. Compliant invoice
  *transmission* under the reform (September 2026 for grandes
  entreprises/ETI émission + universal réception, September 2027 for
  PME/TPE/micro-entreprises émission — Loi de finances 2024, reconfirmed
  by LF2026 art. 123 after a postponement amendment was rejected in
  April 2025) requires routing through a DGFiP-accredited **Plateforme
  Agréée (PA, formerly "PDP")** — a formal, audited, ~3-year
  accreditation this project has no reason to pursue itself. The
  workable shape mirrors bank-rec exactly: **integrate with an existing
  accredited PA via API** (147 already accredited as of August 2026),
  never become one — the same "adapter to an external provider, don't
  rebuild the provider" pattern as `BridgeAggregatorAdapter`.
- **Monaco is a genuinely open regulatory question, not resolved by
  assuming symmetry with France** — the official Monaco government
  portal (`monentreprise.gouv.mc`, updated as recently as 2026-07-28)
  still describes only the pre-reform, e-signature-based dematerialized
  invoice regime (Ordonnance Souveraine n°4.199 of 2013 / n°9.821 of
  2023) with no mention of a mandatory-PA-platform requirement or the
  September 2026/2027 calendar; only secondary sources (not an official
  Monaco text) assert Monaco follows the French calendar via the shared
  VAT territory. Flagged, not resolved — see the plan doc's own
  "Monaco compliance" discipline for why this can't be papered over.
- **Two phases, split at exactly the same seam bank-rec split at**:
  - **Phase A — compliant invoice generation + ledger posting — SHIPPED,
    backend only (2026-08-30).** Data model (`Invoice`/`InvoiceLine`,
    reusing the existing 411-family Tiers mechanism for the client),
    mandatory legal mentions (France implemented against CGI Annexe II
    art. 242 nonies A + Code de commerce art. L441-10; Monaco an
    explicit pending stub, not a silent copy), and — the GATED core —
    a validated invoice posting a real, balanced écriture
    (411/707/44571-shaped, per-rate `vatRateId` tagging) through the
    existing `EntriesService` path, never a privileged write. Verified
    live on both the FR and Monaco demo companies — see CLAUDE.md
    "Invoicing — Phase A" for the full record. **Factur-X 1.09/EN16931
    rendering — SHIPPED (2026-08-31)**: `GET
    /invoicing/invoices/:id/factur-x` returns a real PDF/A-3 file with
    the CII XML embedded, validated against the official XSD +
    Schematron EN16931 business rules both before and after embedding
    — see `specs/invoicing-factur-x-implementation-spec.md` and
    CLAUDE.md "Invoicing — Factur-X rendering" for the full record,
    including two real bugs found and fixed (a Windows-only upstream
    `libxml2-wasm` bug, and a PEPPOL Schematron empty-element rule).
    Only standard-rated invoices are supported (VAT-exempt lines throw
    rather than guess a category code). **The frontend — SHIPPED
    (2026-08-31)**: `/factures` (`InvoicingPage`) covers draft create/
    edit, gated finalize, the finalized-invoice detail view with
    mentions + Factur-X download, and avoir (credit-note) creation —
    all live-verified in a real browser, including a real bug found and
    fixed the same day (a missing `@HttpCode(NO_CONTENT)` on the DRAFT
    delete endpoint made a successful deletion surface as a false "La
    suppression a échoué." error) — see CLAUDE.md "Invoicing —
    frontend" for the full record.
  - **Phase B — PA/e-transmission integration**, sequenced like bank-rec
    Layer 1b, NOT started: choosing and contracting with an accredited
    PA is an external, commercial decision (not a technical one this
    project can resolve alone), flagged as its own later initiative
    rather than folded into Phase A. A `InvoicingTransmissionPort`-
    shaped abstraction (mirroring `BankAggregatorPort`) is the intended
    shape once a real, accredited, publicly documented PA API exists —
    see `specs/invoicing-plan.md` for a POTENTIAL provider signal being
    watched, not yet acted on.
- **The five decisions, all RESOLVED** — see
  `specs/invoicing-phase-a-implementation-spec.md` for the full
  reasoning behind each: numbering (a separate `nextInvoiceNum`
  sequence, assigned only at finalize, shared by SALE and CREDIT_NOTE);
  avoirs (one `Invoice` model with a `type` discriminator, independent
  line items, the posting direction reversed); the invoice→écriture
  posting model (draft-then-finalize, mirroring écriture validation,
  the same two-step accepted-risk shape as `cessionEcritureId`);
  multi-currency (out of scope, no currency field added); and the
  mandatory-mentions data model (a pure `computeInvoiceMentions()`
  function, jurisdiction-branching, France implemented / Monaco
  pending).
- **Effort/complexity**: Phase A shipped at the "substantial but fully
  internal" size predicted — closest precedent was the liasse/CA3 build
  discipline (data model + compliance mapping + a real compute
  pipeline). Phase B remains substantial and largely external, same
  shape as bank-rec Layer 1b (adapter + accreditation-adjacent provider
  relationship, not algorithm design) — not started.

---

## 5. Anomaly surfacing — SHIPPED (2026-09-05)

Built and verified live: `src/modules/anomalies/` — two pure engines
(`spending-anomaly-engine.ts`, `invoice-anomaly-engine.ts`, mirroring
`matching-engine.ts`'s own zero-I/O split), a new `AnomaliesService`/
`AnomaliesModule`/`AnomaliesController` (`GET /anomalies`), and a
frontend dedicated screen (`/anomalies`) plus an independently-loading
dashboard tile. Both decisions below resolved (user chose both anomaly
shapes together, a trailing-average + fixed-multiplier threshold,
charges/produits-only account scope, and both a dashboard tile AND a
dedicated screen). See CLAUDE.md "Anomaly surfacing" for the full
design and verification record — including a real false-positive bug
(a bad interaction between `TRAILING_MONTHS`/`MIN_HISTORY_MONTHS`/
`MULTIPLIER` that would have flagged any perfectly flat, non-deviating
recurring expense) found and fixed before shipping, by hand-tracing a
test case rather than by inspection.

**Classification: GATED.** Computing and comparing figures (an expense
vs. its category's historical norm, an unlettered payment that appears
to match an open invoice, an unusual TVA rate shift) is exactly the
kind of "wrong compliance-adjacent artifact" risk this app already
gates everywhere else.

### Original scope note, below

- **What it is**: gentle, non-judgmental flags surfaced to the user —
  never auto-acted-on, never blocking, never silently correcting
  anything. The whole point is to **notice and surface**, the same
  "flag, don't fake" discipline already established for 2059-A's
  court-terme/long-terme gap and 2057's maturity-default bucket.
- **Dependencies**: benefits from bank-rec (Layer 1a) existing, since
  "an unlettered payment matching an invoice" is literally the same
  matching-heuristic shape bank-rec's own engine needs — these two
  features may end up sharing real logic (a fuzzy amount+date+libellé
  matcher), not just a conceptual similarity. Benefits from drill-down
  existing too, so a flagged anomaly can show its own "why" via the
  same accounts/écritures trace rather than a bare assertion. Neither
  is a hard blocker, but designing anomaly surfacing *after* both would
  likely mean less duplicated matching logic.
- **Decisions needed before design**:
  1. **What counts as a "norm" to compare against**, concretely: a
     trailing N-month average per account? Per account+tiers pair? Does
     it need at least N months of history before it can flag anything
     (and what happens for a brand-new company with no history yet)?
     This is the actual hard design question — get the norm-computation
     wrong and every flag is noise, which defeats the feature's own
     "gentle, meaningful" premise.
  2. **Where flags surface**: the dashboard (a new tile), inline in the
     journal entry grid (next to the line itself), both, or a dedicated
     screen? Different placements imply different UX and different
     "how many flags is too many to show at once" answers.
- **Effort/complexity**: moderate-to-substantial, and the risk is less
  "will it work" and more "will it be trustworthy" — a noisy or
  wrong-feeling anomaly detector actively erodes trust in an accounting
  tool faster than most other features would. This one deserves an
  unusually careful design pass relative to its apparent size.

---

## 6. Recurring entries / templates — SHIPPED (2026-09-05)

Built and verified live: `src/modules/recurring-entries/`
(`RecurringEntriesService` — CRUD + `previewApplication()`, which
resolves accounts/journal/fiscal year and validates via the SAME
`EntryValidationService` methods `propose_ecriture` uses, never persists
itself), `RecurringTemplatesPage` (`/modeles`, reachable from
Paramètres), and a "Depuis un modèle" flow on `JournalEntriesPage`
opening the ordinary `EcritureEditor` pre-filled via a new additive
`prefill` prop. Both decisions below resolved to the recommended option
(v1: on-demand apply only, no scheduler at all — confirmed the app has
zero background-job infrastructure; fixed default amounts per line,
freely editable at apply time since the editor already supports that
for free). See CLAUDE.md "Recurring entries / templates" for the full
design and verification record, including the account-by-NUMBER /
journal-by-ID storage decision and why the template-apply editor
instance deliberately ignores the journal grid's own currently-selected
tab/fiscal year.

**Classification: GATED, lightly.** It creates real écritures, but only
ever through the normal `EntriesService.create()`/`validate()` path
already used everywhere else — no new write primitive, no new
computation. The gate here is about template *scheduling/application*
logic being correct, not about a new kind of ledger risk.

### Original scope note, below

- **What it is**: book repeating entries (rent, salaries, subscriptions)
  from a saved template, on a schedule or on demand.
- **Dependencies**: none beyond what's already shipped. Genuinely the
  most self-contained gated item on this list.
- **Decisions needed before design**:
  1. **Does application require confirmation each time, or can a
     template auto-post on schedule?** Given this app's own "propose,
     never auto-post" discipline elsewhere (`propose_ecriture`,
     document account suggestions), auto-posting on a schedule would be
     a real departure from precedent — worth an explicit decision
     rather than defaulting to convenience. Recommendation to weigh:
     auto-*draft*, never auto-*validate*, keeping the human confirmation
     step exactly where it already sits for every other creation path.
  2. **What varies between applications of the same template** (date
     only, or amounts/tiers too — e.g. a rent template with a fixed
     amount vs. a salary template where net pay varies month to month)?
     This shapes the template's own data model.
- **Effort/complexity**: low relative to the rest of this roadmap —
  candidate for a quick win if a higher-priority item is blocked on a
  decision.

---

## 7. Reporting/export flexibility — SHIPPED (2026-09-05)

Built and verified live: a new shared PDF renderer
(`src/common/pdf/pdf-report-renderer.ts`, `PdfReportBuilder` — generic
section/key-value/paginating-table primitives, extracted since the
only prior PDF code, Factur-X's `factur-x-pdf.ts`, is confirmed
invoice-specific with no reusable pagination) plus two tiny Excel
helpers (`src/common/excel/excel-report-helpers.ts`). Every report
already computed and displayed on screen now has BOTH a PDF and an
Excel export — trial balance/grand livre, cash flow, analyse
financière, CA3/Monaco VAT, résultat fiscal, and the liasse fiscale
(both regimes) — via sibling `.../export/pdf` / `.../export/excel`
endpoints mirroring each report's own existing compute endpoint's verb
and DTO exactly (all `POST` with a body except ledger's trial balance,
which stays `GET` with query params). All three of the user's own
scope choices went to the LARGER, non-recommended option: build the
shared renderer (this was actually the recommended one), include the
liasse fiscale in this same pass rather than deferring it, and give
every report both formats rather than splitting PDF-for-some/
Excel-for-others. See CLAUDE.md "Reporting/export flexibility" for the
full design and verification record, including a real production bug
found and fixed along the way: exporting the FR demo company's own
real trial balance 500'd because a real account's label (free-text,
entered live during an earlier pass) had genuinely lost data at some
point and now contains the literal Unicode replacement character
(U+FFFD), which pdf-lib's WinAnsi encoding can't draw — fixed by
extending the renderer's existing `sanitizeForWinAnsi()` backstop
(originally built for a different encoding gap, the Unicode minus
sign), with a regression test locking it in.

**Classification: MOSTLY PRESENTATION**, confirmed correct in
hindsight — no report in this pass needed a new computed figure; every
export is a pure rendering of an already-verified service's own
output.

### Original scope note, below

- **What it is**: PDF/Excel export of reports already computed and
  displayed on screen (liasse, CA3, résultat fiscal, cash flow, analyse
  financière, ...). The FEC export already shipped is the precedent for
  "a real compliance-format export done right" — same rigor (exact
  formatting, a fixture test pinning the output shape) applies to any
  new export, even a presentation-classified one.
- **Dependencies**: none — every report this would export already
  exists and is already verified. Reuse Anthropic's own pdf/xlsx
  generation skills for the actual file-building rather than hand-
  rolling a PDF/Excel writer.
- **Decisions needed before design**:
  1. **Which reports get export first**, and in what format(s) — PDF
     for anything meant to be filed/printed/shared as-is (liasse, CA3),
     Excel for anything meant to be further worked with (trial balance,
     grand livre)? Worth deciding the report→format mapping up front
     rather than building one-size-fits-all.
  2. **Does any export need a figure that doesn't exist today** — flag
     these explicitly per-report before starting, since that's the one
     way this "mostly presentation" item quietly becomes gated for a
     specific report.
- **Effort/complexity**: low per report once the pdf/xlsx generation
  pattern is established for the first one; the FEC export precedent
  means the rigor bar is already known, not something to invent.

---

## 8. Multi-user / roles & permissions — SHIPPED (2026-09-05)

Built and verified live: `backend/src/modules/auth/`,
`backend/src/modules/memberships/`, `backend/src/common/auth/` —
self-hosted email+password auth (JWT access token + rotating,
reuse-detecting opaque refresh token in an httpOnly cookie) and a
coarse Owner/Member/Read-only permission model per company, enforced
once, globally, via a new `ReadOnlyGuard`. Both were the user's own
explicit choices, made via `AskUserQuestion` before design. `User`/
`Membership`/`RefreshToken`/`PasswordResetToken`/`CompanyInvite` are
new Prisma models; `CompanyContextMiddleware`'s old "guess the single
company" fallback is gone, replaced by a real membership lookup. See
CLAUDE.md "Multi-user / roles & permissions" for the full design and
verification record, including two real bugs found and fixed the same
day: `@nestjs/jwt`'s ESM-only package broke this backend's CommonJS
Jest transform (fixed by depending on `jsonwebtoken` directly instead),
and adding the TopBar's user/logout element caused genuine page-level
horizontal overflow at a narrow window width (fixed with a responsive
breakpoint). This was the last item on this roadmap.

**Classification: GATED — and its own substantial project**, not a
UI feature. This is access control and data integrity, not
presentation, and it's the one item on this roadmap that isn't an
extension of an existing pattern — it's new foundational surface.

### Original scope note, below

- **What it is**: either an accountant serving multiple clients (one
  login, several companies, presumably different permission levels per
  company) or a team with roles within one company (or both).
- **The real starting fact, confirmed by grepping the codebase for this
  roadmap**: **this app has no authentication/user-identity model
  anywhere** — no `User` table, no password/credential handling, no
  auth guard, nothing. This has been noted honestly at several points
  already (the document-attachment audit log's own "no who" limitation;
  the AI chat's session model has no user scoping either) but never
  addressed, because nothing needed it yet. This feature is where that
  changes.
- **Interaction with the existing multi-tenant model**: the schema and
  service layer are already genuinely multi-tenant
  (`CompanyContext`/`companyId`-on-every-table, per CLAUDE.md's
  "Multi-tenant data model" — built this way from day one specifically
  so a company picker/multi-company UI wouldn't need a migration
  later). A company-switcher UI already exists (the recent
  create-company work). **What's missing is the orthogonal axis**: WHO
  is allowed to see/act on which company, and at what permission level
  — today, anyone with API access can address any company by id, with
  zero access control. Multi-tenancy (data separation) and multi-user
  (identity + access control) are two different concerns this app has
  only ever solved the first of.
- **Decisions needed before design** (genuinely just the two biggest of
  many — this feature will need its own, much longer decision list at
  its actual design pass):
  1. **Authentication mechanism**: self-hosted email+password, an
     external identity provider (OAuth/SSO), or something else —
     this decides almost everything else about the shape of the work
     (session handling, password reset, whether this app now has a
     "forgot password" email-sending obligation it never had before).
  2. **Permission model shape**: coarse (owner vs. read-only per
     company) vs. fine-grained (per-module permissions — can validate
     écritures but not close fiscal years, can view VAT but not liasse,
     etc.). Fine-grained is far more work and touches every existing
     controller's guard logic; coarse is a much smaller first pass.
- **Effort/complexity**: **the largest single item on this roadmap**,
  by a wide margin — every other feature here extends an established
  pattern; this one establishes a pattern several other parts of the
  app (audit logs, chat sessions, future features) would benefit from
  retroactively. Worth treating as its own multi-phase project with its
  own roadmap once it's picked up, not a single design-then-build pass
  like the items above.

---

## Noted, not planned

### Mobile

Not scoped here — flagged as its **own separate initiative**. Receipt
capture on the go is the main draw (photograph a receipt, feed it into
the same deterministic-extraction/prefill pipeline document attachments
already built) — but "mobile" as a whole is a platform decision (native
apps? a responsive web view? which OS first?) well beyond this
roadmap's scope.

---

## Closing note

This document is a **map**, current as of 2026-09-05. Nothing above has
been designed, and nothing above should be built from this document
alone — each feature gets its own design-then-verify pass, reviewed and
confirmed before any code is written, when we reach it. Update this
file as items ship, as decisions get made, or as priorities shift, so
it stays the accurate shared reference rather than a stale snapshot.

**Next up**: every item on this roadmap (§1-§8) is now SHIPPED.
**Multi-user / roles & permissions (§8)**, the largest single item and
the one item that wasn't an extension of an existing pattern, is now
fully shipped — see CLAUDE.md "Multi-user / roles & permissions" for
the full design and verification record, including two real bugs found
and fixed the same day (an ESM-only dependency breaking the Jest
transform, and a genuine page-level horizontal-overflow regression in
`TopBar.tsx`, both fixed and re-verified live). Fine-grained per-module
permissions and OAuth/SSO were the user's own explicitly deferred
choices for a future phase, not gaps discovered late. Any further work
here is a new, separately-scoped initiative, not a continuation of this
one. Reporting/export flexibility (§7) is now fully shipped — see CLAUDE.md
"Reporting/export flexibility" for the full record, including a real
production bug (a corrupted Unicode replacement character in a real
account label) found and fixed before shipping. Anomaly
surfacing (§5) is now fully shipped — see CLAUDE.md "Anomaly
surfacing" for the full record, including a real false-positive bug
found and fixed before shipping. Recurring entries / templates (§6) is
also fully shipped — see CLAUDE.md "Recurring entries / templates" for
the full record. Invoicing (§4) Phase A is now fully shipped
(generation, gated posting, Factur-X rendering, and the frontend) on
both required companies; Phase B (PA/e-transmission) stays blocked on
an external, commercial PA-provider decision this project can't
resolve alone, and Monaco's own transmission-regime question stays
open — see `specs/invoicing-plan.md`.
