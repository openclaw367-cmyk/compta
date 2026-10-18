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

**All of §1-§9 above are now SHIPPED** (see the closing note). The next
planning horizon — connecting this now-deep accounting core to the
business processes around it (procure-to-pay, quote-to-cash,
comptabilité analytique, and an honest look at CRM/project-management/
payroll-engine territory) — is mapped separately in **"Business-
operations / ERP direction"** below, organized by coupling to the
ledger rather than by this section's own priority order.

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

## Business-operations / ERP direction

**Status: MAP ONLY, same as the rest of this document — nothing below
is designed or built.** Items §1-§9 above are the "deepen the core
accounting product" roadmap, and all of it has shipped. This section is
the next planning horizon: connecting that (now genuinely deep,
compliance-verified) accounting core more directly to the business
processes that feed it — procurement, sales, inventory, cost
accounting, payroll — organized deliberately around **coupling to the
ledger**, not feature glamour, per the explicit brief for this section.
Every item below still gets its own design-then-verify pass before any
code is written, exactly like every feature already shipped.

### Why "coupling to the ledger" is the organizing axis here

The rest of this roadmap uses GATED/PRESENTATION as its only axis,
which is the right question for a compliance feature (does it touch
computation/écriture-mapping, yes or no). For business-operations work,
that question alone under-describes the real risk profile: a feature
can be GATED (it posts to the ledger) while still being *mostly* a
workflow/state-machine problem (a purchase order's own lifecycle), or
PRESENTATION while sitting *directly* on top of the ledger's own
verified numbers (a budget-vs-actual report). The tiers below layer a
second axis — how tightly the feature's own correctness depends on
this app's existing hand-traceable, primary-source-verified ledger —
because that's what determines whether the existing "verify against a
primary source, hand-trace an oracle" discipline can even apply. The
GATED/PRESENTATION tag from the legend above is still given for every
item; read it alongside the tier, not instead of it.

### Honest inventory — what already exists beyond core accounting

Verified directly against `backend/prisma/schema.prisma` (every model
name in the schema was enumerated and checked, not recalled from
memory) before writing this, since an "honest inventory" is worthless
if the negatives ("X doesn't exist") are guessed rather than confirmed.

**Real, shipped, business-operational modules:**

- **Invoicing / Ventes (Invoicing Phase A + Factur-X + frontend + cash-
  basis VAT + client identity)** — backend AND frontend, verified live
  repeatedly on real data (see CLAUDE.md's several "Invoicing —" 
  sections). `Invoice`/`InvoiceLine`, `SALE`/`CREDIT_NOTE` only (no
  `PURCHASE`/bill type — confirmed via the `InvoiceType` enum, two
  values), gated posting through the ordinary `EntriesService`, a real
  EN16931 Factur-X export, a devis PDF mode, per-tiers identity capture
  feeding invoice pre-fill. **The most mature business-operational
  module in this app** and the natural anchor for Tier 1 below.
- **Bank reconciliation** — Layer 1a (CAMT.053 + CSV import, tiered
  matching engine, `lettrage`) real and live-verified; Layer 1b (Bridge
  aggregator) architecturally real but explicitly flagged as an
  unverified paper design pending real sandbox access. The closest
  thing this app has to a "payments" integration today — but it's
  reconciliation (matching an existing ledger line to a bank movement),
  never payment *initiation*.
- **Recurring entries / templates** — real, a light "standing charge"
  mechanism (rent, a subscription), on-demand apply only, no scheduler.
- **AI chatbot (`propose_ecriture` + invoice extraction + cloud tier)**
  — real, an automation/assistant layer over the SAME gated write path
  everything else uses; not itself a business-process module, but
  relevant below since some Tier-1 candidates (supplier bill capture)
  could reuse its deterministic-extraction pipeline directly.
- **Anomaly surfacing** — real; notably, its `computePaymentAnomalies()`
  ALREADY derives an ad-hoc "is this invoice paid" signal from
  `EcritureLigne.lettrage`, because (confirmed below) `Invoice` itself
  has no such field. This is a real, working piece of logic in the
  wrong place — see Tier 1's "invoice payment status" item.
- **Dashboard, multi-user/roles, Plan Comptable module, command-palette
  search** — real, but infra/presentation, not business-operational in
  the ERP sense this section is about.

**Confirmed as NOT existing, checked directly against the schema (no
model, no field, anywhere) — not assumed absent:**

- **Achats / Purchasing, as a module.** No `PurchaseOrder`, no
  `Bill`/`SupplierInvoice`/`Facture fournisseur` entity — nothing
  beyond a bare écriture. A purchase invoice today is either keyed by
  hand into the AC journal, brought in via Excel/FEC import, or
  extracted by the AI chatbot into a *proposed* écriture — in every
  case it becomes a plain journal entry with no persisted document
  lifecycle, no link back to an order, and no approval step.
- **Quote/Devis as a lifecycle entity.** `computeDevisMentions()`
  renders a NOT-YET-FINALIZED `Invoice` draft as a devis PDF — there is
  no separate `Quote` model, no accepted/rejected/expired state, no
  "convert to order" step. What this app calls a "devis" today is a
  rendering mode of a draft invoice, not a quote with its own
  lifecycle.
- **Commande (Sales Order or Purchase Order) as a persisted entity.**
  Confirmed absent. Quote → cash today is really just "draft invoice →
  finalized invoice"; there is no intermediate order stage that could
  differ from either (partial fulfillment, renegotiated quantities,
  multiple invoices against one order).
- **Bon de livraison / Réception marchandise (delivery / goods
  receipt).** Confirmed absent — no persisted delivery event on either
  side of the ledger.
- **Stock / Inventory, entirely.** No `Product`/`Article` catalog, no
  `Stock`/`StockMovement` model, no valuation logic. Confirmed even at
  the invoice-line level: `InvoiceLine` has `quantity`/`unitPriceHT`
  but no `productId` — quantities are free-typed per line, not resolved
  against any catalog.
- **Payroll — not even an interface.** No `Employee`/`Payslip`/payroll
  model of any kind. Salaries today would have to be journaled by hand
  like anything else, with none of this app's own domain vocabulary
  (no "charges de personnel" template, no cotisations mapping).
- **Comptabilité analytique (cost/project/cost-center accounting).** No
  analytical dimension anywhere on `EcritureLigne` — confirmed by
  re-reading its full field list (compteId, compteAuxId, debit, credit,
  lettrage, dateLettrage, montantDevise, idDevise, vatRateId,
  dateEcheance — no cost-center/project tag). The closest existing
  precedent for "tag a line with an extra dimension and aggregate by
  it" is `vatRateId`, which is exactly the pattern to reuse (see Tier
  2), not something to invent fresh.
