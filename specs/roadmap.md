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
2. **Bank reconciliation — Layer 1b (live aggregator connectivity)** — depends on 1a
3. **Batch invoice review queue** — no technical dependency on 1/2; reuses document attachment + `InvoiceExtractionService` + `propose_ecriture`, all already shipped. Could run in parallel with or before bank-rec if priorities shift; sequenced here per discussion, not because it's blocked.
4. **Traceability drill-down** — no dependency on 1–3; already has its own detailed spec (folded in below); benefits from document attachments (shipped) for the "→ justificatif" extension.
5. **Anomaly surfacing** — benefits from bank-rec (lettrage/matching data) and drill-down (to explain *why* something's flagged) existing first, though not hard-blocked by either.
6. **Recurring entries / templates** — no dependency on anything above. Genuinely independent; flagged as the lowest-complexity gated item on this list, worth considering as a filler/quick-win if a later item stalls on a decision.
7. **Reporting/export flexibility** — no dependency on anything above; enhances every report already shipped. Could run anytime.
8. **Multi-user / roles & permissions** — no hard dependency on 1–7, but see the cross-cutting note below: this is the one item that, if pulled forward, retroactively closes the "no who" gap already logged in the document-attachment audit trail (CLAUDE.md: *"this app has no authentication/user-identity model anywhere... the log honestly records only when and what, never a fabricated actor"*) and would apply to any future audit trail too. Not proposing a reorder — just flagging that its cost is more front-loaded the longer it waits, since more features will exist that a future auth layer needs to retrofit around.

Noted but not planned: **Invoicing/facturation**, **Mobile** — see the
closing section.

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
on a validated line, audited via `LettrageAuditLog`). CAMT.053 only, as
decided; tiered confidence (HIGH/AMBIGUOUS/NO_CANDIDATE) as decided; a
real `BankAccount` model as decided. One real gap found live and
fixed: deleting a bank-matched draft's line silently orphaned its
statement line's `CONFIRMED` status (the FK correctly nulls
`matchedLigneId`, Prisma's own default for an optional relation, but
nothing reset `status`) — self-heals on every read now. The CAMT.053
parser is still verified only against a hand-built, spec-compliant
sample, not a real bank export — flagged honestly in that file's own
doc comment, worth revisiting the day a real one is available. OFX/
QIF/CSV and Layer 1b (live aggregator connectivity) remain unbuilt.

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

### Layer 1b — live aggregator connectivity (external, build second)

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

## 2. Batch invoice review queue

**Classification: GATED at the seam.** The queue UI itself (a stack of
draft proposals to page through) is presentation-shaped, but every
individual draft it produces must still pass through the exact same
`propose_ecriture` confirmation gate a single manual proposal does — it
must **not** auto-post, no matter how "obviously correct" a batch
result looks. That seam is the gated part; nothing about batching
changes it.

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

**Classification: GATED.** Reverse computation (line → accounts →
écritures) sitting on top of several independently-forward-verified
computations — a wrong reverse mapping is a wrong compliance artifact,
not a cosmetic bug.

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
  3. **VAT rate lines, 2058 `WJ`/`WG`** (tier 3) — a new but small
     rate-tagged query; `WJ`/`WG` reuse the already-proven single-
     account pattern from VAT ligne 19/20 (already shipped).
  4. **2059-A** — blocked on a real, previously-undiscovered schema
     gap: `FixedAsset` has no stored reference to the écriture(s)
     `disposeFixedAsset()` posted, so tracing a disposal row today
     would mean *searching* by account+date+amount — which this app's
     "never guess" discipline should reject. Needs a small additive
     migration (a `cessionEcritureId`-shaped field) decided before this
     tier can be built.
  5. **Cash flow / Analyse financière** — explicitly deferred in the
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

## 4. Anomaly surfacing

**Classification: GATED.** Computing and comparing figures (an expense
vs. its category's historical norm, an unlettered payment that appears
to match an open invoice, an unusual TVA rate shift) is exactly the
kind of "wrong compliance-adjacent artifact" risk this app already
gates everywhere else.

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

## 5. Recurring entries / templates

**Classification: GATED, lightly.** It creates real écritures, but only
ever through the normal `EntriesService.create()`/`validate()` path
already used everywhere else — no new write primitive, no new
computation. The gate here is about template *scheduling/application*
logic being correct, not about a new kind of ledger risk.

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

## 6. Reporting/export flexibility

**Classification: MOSTLY PRESENTATION**, with a per-export flag: any
export requiring a **new** computed figure (something not already
produced by an existing, verified service) is GATED for that figure
specifically, even if the export mechanism itself is presentation.

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

## 7. Multi-user / roles & permissions

**Classification: GATED — and its own substantial project**, not a
UI feature. This is access control and data integrity, not
presentation, and it's the one item on this roadmap that isn't an
extension of an existing pattern — it's new foundational surface.

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

### 8. Invoicing / facturation

Not scoped here — flagged as **watch, likely a separate initiative**,
not a simple feature addition to this app. The French e-invoicing
reform (facturation électronique, the PPF/PDP obligation) is phasing in
as a real compliance requirement, not just a convenience feature — that
changes this from "nice to have" to "eventually mandatory for
France-jurisdiction companies," which is worth tracking on its own
timeline rather than folding into this roadmap's sequencing.

### 9. Mobile

Not scoped here — flagged as its **own separate initiative**. Receipt
capture on the go is the main draw (photograph a receipt, feed it into
the same deterministic-extraction/prefill pipeline document attachments
already built) — but "mobile" as a whole is a platform decision (native
apps? a responsive web view? which OS first?) well beyond this
roadmap's scope.

---

## Closing note

This document is a **map**, current as of 2026-08-25. Nothing above has
been designed, and nothing above should be built from this document
alone — each feature gets its own design-then-verify pass, reviewed and
confirmed before any code is written, when we reach it. Update this
file as items ship, as decisions get made, or as priorities shift, so
it stays the accurate shared reference rather than a stale snapshot.

**Next up**: Bank reconciliation, Layer 1a — its own design pass, next.