- **Budgeting / forecasting.** No `Budget` model. "Analyse financière"
  is real but entirely retrospective (SIG cascade, ratios, BFR/FR/
  trésorerie nette) — it has no concept of a planned figure to compare
  against, so "budget vs. actual" doesn't exist in any form today, not
  even a crude one.
- **CRM, beyond the Tiers/Account identity fields already built for
  invoicing** (name, address, SIREN/RCI, VAT number). No contact
  activity history, no pipeline/opportunity stage, no lead concept.
- **Project management.** Nothing — no task, milestone, or timesheet
  concept anywhere in the schema.
- **Invoice payment status, as a first-class field.** `Invoice` has
  `encaissementConfirmedAt`/`encaissementEcritureId`, but these are
  narrowly VAT-exigibility metadata (cash-basis VAT for services,
  whole-invoice only, explicitly not a payment tracker per its own
  schema doc comment) — not a general paid/unpaid/overdue status. The
  real signal (`EcritureLigne.lettrage`) exists and is even already
  read by the anomaly engine, but nothing surfaces it as an invoice
  property.

This is a genuinely different starting point than "we have accounting
and need to add ERP modules" — this app already has a real, deep sales/
invoicing module and a real bank-matching module; what's missing is
almost entirely on the **purchasing side**, the **connective tissue**
between existing pieces (quote↔order↔delivery↔invoice↔payment as one
traceable chain, not independent islands), and the **management-
accounting layer** (analytical dimensions, budgets) that would let this
app's own already-verified numbers answer more business questions.

---

### Tier 1 — tight coupling: the operational event IS an accounting event

The unifying idea: extend the ALREADY-MATURE invoicing/ledger core with
the connective entities and links that turn "create an invoice" and
"post a purchase" into real, traceable, multi-stage business processes
— reusing `EntriesService`/`EntryValidationService` verbatim for every
actual ledger write, exactly like Invoicing, cession, and à-nouveau
already do. No new posting primitive anywhere in this tier.

#### 1a. Quote-to-cash — Quote and Order as real, persisted entities

- **What**: a `Quote` model (draft/sent/accepted/rejected/expired) and
  an `Order` model (commande client), sitting BEFORE `Invoice` in the
  lifecycle instead of collapsing everything into "draft invoice."
  `Invoice` gains an optional `sourceOrderId` (mirroring the existing
  `correctsInvoiceId` pattern already on the model) so the full chain
  is queryable end to end. A quote's acceptance pre-fills an order; an
  order's (partial) invoicing creates one or more `Invoice` rows linked
  back to it.
- **Classification: PRESENTATION for the entities/state machine
  themselves** (a quote or order never touches the ledger) — **the
  connective LINKS are the actual deliverable**, and their value is
  entirely in enabling the traceability drill-down this app already
  built for the compliance side (line → account → écriture →
  justificatif) to extend one hop further back (quote → order →
  invoice → écriture → justificatif), the same discipline, new domain.
- **Depends on**: the existing `Invoice`/`InvoiceLine`/Tiers-identity
  work (reused, not touched) as the terminal stage.
- **Verification**: NOT a hand-traced accounting oracle — there's no
  compliance content in "can a quote be edited after being sent."
  Verification here means unit tests on the STATE MACHINE (only valid
  transitions allowed — e.g. an invoice can't be created from a
  rejected quote; an order's own remaining-to-invoice quantity is
  tracked correctly across partial invoices) plus live click-through of
  the full chain. This is this section's first explicit example of
  "good enough" verification meaning something different from the rest
  of this app's own oracle discipline — stated plainly, not glossed
  over.

#### 1b. Invoice payment status — promote the anomaly engine's own logic

- **What**: a first-class, COMPUTED (never stored) payment status per
  `Invoice` — paid / partially paid / open / overdue — derived from
  `EcritureLigne.lettrage` on the invoice's own posted client-account
  line, extending exactly the logic `computePaymentAnomalies()` already
  has, just promoted from "an anomaly-detection side effect" to "a
  queryable invoice property" (`GET /invoicing/invoices/:id` gains the
  field; the invoice list/detail screens surface it).
- **Classification: PRESENTATION.** No new ledger write, no new
  aggregation logic beyond what already exists and is already tested —
  this is almost entirely "expose an existing computation from a second
  call site."
- **Depends on**: Invoicing (exists), bank reconciliation's `lettrage`
  (exists), the anomaly engine's own payment-matching logic (exists,
  gets extracted into a shared, reusable function rather than
  duplicated).
- **Verification**: the underlying logic is ALREADY hand-oracle-tested
  (`invoice-anomaly-engine.spec.ts`) — the only new surface is exposing
  it on a second endpoint, verified by a regression test asserting both
  call sites agree, plus a live check that the invoice screen shows the
  same status the anomalies screen already flags. Low risk, small,
  arguably the cheapest genuinely-valuable item in this whole section —
  a good first pick.

#### 1c. Procure-to-pay — Purchase Order, Goods Receipt, Supplier Bill

**The much bigger lift of the two Tier-1 chains** — almost nothing
exists here today, unlike quote-to-cash's extension of an already-
mature module. Three new entities, each mirroring an already-verified
pattern in this app rather than inventing a new one:

- **`PurchaseOrder` (bon de commande fournisseur)** — a commitment to a
  supplier, PRESENTATION on its own (no ledger write) but with one real
  compliance-adjacent wrinkle worth flagging honestly now, not
  discovering it late: French GAAP has a genuine "engagements hors
  bilan" (off-balance-sheet commitments) disclosure concept for
  significant outstanding purchase commitments (Code de commerce /
  PCG's own "engagements financiers" annexe note) — **exact scope and
  threshold to be confirmed against the primary source
  (`specs/Reglt 2014-03_Plan comptable general.pdf` and Code de
  commerce) at design time**, not assumed from this summary. Whether
  this app's own liasse annexe ever needs to surface open POs is a real
  open question for that design pass, not a foregone conclusion.
- **`GoodsReceipt` (réception marchandise)** — the purchase-side mirror
  of a delivery note; the trigger point for a stock increase once Tier
  2's stock module exists (see below — until then, this is a milestone
  marker only, PRESENTATION, with GATED behavior arriving later as a
  pure addition, not a redesign).
- **`SupplierInvoice` / `Bill` (facture fournisseur) as a first-class
  entity** — the real deliverable, mirroring `Invoice` structurally
  (draft → [optional approval] → posted) but for purchases. **GATED**:
  once approved, it posts through the SAME `EntriesService.create()`/
  `.validate()` path Invoicing already uses — no privileged write path,
  exactly the standing rule. This is also where the AI chatbot's
  already-built `InvoiceExtractionService` (deterministic PDF/Excel
  field extraction) becomes directly reusable as the bill's own
  capture mechanism, not a new extraction pipeline.
  - **A real, citable regulatory reason this matters beyond internal
    tidiness**: France's e-invoicing reform requires businesses to be
    able to RECEIVE structured e-invoices, not just issue them — a
    first-class `SupplierInvoice` entity is the natural landing spot
    for that structured data once it arrives. **The exact mandatory
    date has shifted more than once already and must be re-checked
    against the current official calendar (impots.gouv.fr / the PPF
    portal) at design time** — do not carry forward any specific date
    from this document without re-verifying it fresh; this is exactly
    the kind of fact this app's own discipline says never to assume
    stale-safe.
- **3-way match (PO ↔ Goods Receipt ↔ Bill)** — **GATED**, a genuine
  correctness control (quantities/amounts must reconcile within a
  tolerance before a bill is eligible to post), matching the user's own
  stated values for this whole roadmap ("correctness/compliance depth,
  gated ledger posting"). Verification: a hand-computed oracle over the
  matching/tolerance rules, same discipline as the bank-reconciliation
  matching engine's own oracle tests — genuinely verifiable to this
  app's normal standard, since matching arithmetic has no ambiguity.
- **Règlement fournisseur (payment run)** — recording an outgoing
  payment against one or more bills; mirrors 1b's payment-status work
  on the sales side (derives/updates status from `lettrage`), and reuse
  `EntriesService.setLettrage()` as-is rather than a new write path.
- **Depends on**: nothing existing beyond `EntriesService`/
  `EntryValidationService` (reused) and, for the extraction step,
  `InvoiceExtractionService` (reused). Genuinely buildable independent
  of Tier 1a/1b, but sequenced after them here since 1a/1b are much
  cheaper wins on an already-mature module.

#### 1d. Payroll interface — import + gated posting ONLY, explicitly never a payroll engine

- **What**: import a payslip/DSN summary (gross salaries, cotisations
  sociales, net à payer — figures COMPUTED EXTERNALLY, e.g. by
  Silae/PayFit/ADP) and post the standard French payroll journal entry
  template (charges de personnel 641/645, organismes sociaux
  431/437/645, net à payer 421) through the ordinary `EntriesService`.
  Same shape as Excel import: an external file becomes a
  preview-then-confirm gated écriture.
- **Classification: GATED** — it posts real money to the ledger — but
  narrowly scoped: this app NEVER computes a cotisation, a net salary,
  or anything payroll-specific; it only structures and posts numbers a
  payroll provider already computed and certified. This distinction is
  load-bearing, not a formality — see Tier 3 below for why an actual
  payroll ENGINE is a completely different (and not recommended)
  undertaking.
- **Depends on**: nothing beyond `EntriesService` — no new posting
  primitive, no new entity beyond an import-batch-shaped record.
- **Verification**: the posting TEMPLATE (which PCG accounts, what
  the standard entry shape looks like) is a real, textbook, citable
  structure — hand-traceable exactly like cession/à-nouveau/dotation
  posting already is. The INPUT numbers have no accounting-standard
  correctness question to verify (they're taken as given from an
  external, already-certified source, the same trust boundary this
  app already accepts for a bank statement import).

#### 1e. Invoice → all related écritures — close a real, confirmed gap

**Added 2026-09-06, from a direct audit of `InvoiceDetailView.tsx` and
`Invoice`'s own schema** (not a theoretical item — the user asked
"since we have invoices attached to accounting entries, I would need
to be able to see all entries related to a specific invoice," and the
audit confirmed that today, nothing on the invoice screen links to any
of them). `Invoice` already carries four DIFFERENT kinds of écriture
relationship, none of them surfaced together, one of them not tracked
by any field at all:

- `postedEcritureId` — the original posting (exists, used internally,
  never shown as a link).
- `encaissementEcritureId` — the cash-basis-VAT reclassification
  écriture (services under `ENCAISSEMENTS`, exists, never shown).
- `correctsInvoiceId` / `correctedBy` — credit-note links, exist as
  relations, never rendered as "see the invoice/avoir this
  corrects/that corrects it."
- **The actual bank-receipt/payment écriture — tracked by NOTHING.**
  Confirmed by reading `EntriesService.setLettrage()` directly: it's a
  single free-text string set one `EcritureLigne` at a time, with no
  grouping, no net-to-zero validation, and no FK back to `Invoice` at
  all. The only way to find a payment today is to already know which
  `lettrage` code a human typed into both the invoice's own client-line
  AND the separate payment écriture's line, found by scrolling the
  grand livre independently.
- **What**: a single `GET /invoicing/invoices/:id/related-ecritures`
  (or folded into the existing detail response) that returns all four
  kinds together — the three FK-backed links read directly, PLUS a
  real lookup for the fourth: find every validated `EcritureLigne` on
  the invoice's own `clientAccountId` sharing a `lettrage` code with
  the invoice's own posted client-line. `InvoiceDetailView.tsx` renders
  the result as a clickable list (reusing the SAME
  `AccountLedgerDrilldown` component the traceability drill-down
  already built, not a new écriture-viewer).
- **Classification: PRESENTATION.** Every underlying écriture is
  already posted and validated through the normal gated path — this is
  read-only aggregation and display, the exact shape of the
  traceability drill-down (line → account → écriture →
  justificatif) already shipped elsewhere in this app, extended one
  more hop (invoice → every écriture that touches it).
- **Depends on**: Invoicing (exists), the traceability drill-down's own
  `AccountLedgerDrilldown` component (exists, reused verbatim).
  Genuinely independent of 1f below, but the two are natural
  companions — 1f gives prepayment-matching a real FK instead of a
  free-text `lettrage` guess, and once that FK exists, THIS item's
  "payment via lettrage" lookup gets a cleaner, more direct companion
  ("payment via the real link") rather than replacing it (a client
  might still pay the ordinary way, with no prepayment involved, so
  the lettrage-based lookup stays necessary regardless).
- **Verification**: no new computation to hand-trace — the three FK
  reads are trivial, and the fourth (lettrage lookup) is exactly the
  query shape `computePaymentAnomalies()` already runs and is already
  tested. Verify by regression-testing that this new endpoint's result
  for a known fixture invoice (with a real posted écriture, a real
  credit note, and a real lettered payment) matches what each
  underlying source independently shows, plus a live click-through
  confirming every link actually opens the right écriture.

#### 1f. Prepayments / acomptes — a real entity, not a free-text lettrage guess

**Added 2026-09-06, from the same audit — confirmed a real, complete
gap, not a partially-built feature.** `419000` ("avances et acomptes
reçus") exists only as a liasse bilan-line mapping target (which line
a balance there routes to) — there is no `Prepayment` model, no
"record an acompte received" action, no "apply this acompte to that
invoice" action, anywhere in the app. Today, recording and later
applying a client prepayment means hand-journaling both postings and
manually typing a matching `lettrage` string into two unrelated
screens, with zero system enforcement that the amounts even net to
zero.

- **What**: a `Prepayment` model (companyId, clientAccountId, amount,
  receivedDate, `postedEcritureId` — the débit-banque/crédit-419000
  écriture, posted through the ordinary `EntriesService`) plus an
  explicit "appliquer à une facture" action: at invoice finalize time
  (or after, against an already-finalized invoice), applying a
  prepayment posts the reclassification écriture (débit 419000 /
  crédit 411xxx, the client account) and sets `Prepayment.appliedToInvoiceId`
  + `appliedEcritureId` — a real FK, not a lettrage string two people
  have to agree on by typing the same thing twice. Partial application
  (a 500€ acompte against a 1200€ invoice) leaves the `Prepayment`
  row's own remaining balance queryable, rather than silently "used up."
- **Classification: GATED.** Both the initial receipt and the
  application-to-invoice step post real écritures through the ordinary
  `EntriesService.create()`/`.validate()` path — no privileged write.
  The MATCHING/application step itself (which prepayment can apply to
  which invoice, enforcing the applied amount never exceeds the
  prepayment's own remaining balance) is a real correctness control,
  same discipline as procure-to-pay's 3-way match in §1c.
- **Depends on**: nothing beyond `EntriesService` for posting; pairs
  naturally with 1e above (once `appliedToInvoiceId` is a real FK, 1e's
  "all related écritures" view should show it as its own row, not fall
  through to the lettrage-guess lookup) but neither blocks the other.
- **Verification**: fully hand-oracle-testable, same discipline as
  everywhere else in this app — a hand-traced scenario (receive a
  1000€ acompte, apply 600€ to invoice A, apply the remaining 400€ to
  invoice B, assert both reclassification écritures balance and the
  `Prepayment`'s own remaining balance hits exactly 0,00) plus a guard
  test proving an over-application (applying more than the remaining
  balance) is refused rather than silently allowed to go negative. The
  419000 account's own bilan-line mapping (already correct today, per
  `bilan-2050.ts`/`bilan-2033-a.ts`) needs no changes — it already
  nets to the right figure once the reclassification écritures post
  correctly; this item only needs to confirm that live, not redesign
  the mapping.

---

### Tier 2 — feeds the accounting: the management-accounting layer

These don't touch ledger POSTING directly, but their whole value is in
being provably consistent with the already-verified ledger — the same
"two independently-sourced numbers must tie out" discipline this app
already applies everywhere (Actif=Passif, the 2054/2055 tie-out, the
cash-flow reconciliation), reused for a genuinely new class of question.

#### 2a. Stock valuation methods feeding the bilan

- **What**: once Tier 1's goods-receipt/delivery events exist and
  produce real stock movements, a valuation engine (FIFO / CUMP — coût
  unitaire moyen pondéré) computes closing stock value, feeding the
  bilan's own stock lines (already named in this codebase's own cash-
  flow module: "the 5 stock lines") and the compte de résultat's
  variation de stocks.
- **Classification: GATED.** This is squarely this app's own strongest
  wheelhouse — a real PCG-governed valuation method feeding a real
  compliance figure. **Confirmed general rule to verify precisely at
  design time, not assumed from memory**: French GAAP permits FIFO/CUMP
  for stock valuation and does NOT permit LIFO — the exact article
  citation should be pulled fresh from
  `specs/Reglt 2014-03_Plan comptable general.pdf` before any code is
  written, matching this app's own "never cite a compliance rule from
  memory, always re-check the primary source" rule.
- **Depends on**: Tier 1's stock-movement events (goods receipt/
  delivery) existing first — this item has no data to value without
  them. A real, hard sequencing dependency, not just a suggestion.
- **Verification**: hand-traced oracle (a known sequence of receipts/
  issues at known costs, the expected FIFO/CUMP closing value worked
  out by hand) plus a live tie-out against the bilan's own stock lines
  on a fixture company — the exact discipline every other GATED feature
  in this app already went through.

#### 2b. Comptabilité analytique (cost-center / project allocation)

- **What**: an optional analytical-dimension tag on `EcritureLigne`
  (a `CostCenter`/`AnalyticalAxis` model + `costCenterId` field),
  captured at écriture-creation time — structurally identical to the
  existing `vatRateId` per-line tagging, reused as the template rather
  than invented fresh. Reporting: a P&L broken out by cost center/
  project, alongside the existing company-wide compte de résultat.
- **Classification: GATED for the tagging/validation step** (the same
  `EntriesService` validates a tagged `costCenterId` belongs to the
  company, exactly like `vatRateId` today) — **PRESENTATION for the
  aggregation report itself** (a read-only re-grouping of already-
  validated data, same shape as `financial-analysis.ts`).
- **Depends on**: nothing beyond the existing per-line tagging pattern.
  Genuinely independent of everything else in this section — could be
  picked up any time, including before Tier 1.
- **Verification**: fully hand-oracle-testable to this app's normal
  standard — tag a known dataset with known cost centers, assert the
  per-cost-center P&L sums correctly, the exact same discipline as
  `ca3-declaration.ts`'s own by-rate aggregation. Unlike 1a's quote/
  order state machine, this item's correctness IS fully checkable
  against a hand-traced number, because the underlying math (sum lines
  tagged X) has no ambiguity — "management accounting" doesn't
  automatically mean "unverifiable," only budgeting (next) does.

#### 2c. Budgeting / forecasting vs. actuals

- **What**: a `Budget`/`BudgetLine` entity (a planned figure per
  account or cost-center, per period) and a report comparing it to the
  real trial balance for the same scope, reusing `trial-balance-
  engine.ts` verbatim for the "actual" column — no new ledger
  aggregation logic, only new input capture and variance arithmetic
  (actual − budget, %).
- **Classification: PRESENTATION.** A budget number never touches the
  ledger.
- **Depends on**: `trial-balance-engine.ts` (exists, reused read-only);
  benefits from but doesn't strictly require 2b (cost-center
  budgeting is a natural pairing, not a hard dependency).
- **Verification — the first genuinely different case in this
  document, stated plainly**: the VARIANCE ARITHMETIC is trivial to
  verify (subtraction and a percentage), and the ACTUAL column is a
  pure regression check against the already-verified trial-balance
  engine (not a new oracle). But **the budget number itself has no
  correctness standard to verify against** — it's a business input, not
  a derived accounting fact, so "verified" here can only ever mean "the
  tool computed the comparison correctly against whatever figures a
  human entered," never "the budget is right." Worth saying this
  explicitly in the eventual design pass too, the same way the résultat
  fiscal module's own honesty banner states plainly what its own
  arithmetic-tie-out does and doesn't prove.

---

### Tier 3 — genuinely operational, loose coupling: a different kind of work, said plainly

Everything in this tier competes on UX/workflow completeness against
dedicated, mature products (CRM suites, project-management tools,
procurement platforms, payroll providers) — not on compliance depth,
which is this app's actual comparative advantage. There is no primary
source to verify a CRM pipeline against the way there's a PCG article
for stock valuation; "correct" here means "matches what the business
actually needs," a UX/workflow question, not a compliance one. Building
native, from-scratch versions of these is a much larger, much less
differentiated undertaking than anything above — flagged honestly, not
downplayed.

- **CRM** (contact history, pipeline/opportunity stages, lead
  tracking) — beyond the Tiers/Account identity fields already built.
  **Recommendation: integrate, don't build.** A webhook/API bridge
  syncing a won opportunity from an existing CRM (HubSpot, Pipedrive,
  a French-market tool) into a Tiers record + Tier-1's own Quote entity
  is a far smaller, far more defensible investment than competing with
  dedicated CRM UX. **"Good enough" verification**: does the sync
  correctly create/update the right Tiers record and hand off to the
  right Quote — a plain integration test, not an oracle.
- **Project management** (tasks, milestones, timesheets). Same
  reasoning as CRM — competing against Asana/Monday/Linear on workflow
  UX is not a fight worth having. **Recommendation: integrate**, with
  the one genuinely accounting-relevant hook being a timesheet import
  feeding Tier 2's comptabilité analytique (labor cost by
  project/cost-center) if that's ever built. **"Good enough"
  verification**: the import correctly maps timesheet entries to the
  right cost-center tags — again an integration/mapping test, not an
  oracle.
- **Procurement workflow / e-sourcing** (RFQ management, supplier
  scoring, contract lifecycle) — beyond Tier 1's basic Purchase Order.
  A genuinely different, supplier-relationship-management problem, not
  core to "connect accounting to the business" the way procure-to-pay
  is. Lowest priority in this section; **recommendation: don't build**
  unless a specific, concrete business need for it surfaces — there is
  no compliance or traceability angle here at all, only competing with
  dedicated procurement suites on their own turf.
- **A full payroll ENGINE** (gross-to-net cotisation calculation, DSN
  filing) — explicitly contrasted with 1d's narrow payroll INTERFACE
  above, and explicitly **not recommended**. This is arguably a bigger
  undertaking than this entire accounting application's own scope to
  date: French payroll cotisation rules are extensive, change
  frequently (URSSAF/DSN specifications are revised on their own
  regulatory calendar, independent of anything in the PCG/Code de
  commerce this app already tracks), and are already extremely well
  served by mature, specialized providers (PayFit, Silae, ADP) whose
  entire business is keeping up with exactly that churn. Building a
  competing engine here would mean taking on a second, independent,
  perpetual compliance-tracking burden with no compounding benefit to
  this app's own actual strength (ledger/liasse/VAT correctness) — the
  clearest "don't build" call in this whole document. **"Good enough"
  verification, if this were ever revisited**: there isn't one short of
  matching a real payroll provider's own certified output line for
  line, which is precisely the argument for not building it.

---

### Sequencing thoughts, not a decision

Not re-litigating the GATED/PRESENTATION-driven priority order that got
§1-§9 built — this is a genuinely new planning horizon, to be sequenced
when picked up, not assumed to slot in ahead of anything. A few honest
observations to inform that future conversation:

- **1a (Quote/Order), 1b (invoice payment status), and 1e (invoice →
  all related écritures) are the cheapest real wins here** — all three
  extend an already-mature module (Invoicing) rather than building new
  ledger-adjacent machinery from scratch; 1b and 1e in particular are
  close to "expose an existing computation/relation from a new call
  site," confirmed directly against a real, specific user complaint
  ("I can't see all the entries related to an invoice"), not a
  hypothetical gap.
- **1f (prepayments) is the one Tier-1 item confirmed as a COMPLETE
  gap, not a partial one** — every other Tier-1 item extends something
  real; prepayments today have no entity, no action, and no link at
  all, only a chart-of-accounts line with the right bilan mapping and
  nothing using it. Pairs naturally with 1e (a real `appliedToInvoiceId`
  FK is a strictly better answer than 1e's own lettrage-guess fallback)
  but each stands alone and either could ship first.
- **1c (procure-to-pay) is the single largest item in this section** —
  three new entities, a real matching engine, and a genuine regulatory
  question (e-invoicing receipt) to research fresh — closer in scope to
  the original Invoicing Phase A project than to a single feature pass.
- **2b (comptabilité analytique) is fully independent** of everything
  else here and fully verifiable to this app's normal standard — a
  reasonable candidate to pull forward ahead of Tier 1 if cost-center
  reporting turns out to matter more, near-term, than the connective
  workflow entities.
- **2a (stock valuation) is hard-blocked** on Tier 1 producing real
  stock-movement data first — sequencing here isn't a choice.
- **Every Tier-3 item's own recommendation is "integrate, not build"
  except procurement workflow ("don't build at all") and a full payroll
  engine (the clearest "don't build" call in the document)** — this
  section exists to make sure that recommendation is on the record
  before anyone re-derives it from scratch under time pressure later.
- **FR-first, Monaco explicitly deferred, same standing discipline as
  everywhere else in this app** — anything here with real compliance
  content (stock valuation, the payroll posting template, engagements
  hors bilan) should be built and verified against French sources
  first, with Monaco's own equivalent rules confirmed separately before
  enabling for an MC-jurisdiction company, exactly like Invoicing
  Phase A's own Monaco gate.

---

## Operational readiness — backup, archival, migration at scale, cabinet UX

**Added 2026-09-06, from a direct audit requested by the user** (five
specific questions: backup/recovery, clôture/archival, concurrency/
failure safety, the onboarding/migration path, and multi-client/cabinet
management) — checked against the real code, not recalled. Unlike the
ERP section above, none of this is a new business-operational module —
it's the infrastructure layer around the EXISTING product that
determines whether it's actually shippable to a real accountant with
real clients and real disk drives. Classified the same way as
everything else in this document (GATED/PRESENTATION) plus an honest
severity read, since these five don't share a single theme the way the
ERP tiers do.

### Backup and recovery — SHIPPED (2026-10-18)

**Was the most urgent item in this entire document — now closed.**
Grepped the whole repo for backup-related code before building:
every hit was the credential-encryption threat model ("defends against
a leaked DB backup"), never an actual backup mechanism, and this was
the one gap not logged anywhere in CLAUDE.md's own otherwise-thorough
"known scope boundaries" discipline. See CLAUDE.md "Operational
readiness — backup and recovery" for the full design/verification
record; this entry records only the decisions, kept here for context.

- **The architecture actually shipped diverges from this section's own
  original sketch, deliberately, confirmed with the user before
  building** — a company-scoped, app-level JSON exporter was rejected
  in favor of a full-instance `pg_dump`/`pg_restore` design: Postgres's
  own proven, atomic backup mechanism, rather than hand-serializing
  20+ Prisma models with real risk of a subtle, undetected gap. This
  also matches the app's own actual single-operator deployment model
  (one firm backing up all of their own client companies at once) more
  directly than a per-company export would have.
- **`GET /backup/export`, gated on the caller owning at least one
  company** — no instance-admin role exists in this app's `Membership`
  model, so this is the closest available check; a true multi-firm
  SaaS deployment would need a real one before exposing this safely
  across unrelated firms.
- **Restore is a documented `pg_restore` runbook
  (`scripts/backup/README.md`), deliberately not a self-service
  endpoint** — restoring into a live database is a different risk
  class than exporting from one; the scheduling half (this app has no
  scheduler at all) is left to an OS-level scheduled task calling the
  endpoint, documented rather than built.
- **Verification went further than "the endpoint returns 200"**: a
  genuine export→restore round trip — restore the real downloaded dump
  into a fresh, temporary database (never the live one) and confirm
  byte-for-byte equality on real row counts AND a real monetary figure
  against the live database. Two real bugs were found and fixed live
  along the way (pg_dump rejecting Prisma's own `?schema=` URL
  convention; an ESM-only dependency needing the same dynamic-import
  workaround already established for Factur-X) — see CLAUDE.md for
  both.

### Clôture d'exercice and archival — SHIPPED (2026-10-18)

Was the second-most-urgent item in this document — now closed, the
same day as backup/recovery. See CLAUDE.md "Operational readiness —
clôture d'exercice archival" for the full design/verification record;
this entry records only the decisions.

- **The firmer version shipped, not the hedged one this section
  originally sketched** — `close()` now REQUIRES its own FEC to
  generate successfully before completing (not "ideally" or
  best-effort): if the company is missing its SIREN/RCI, closing
  fails with that exact error and the year stays open. A real
  judgment call made while implementing an already-approved
  direction, consistent with this app's own "fail loud rather than
  silently skip" discipline.
- **New `ArchivedExport` model**, written exactly once per
  `(company, fiscalYear, kind)`, storing only a sha256 hash + metadata
  — never the content itself, which is always re-derivable on demand
  from the now-immutable underlying écritures.
- **Two write paths**: `close()` is the primary one (archives the
  year's own final state atomically with setting `closedAt`); a
  backfill path in `FecExportService.generate()` covers a year closed
  BEFORE this feature existed, firing only when the year is already
  closed and has no archive yet — never for a still-open year, which
  would risk capturing a premature snapshot.
- **`GET /fiscal-years/:id/archive`**, surfaced on `FiscalYearsPage`
  as "Archivé — SHA-256: ..." under a closed year's badge — the actual
  user-facing payoff, letting someone show a real, tamper-evident
  snapshot exists rather than just knowing one does internally.
- **Verified two ways**, including live confirmation that a stored
  hash matches an independent fresh re-export byte-for-byte
  (`sha256sum`), and that the SIREN-missing refusal genuinely leaves
  the year open with no archive created.

### Data integrity under concurrency/failure — holds for the one invariant that matters most; two named exceptions

Verified directly, not assumed: `EntriesService.validate()` (the
gapless-numbering assignment) wraps the counter increment and the
écriture update in one `$transaction` — this is the single most
load-bearing correctness property in the app, and it's genuinely
crash-safe. Every multi-écriture import (Excel/FEC/Plan Comptable) is
either one nested Prisma `create` call (atomic by construction) or an
explicit `$transaction`.

- **Two deliberate, already-documented exceptions**: fixed-asset
  cession (`disposeFixedAsset()`) and invoice finalization both post
  the écriture first, then write the linking field
  (`cessionEcritureId`/`postedEcritureId`) as a separate second step —
  a crash in that exact window leaves a real, correctly-posted,
  validated écriture with the FixedAsset/Invoice row not yet reflecting
  it. Already named as an accepted risk in both places' own code
  comments — recorded here only to confirm it's genuinely the full
  extent of the exposure, not a hidden pattern elsewhere too.
- **No further action proposed here** — this is a verification finding,
  not a new roadmap item. If it's ever revisited, wrapping those two
  call sequences in `$transaction` is a small, contained fix (NestJS/
  Prisma's interactive transactions already support awaiting an
  external service call inside the callback — `EntriesService.create()`/
  `.validate()` would need to accept an optional `tx` client parameter
  rather than always using `this.prisma` directly).

### Onboarding/migration path — further along than expected, with one real scaling gap

FEC/CSV/Excel import genuinely work for bringing in an existing chart +
historical écritures. Two confirmed frictions for migrating a real
client at scale:

- **Bulk-validate — SHIPPED (2026-10-18).** `POST /entries/validate-batch`
  — see CLAUDE.md "Operational readiness — bulk-validate" for the full
  record. Reuses `EntriesService.validate()` verbatim per id, in a loop
  (zero new posting/numbering logic, confirming the "zero new risk"
  classification below); `ecritureIds` (caller's own order) XOR
  `fiscalYearId` (every draft in that year, ordered by `ecritureDate`
  then `createdAt` — reproducing the chronological `EcritureNum`
  sequence a historical import's entries would originally have
  received); never all-or-nothing — one failure never aborts or rolls
  back the rest, `results` names every id's own outcome. Surfaced on
  `FiscalYearsPage.tsx` as a "Valider tout" action per open fiscal year
  with drafts. Verified by 6 new unit tests (including the exact
  regression-equivalence check called for below) plus live curl/browser
  runs confirming both the chronological-ordering logic and the
  partial-failure reporting against real data — 922 backend tests
  passing overall.
  - **What it replaced**: every imported écriture landed as an
    unvalidated draft by design, with no endpoint to validate many at
    once (confirmed — grepped, nothing) — a multi-year historical
    import meant validating every entry one API call at a time.
  - **Classification: GATED** (it's the real numbering-assignment path,
    just called many times) — **but zero new risk**, since each
    individual assignment is already correctly atomic; verification was
    a regression test asserting N calls through the batch endpoint
    produce IDENTICAL results to N individual calls, plus a check that
    a failure partway through (e.g. one draft unexpectedly already
    validated by a concurrent request) doesn't silently skip or
    corrupt the rest — it reports exactly which ids succeeded and which
    didn't, never a partial silent success.
- **A FEC file spanning multiple calendar years creates ONE fiscal year
  spanning that whole range** — traced `resolveFiscalYearPlan()`
  directly. Not a bug against normal usage (a real FEC export is
  legally one-file-per-exercice), but a multi-year file (which does
  happen — a contrôle fiscal's own historical request, for one) would
  silently create an accounting-nonsensical multi-year "fiscal year"
  rather than refusing or offering to split it.
  - **What**: detect a file whose date range spans more than ~13 months
    and refuse with a clear message naming the span, rather than
    silently creating a wrong-shaped fiscal year — a narrow, cheap
    guard, not a new splitting feature (splitting a multi-year file by
    date automatically would mean GUESSING where one exercice ends and
    the next begins, which this app's own "never guess, fail loud"
    discipline should reject in favor of asking the user to split the
    file themselves).
  - **Classification: GATED** (it changes what `resolveFiscalYearPlan()`
    accepts) but trivial — a single boundary check, verified by a
    straightforward unit test asserting the exact span threshold.

### Multi-client / cabinet management — the data model is ready; there's no UI for it

Multi-tenancy already supports this correctly: one `User` can hold a
`Membership` in many companies, so an accountant's single login against
40 client files is already structurally sound — confirmed, nothing to
fix at the data-model layer. What's missing is entirely presentational:
the only way to move between companies is a flat native `<select>` in
`TopBar.tsx` (read directly — `companies.map(c => <option>)`, no
search, no grouping, no per-company signal), and the existing
per-company "needs attention" panel (drafts pending, anomalies, pending
invites — all real, already built) only renders once you've switched
into that company; there's no cross-company rollup.

- **What, phased from cheapest to most work**:
  1. Replace the flat `<select>` with a searchable combobox (reusing
     the SAME combobox pattern `AccountCombobox` already established)
     — pure UI, zero backend change.
  2. A cabinet-level landing view: one row per company the caller has
     a `Membership` in, each showing the SAME signals
     `NeedsAttentionPanel` already computes per-company (draft count,
     anomaly count, pending invites) — a fan-out of `N` already-existing,
     already-tested per-company queries, not a new aggregation engine.
  3. Batch operations across companies (e.g. "export FEC for every
     client with a fiscal year closing this month") — the largest part
     of this item, genuinely new orchestration logic, sequenced last.
- **Classification: PRESENTATION for 1 and 2** (pure read-side
  aggregation of already-correct per-company data) — **item 3 is GATED
  per-action** (each underlying action, e.g. an FEC export, is already
  gated; running several in sequence needs its own partial-failure
  handling — "17 of 20 succeeded, here are the 3 that didn't and why,"
  never a silent partial batch).
- **Verification**: 1 and 2 need no accounting oracle at all — they're
  UI/aggregation correctness, verified by confirming the cabinet view's
  per-company numbers match what that company's own dashboard already
  shows (a regression/consistency check, not a hand-traced oracle, the
  same honest distinction this document already draws for Tier-1/2's
  own presentation-layer items). Item 3's verification is per-underlying-
  action (already has its own oracle) plus a new test specifically for
  the partial-failure reporting path.

### Sequencing note for this section

Severity-ordered, not dependency-ordered, since none of these five
block each other. **Backup/recovery, clôture archival, AND bulk-validate
are all now SHIPPED** (2026-10-18, same day — see their own entries
above and CLAUDE.md) — backup/recovery and archival picked first and
second precisely because they carried the two most severe,
currently-unmitigated consequences (unbounded data loss; a silent
compliance-archival gap in an otherwise well-flagged codebase);
bulk-validate picked up next, same day, as the next-most-severe item,
small and cheap as scoped. The multi-year-FEC guard is the one
remaining item from this pair, still open, and could be picked up any
time, including bundled into whichever FEC-import-adjacent work
happens next. Cabinet UX items 1-2 are also cheap and a reasonable
pairing with Multi-user/roles work if that's ever revisited; item 3
(batch cross-company actions) is the only genuinely large piece here
and should wait until there's a real multi-client user to design it
against.

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

**"Business-operations / ERP direction"** (added 2026-09-06, extended
the same day with Tier-1 items 1e/1f) is the next planning horizon
above, per the user's own explicit request for an honest inventory of
what already exists beyond core accounting, plus a roadmap organized
by coupling to the ledger rather than this document's own
priority-order convention. Nothing in it is designed or built — same
MAP-ONLY status as everything else in this file — but it does already
establish concrete recommendations worth carrying forward even before
any of it is picked up: (1) the cheapest real wins are promoting the
anomaly engine's own existing payment-status logic into a first-class
`Invoice` property (§1b) and surfacing the invoice's own already-
scattered écriture links on its own detail screen (§1e); (2) a real
`Prepayment` entity (§1f) is needed — confirmed, via direct audit, to
be a COMPLETE gap today, not a partial one, with `lettrage` serving
only as an unenforced free-text correlation guess in its place; and (3)
a full payroll engine is explicitly NOT recommended, ever, in favor of
best-of-breed providers — the clearest "don't build" call this project
has made.

**"Operational readiness — backup, archival, migration at scale,
cabinet UX"** (added 2026-09-06, same day) is a second, separate audit
— not a business-operational feature set, but the infrastructure layer
determining whether this app is actually shippable to a real
accountant. The single most urgent finding in the whole document: **a
local-first app with zero backup/export mechanism and zero mention of
that gap anywhere in CLAUDE.md's own otherwise-thorough "known scope
boundaries" discipline** — confirmed by direct grep, not assumed. Also
confirmed: clôture d'exercice itself is solid (genuinely blocks on
draft écritures, genuinely enforced on every posting path), but nothing
archives the resulting FEC with a tamper-evident record; the one
invariant that would be catastrophic to get wrong under a crash
(gapless sequential numbering) IS transaction-safe, with two already-
self-documented, narrow exceptions elsewhere; FEC/Excel import genuinely
support onboarding an existing client but have no bulk-validate action
and would silently mishandle a multi-year FEC file; and multi-tenancy
already supports an accountant managing many client companies at the
data-model layer, with zero cabinet-level UI built on top of it yet.
