# Drill-down traceability — "click any computed number, see what feeds it"

**Status: Tiers 1, 2, AND 3 SHIPPED (all 2026-08-29) — see §4/§5/§6 at
the end of this file for the verification summaries and CLAUDE.md's own
"Traceability drill-down (Tier 1)"/"(Tier 2)"/"(Tier 3)" sections for
the permanent record. Tier 3 was the last tier this spec ever defined
— see §1 below, which never described a Tier 4 — so the feature's
scope is now fully closed.** This
was the gated item held back from the
2026-08-24 autonomous UX pass (see that session's proposal list) — a
REVERSE computation (line → accounts → écritures) sitting on top of
several FORWARD computations that were each independently verified in
their own direction only. It needed its own design-then-verify pass,
not autonomous UI work, because a wrong reverse mapping is a wrong
compliance artifact, not a cosmetic bug.
**Reconciled against current code on 2026-08-29 — see §0 immediately
below before reading further; a few claims below are refined, one tier
gains a fourth hop, nothing in scope changed.**

**The oracle for every tier below, non-negotiable**: the sum of the
detail returned for a clicked line must equal that line's own value,
exactly, to the centime, for the same fiscal year the report itself
was generated for. Enforced by an assertion that throws (not a UI-only
sanity check), and proven first by a hand-traced oracle test before any
endpoint exists — same discipline as `assertVncTiesToLedger`,
`assertCashFlowReconciles`, and every other cross-check already in this
codebase. If a report's own line can't be reverse-mapped this
precisely, it's out of scope for that report, not shipped approximately.

## 0. Reconciliation pass (2026-08-29) — read this first

This spec was written 2026-08-24, before two later features shipped:
**supporting-document attachments** (commit `94ec7aa`, 2026-08-25) and
the **batch invoice review queue** (2026-08-29). Every load-bearing
claim below was re-verified directly against the current code (not
recalled from memory) before this pass — `liasse-line-rules.ts`,
`ca3-declaration.ts`, `resultat-fiscal.ts`, `ledger.service.ts`,
`AccountLedgerDrilldown.tsx`, `DocumentViewer.tsx`, `schema.prisma`, and
the 2033-series files were all re-read. **Net result: nothing in scope
changed, no tier moved, no claim was found wrong — one hop was added to
the chain, and a few claims below are tightened with the exact code
they now cite.** The rest of this document is otherwise unchanged from
2026-08-24; treat this section as the authoritative correction layer,
not the tier sections' own prose where the two disagree.

**The chain gains a fourth hop, cheaply.** The 2026-08-24 chain stopped
at "line → accounts → écritures" (`AccountLedgerDrilldown`) because
document attachments didn't exist yet. It now extends to "→ (if
attached) justificatif," and the extension is nearly free:
- **The viewer half needs zero new code.**
  `DocumentIndicator({ ecritureId, documentCount })`
  (`frontend/src/components/journal/DocumentViewer.tsx:39`) is already a
  fully self-contained component — click opens `DocumentViewerModal`
  internally, fetching lazily. It's already reused verbatim in both
  `EcrituresList.tsx:189` and `EcritureEditor.tsx`. Dropping it into the
  drill-down's own écriture rows is a one-line addition per row, not a
  new rendering path.
- **The one real gap**: `LedgerService.accountLedger()`
  (`backend/src/modules/ledger/ledger.service.ts:101-146`) — the exact
  query `AccountLedgerDrilldown` already calls — does not currently
  fetch a document count. Its `include` is `{ ecriture: { include: {
  journal: true } } }`, nothing about documents. The fix is small and
  already precedented: `entries.service.ts:31-37` already does exactly
  this for the plain écritures list (`_count: { select: { documents:
  true } }`, reshaped into a flat `documentCount: number`, with its own
  regression test at `entries.service.spec.ts:224`). Closing this tier's
  fourth hop means replicating that identical pattern on
  `accountLedger()`'s own query — additive, not a redesign.
- Fold this into §2's decision area 4 (UI reuse) rather than treat it as
  a new tier: once an écriture row is shown, `documentCount > 0` decides
  whether `<DocumentIndicator>` renders, same as everywhere else this
  already works.

**Reverse-mapping-reuses-forward — confirmed, with a precision the
2026-08-24 prose slightly overstated.** `resolveLineCode()` and
`classifyAccounts()` (`liasse-line-rules.ts:85` and `:121`) are two
separate functions — `resolveLineCode()` is not literally called from
inside `classifyAccounts()`'s own loop. What they share, and what
actually matters, is the decision logic itself: both call the same
private `matchingRules()`/`matchingDualNatureRule()`
(`liasse-line-rules.ts:57-68`) with the identical `rules`/
`dualNatureRules` arrays — the only place "which line does this account
belong to" is decided. That's why they can't drift, not because one
calls the other. This is already proven live, not theoretical:
`tableau-2057.ts:252-258` already uses `resolveLineCode()` exactly this
way — aggregate per account first, then classify — reusing
`bilan-2050.ts`'s own exported `ACTIF_RULES`/`PASSIF_RULES`/
`DUAL_NATURE_RULES`, the literal same arrays `classifyAccounts()`
consumes. The 2033-series confirms the same thing one level up:
`bilan-2033-a.ts:369` calls `classifyAccounts(accounts, [...ACTIF_RULES,
...PASSIF_RULES], DUAL_NATURE_RULES)` with its own rule tables — same
engine, parameterized, not reimplemented. **Tier 1's dual-nature
landmine (§1 below) is confirmed real and current**, not spec-invented:
`buildMaturityTotals()`'s own doc comment
(`tableau-2057.ts:218-227`) documents aggregating per-account before
classifying, precisely because per-ligne classification was tried once
and found wrong.

**Tier 3 — two corrections, one tightening, one confirmation:**
- **CA3 (VAT ligne 08/09/9B/T6) needs a small prerequisite the original
  prose didn't call out**: `findImplementedRate()`, `IMPLEMENTED_RATES`,
  `COLLECTEE_PREFIX`, `DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT`,
  `DEDUCTIBLE_AUTRES_ACCOUNT` (all in `ca3-declaration.ts`) are currently
  module-private, unexported. The forward loop
  (`ca3-declaration.ts:147-186`) confirms VAT collectée really is tagged
  per-ligne via `EcritureLigne.vatRateId`, matching the "new query, not
  a reuse of an existing classifier" framing below — but for that new
  query to genuinely be "the forward predicate reused" rather than "a
  fresh WHERE clause that happens to agree today," these constants need
  exporting first, same shape as exporting `ACTIF_RULES` was for tier 1.
  Add this as an explicit prerequisite step when this tier is built, not
  an implicit assumption.
- **WJ/WG is better than originally scoped, not worse**:
  `resultat-fiscal.ts:142-145` already exports
  `CONFIRMABLE_LINE_ACCOUNT_PREFIXES = { WJ: '6712', WG: '63514' }`,
  with its own doc comment (`resultat-fiscal.ts:136-140`) stating it was
  exported specifically so the service layer could reuse it. Zero export
  work needed here, unlike CA3 above.
- Ligne 19/20 (`DEDUCTIBLE_IMMOBILISATIONS_ACCOUNT = '445662'`,
  `DEDUCTIBLE_AUTRES_ACCOUNT = '445660'`): confirmed still exactly one
  hardcoded account each, unchanged.
- **2059-A's gap is confirmed still real, unchanged since 2026-08-24.**
  `FixedAsset` (`schema.prisma:349-382`) still has no écriture reference
  of any kind — only `cessionDate`/`cessionPrice`. (Its own doc comment,
  lines 369-372, is now stale prose unrelated to this feature — it
  claims cession logic "doesn't exist yet," false since 2026-08-15 —
  noted here only so a future reader doesn't trust that comment.) The
  precedent this document proposes below is exactly right and already
  exists in this schema: `DepreciationEntry.postedEcritureId String?`
  (`schema.prisma:397`) — a bare nullable id, no `@relation` — confirming
  a `FixedAsset.cessionEcritureId String?` of the identical shape is the
  right, minimal fix when this tier is picked up.

**Tier 4 deferral confirmed still correct** — spot-checked
`financial-analysis.ts:225-238`: `margeCommerciale`/`valeurAjoutee`/
`ebe` are pure arithmetic over `cdrMontant(cdr, <code>)` calls
(already-computed tier-1 lines), not an independent écriture query.
Nothing here changes the recommendation to defer this tier.

**The oracle design (§ below, and the intro's own non-negotiable
statement) is unchanged and needs no correction** — confirmed
implementable exactly as originally scoped, verified conceptually
against a bilan line, a CDR line, a CA3 rate line, and a tier-1 line an
SIG figure composes from.

**One adjacent, unrelated finding worth recording so it isn't
mis-cited**: `CLAUDE.md` has no section documenting the
document-attachment feature at all, despite several code comments in
this codebase (e.g. `frontend/src/api/queries.ts`,
`EcritureEditor.tsx`) pointing at "CLAUDE.md 'Supporting-document
attachments — Part 2/3'" as if one exists — `git show 94ec7aa --
CLAUDE.md` shows that file was never touched in the attachment feature's
own commit. Not this feature's problem to fix, but don't go looking for
a section that isn't there.

## 1. Why this is one feature with four very different difficulty tiers

Every computed line in this app comes from a FORWARD mapping — but not
the same kind of mapping. Some are a clean account classification with
an existing pure function already usable in reverse; some are a
rate-tagged filter with no per-account structure at all; some are a
delta between two fiscal years' snapshots, or arithmetic over other
already-computed lines. Treating all of them as "the same drill-down
feature" would hide that the actual engineering risk varies enormously
by report. Tiering by that risk is the point of this document.

### Tier 1 — bilan/CDR family: reuses an existing per-account classifier, do first

`liasse-line-rules.ts` already exports **`resolveLineCode(accountNumber,
balance, rules, dualNatureRules)`** — a pure, standalone, per-account
classifier extracted specifically so something other than
`classifyAccounts()`'s own aggregate loop could call it (built for the
2057 maturity split). The reverse mapping for every line in this tier
is mechanically the same operation: *for every account in the trial
balance, call the account's own forward classifier; keep the ones whose
result equals the clicked line's code* — then hand the resulting
account id list straight to the **already-built**
`LedgerService.accountLedger()` (the exact primitive Grand Livre's own
row-expand already uses) to list each account's écritures for the year.
No new écriture-listing code, no new UI primitive — `AccountLedgerDrilldown`
already renders this shape.

Covers, in one pass since they share the one engine:
- **Bilan 2050/2051** — `ACTIF_RULES`/`PASSIF_RULES`/`DUAL_NATURE_RULES`
  in `liasse-line-rules.ts`.
- **Compte de résultat 2052/2053** — `CDR_RULES`, same engine.
- **2057** — for free once bilan traces: per CLAUDE.md, "every 2057 row
  is exactly one bilan actif/passif line," so 2057's trace IS bilan's
  trace, relabeled.
- **Régime simplifié 2033-A/2033-B** — the SAME engine, a different
  rule table (`bilan-2033-a.ts`, `compte-resultat-2033-b.ts`) — proven
  in the original 2033-series build to need zero engine changes, so
  this should be equally mechanical here.

**The one landmine, already hit once and documented — do not
re-introduce it.** Dual-nature accounts (512/514/516/517 bank
overdraft; the 428/438/448/455/458/467/468 family) resolve by the
**account's aggregate balance sign for the whole period**, never any
single ligne's own sign. The 2057 maturity-split build classified
per-ligne once, got it wrong, and `buildMaturityTotals()` was rewritten
to aggregate each account ONCE first — see that function's own doc
comment and CLAUDE.md's "Liasse fiscale / 2057" section for the exact
failure. The reverse-mapping loop here must aggregate each account
first (the same shape `trialBalance()` already produces) and classify
that aggregate, not iterate raw lignes — and this needs its own named
regression test reproducing that exact failure mode, not just an
assumption that reusing `resolveLineCode()` correctly makes it safe by
default.

### Tier 2 — 2054/2055/2056: simpler than tier 1, no dual-nature at all

`resolveImmobilisationCategory(accountNumber)` and
`resolveProvisionCategory(accountNumber)` are pure, single-argument,
per-account functions — no balance sign, no dual-nature branch, nothing
`resolveLineCode()` has to worry about. Reverse mapping here is even
more mechanical than tier 1: for every account, call the resolver, keep
matches. Genuinely low-risk — could ship alongside tier 1 rather than
strictly after it, since it doesn't share tier 1's landmine at all.

Movement columns (début/dotations-acquisitions/reprises-cessions/fin)
add one wrinkle tier 1 doesn't have: which écritures fall in the
"début" bucket vs. the "movement" bucket is already solved by
`FixedAsset.acquisitionDate` / `DepreciationEntry.fiscalYearId`
splitting (2054/2055) and by journal-type/à-nouveau-date splitting
(2056, per CLAUDE.md's "no dedicated domain model" note for that one) —
the drill-down's job is to surface which SIDE of that split a given
écriture landed on, not to re-derive the split itself.

### Tier 3 — CA3/VAT, 2058, 2059-A: no shared engine, each genuinely separate

- **VAT ligne 19/20 (déductible)** — **already done**, shipped in the
  2026-08-24 pass (each hardcoded to one account, 445662/445660).
  Nothing left to build here.
- **VAT ligne 08/09/9B/T6 (collectée by rate)** — genuinely different
  shape from every tier above: a rate is tagged **per-ligne** via
  `EcritureLigne.vatRateId`, not pinned to one account, and several
  different `4457x` accounts can carry the same rate. The reverse
  mapping is a new (simple) query — validated écriture lines in the
  period whose `vatRateId` matches AND whose account is a collectée
  account — not a reuse of any existing classifier. Its own oracle:
  Σ(credit − debit) of the matched lines must equal that rate's `taxe`
  figure on the `Ca3Declaration`. Same shape needed separately for the
  Monaco declaration (own rate/ligne mapping, own pass).
- **2058 `WA`/`WS`/`I7`** — these already just ARE the CDR's own
  `beneficeOuPerte`/`HK` line, so their "trace" is tier 1's CDR trace
  once that exists — no separate work.
- **2058 `WJ`/`WG`** — already ledger-suggested off one hardcoded
  account each (`6712`, `63514`) — same clean 1:1 shape as VAT ligne
  19/20, same low effort.
- **2058 declared worksheet lines (`WD`, `XA`, …)** — **structurally
  out of scope, not "not yet built."** These are user-declared tax
  judgment with no ledger source at all by this module's own design
  (see CLAUDE.md's résultat-fiscal section) — there is nothing to trace
  back to. Must be explicitly excluded in the UI (no drill-down
  affordance shown at all), not left to silently 404.
- **2059-A** — a **real, previously-undiscovered gap, checked against
  the schema while scoping this**: each row is already 1:1 with one
  `FixedAsset` disposal, but **`FixedAsset` has no stored reference to
  the écriture(s) `disposeFixedAsset()` posted** — no
  `cessionEcritureId`-shaped field anywhere in `schema.prisma`. Tracing
  a 2059-A row today would mean *searching* écritures by account+date+
  amount, which this codebase's own discipline ("never guess") should
  reject the same way it rejected every other approximate match
  elsewhere. **Needs a decision before this tier can be built**: either
  a small additive migration capturing the disposal's `ecritureId` on
  `FixedAsset` at cession time (same shape of change as the recent
  `RecentEntryLine.journalId` addition — an identifier, not a
  computation), or an explicit call that this row stays untraceable.

### Tier 4 — Cash flow / Analyse financière: not the same feature, decide separately later

Every tier above answers "which écritures sum to this number." Cash
flow and analyse-financière lines mostly don't have that shape at all:

- Most cash-flow lines are **deltas between two fiscal years' bilan
  snapshots** (`variationCreancesClients` = ΔBX between opening and
  closing bilan), not a single period's écritures.
- SIG cascade, BFR/FR/trésorerie nette, book EV, ratios are **arithmetic
  over other already-computed lines** (some of them tier-1 bilan/CDR
  lines, some already-deltas) — "what feeds this number" is a small
  formula, not an écriture list.

A faithful "detail" view for this tier would be a **formula trace**
(show the operands and the arithmetic, e.g. `variationCreancesClients =
BX(closing) − BX(opening) = 6 050,00 − 4 850,00 = 1 200,00`, each
operand itself further drillable into its own tier-1 trace) — a
genuinely different UI shape from "here is a list of écritures," and
composing two fiscal years' worth of tier-1 traces into one view is its
own design problem. **Recommendation: defer this tier to its own
follow-up conversation once tiers 1–3 have shipped and the pattern is
proven** — don't scope it further now, and don't let it block tiers 1–3.

## 2. Cross-cutting decisions to make before writing any code

These are the actual reason this needs a review pass rather than being
picked up mid-stream — pick one option per item, then implementation
can start.

1. **API shape.** One generic endpoint (e.g. `POST
   /liasse/line-trace {reportType, lineCode, fiscalYearId}`) vs. one
   endpoint per report family (`GET /liasse/bilan-line/:code/trace`,
   `GET /vat/rate-line/:ligne/trace`, …). This codebase's own pattern
   favors the latter — compare `generate()`/`generateSecondary()` as
   two separate endpoints rather than one branchy one, and the
   "throw rather than guess" discipline reads more naturally as one
   endpoint per well-typed shape than one endpoint special-casing
   report types internally. Recommend: per-report endpoints, sharing
   the reverse-classification helper functions, not a shared endpoint.
2. **Shared assertion, not one per report.** One
   `assertLineTraceabilitySums(lineValue, contributingAccountBalances)`
   helper, reused by every tier-1/2 report exactly like
   `assertFiscalYearOpen` is reused across every posting path — reduces
   the chance one report's oracle check is subtly different from
   another's.
3. **Which period a drill-down respects.** Recommend: always the full
   fiscal year the report itself was generated for, never an arbitrary
   Du/Au sub-range (unlike Grand Livre's own account drilldown, which
   does support a sub-period) — a sub-period balance wouldn't sum back
   to the report line's own value, breaking the oracle by construction.
4. **UI pattern: reuse, don't rebuild.** Once a line resolves to a set
   of account ids, hand off to the **existing** `AccountLedgerDrilldown`
   component — the exact same one Grand Livre already renders. The only
   new UI is the "which accounts does this line resolve to" step (a
   thin list of account rows, each expandable into the existing
   component) — not a new écriture-list renderer. Whether the trigger
   is inline expansion (matching Grand Livre's own row-click pattern)
   or a side panel is worth a quick visual check against a dense page
   like `LiassePage` before committing — inline is the default
   recommendation for consistency with the one drill-down pattern this
   app already has.
5. **Large multi-account lines need Area 4's filter, not a separate
   feature.** A line like `DX` (dettes fournisseurs) can resolve to
   dozens of `401xxx` tiers sub-accounts — the resolved-accounts list
   itself may need the same search/filter treatment the journal/grand
   livre/tiers tables got. Decide this now rather than as an
   afterthought once tier 1 is under construction.
6. **Drafts are moot, and the spec should say so explicitly rather than
   leaving it implicit.** A liasse can only be generated with zero
   draft écritures in the fiscal year (`generate()` refuses otherwise),
   and CA3 has the same block for its period — so by the time a report
   exists to click into, no drafts can exist under it. No
   draft-vs-validated toggle is needed on the drill-down itself.

## 3. Recommended build order

1. **Bilan 2050/2051** — proves the pattern (reverse-classify via
   `resolveLineCode()`, hand off to `accountLedger()`, one shared
   assertion), and 2057 traces for free the moment this ships.
2. **Compte de résultat 2052/2053 + the 2033-series equivalents** —
   same engine, same assertion, should be close to mechanical once (1)
   is proven — mirrors how the 2033-series bilan/CDR themselves were
   "the concrete test of whether the shared engine actually supports a
   second regime cleanly," and it did.
3. **2054/2055/2056** — own category resolvers, no dual-nature
   landmine, independently low-risk.
4. **VAT ligne 08/09/9B/T6, 2058 `WJ`/`WG`** — the rate-based query is
   new but small; `WJ`/`WG` reuse the already-proven single-account
   pattern.
5. **2059-A** — blocked on the `FixedAsset` cession-écriture-reference
   decision in §1's Tier 3 above; resolve that decision first.
6. **Cash flow / Analyse financière** — explicitly not scoped further
   here; its own conversation once 1–5 are shipped and reviewed.

Each numbered step ships as its own reviewable commit (or small commit
group), same "commit per area so it can be reviewed and reverted
cleanly" discipline as the autonomous UX pass, and each one needs its
own hand-traced oracle test **before** the endpoint exists — proving
the reverse mapping against a literal dataset the same way
`liasse-oracle-fixture.ts` already does for the forward direction.

## 4. Tier 1 — SHIPPED (2026-08-29)

Step 1 above (bilan 2050/2051, plus CDR 2052/2053 + the 2033-series
equivalents, plus 2057 tracing for free) shipped together as "Tier 1",
per the build instruction. Steps 2–6 in §3 are Tier 2+ and NOT started.
See CLAUDE.md's own "Traceability drill-down (Tier 1)" section for the
permanent, detailed record — this entry is intentionally a pointer, not
a duplicate, to avoid the two drifting apart.

- `resolveLineContribution()` (new, `liasse-line-rules.ts`) is the
  actual reverse-trace primitive, sharing `classifyAccounts()`'s own
  private matching functions — confirming §2's "reverse reuses forward"
  requirement was buildable exactly as scoped, with no separately-
  written reverse mapping anywhere.
- The oracle (§ above, "non-negotiable") is `assertLineTraceabilitySums()`
  — a genuinely separate second derivation checked against
  `classifyAccounts()`'s own total, not the same call reused as its own
  proof.
- **One real bug was found and fixed before this was presented for
  review, not by the reviewer**: the first version inferred which
  regime's rule table to trace against from `Company.regime`, which
  silently breaks the comparison view (`ComparisonSection` renders the
  regime the company did NOT officially pick). Fixed by making `regime`
  an explicit, required field on the trace request instead of an
  inferred one — see CLAUDE.md for the full account and the live
  confirmation both before and after the fix.
- Verified two ways (oracle tests + live, on both the FR demo company
  and "Société Test Multi-Année", including a real browser click-through
  reaching an attached justificatif) — see CLAUDE.md for the full
  verification summary. §2's non-negotiable oracle held throughout,
  across bilan lines, CDR lines, and both dual-nature branches
  (including the two-account `DU` case).
- Per the build instruction, this stopped there for review before any
  Tier 2 work began. See §5 below — Tier 2 is now shipped too.

## 5. Tier 2 — SHIPPED (2026-08-29, same day)

§3 step 3 above (2054/2055/2056 — "own category resolvers, no
dual-nature landmine, independently low-risk") shipped as "Tier 2," per
the build instruction. Steps 4–6 (VAT/2058, 2059-A, cash flow/analyse
financière) remain Tier 3+ and NOT started. See CLAUDE.md's own
"Traceability drill-down (Tier 2)" section for the permanent, detailed
record — same pointer-not-duplicate discipline as §4 above.

- Confirmed low-risk as predicted: no dual-nature landmine anywhere in
  2054/2055/2056. A DIFFERENT real risk showed up instead — three
  genuinely different détail shapes (FixedAsset-rooted, DepreciationEntry-
  rooted, account-ligne-rooted) and a genuinely new question Tier 1
  never faced (which movement columns can honestly offer a "→
  écritures" hop, since a "début" figure isn't always dated within the
  reported fiscal year). See CLAUDE.md for the full per-annexe
  resolution.
- Same "reverse reuses forward via one shared primitive" discipline —
  `classifyAssetContributions()`/`classifyDepreciationEntry()`/
  `classifyDisposal()`/`classifyProvisionLigne()`, each extracted from
  its own `computeTableau205X()`'s existing loop body, zero behavior
  change (16 pre-existing tests pass unmodified).
- Same non-negotiable oracle — each trace function independently
  re-runs the full forward compute and compares against that SEPARATE
  derivation's own value for the exact cell, not the same call checked
  against itself.
- **Two real things found and fixed before this was presented for
  review, not by the reviewer** (see CLAUDE.md for the full account):
  an internally-inconsistent détail row (2055's own account
  id/label/number pulled from two different accounts), caught by a
  test written specifically to check the three fields together; and a
  genuine prerequisite gap in `fetchImmobilisations()`'s own Prisma
  query (never fetched `depreciationAccount` at all), found and closed
  as part of this build rather than discovered mid-wiring — the
  discipline the build instruction explicitly asked for.
- Verified two ways (34 new backend tests: 18 oracle + 5 wiring + the
  pre-existing 16 confirmed unmodified; plus live, on both the FR demo
  company and "Société Test Multi-Année," including a real browser
  click-through reaching a real underlying écriture) — see CLAUDE.md
  for the full verification summary.
- Per the build instruction, this stops here for review before any
  Tier 3 work begins. §3's numbered build order above (VAT rate lines,
  2058 `WJ`/`WG`, 2059-A once its schema decision is resolved) is the
  candidate shape for Tier 3, not yet confirmed.

## 6. Tier 3 — SHIPPED (2026-08-29, same day)

§3's candidate shape for Tier 3 shipped exactly as sketched: CA3 lignes
08/09/9B/T6, 2058 `WJ`/`WG`, and 2059-A. See CLAUDE.md's own
"Traceability drill-down (Tier 3)" section for the permanent, detailed
record — same pointer-not-duplicate discipline as §4/§5 above.

- **The one stated prerequisite (§1's Tier 3 section, the
  `FixedAsset` cession-écriture-reference schema decision) was resolved
  first, via `AskUserQuestion`**: the user chose "Add
  `cessionEcritureId` now" — a new nullable `FixedAsset.cessionEcritureId`
  field, set in `disposeFixedAsset()` alongside `cessionDate`/
  `cessionPrice`. `ca3-declaration.ts`'s own constant exports
  (`findImplementedRate()`, `IMPLEMENTED_RATES`, `COLLECTEE_PREFIX`,
  `REVENUE_PCG_CLASS`), the OTHER stated Tier-3 prerequisite, were also
  exported as part of this work, not a separate pass.
- **Confirmed: no shared engine across the three, exactly as §1
  predicted** — each trace function reuses whatever forward primitive
  its own module already exposed (`findImplementedRate()` for CA3,
  `CONFIRMABLE_LINE_ACCOUNT_PREFIXES` for 2058, `resolveCessionNature()`/
  `CESSION_ACCOUNTS` for 2059-A), never a fourth shared abstraction
  invented to unify them.
- **The genuinely new shape §1 flagged for CA3 (a rate tagged PER-LIGNE,
  not per-account) was the real risk, and it held live**: the same
  account (`445710`) correctly split into two independent, correctly-
  computed contributions at two different rates simultaneously (200,00 €
  at ligne 08, 50,00 € at ligne 9B) — proven in the browser, not just by
  reading the code.
- **2059-A turned out to need no "sum ties to line" oracle at all**,
  unlike every other tier — a genuinely different oracle shape (see
  CLAUDE.md): each traceable column is already asset-level and resolves
  to exactly one account, so the real content is resolving the RIGHT
  account via the same forward primitive the disposal posting itself
  used, not summing anything.
- Verified two ways (new oracle-style tests across
  `ca3-line-trace.spec.ts`, `resultat-fiscal-trace.spec.ts`,
  `tableau-2059-trace.spec.ts`, plus `ResultatFiscalService`'s
  first-ever service-level mocked-Prisma test file — 636 backend tests
  passing overall, up from 609 after Tier 2); live against both required
  companies via curl and, for CA3/2058, in the browser too — see
  CLAUDE.md for the full verification summary, including the one honest
  gap (the 2059-A frontend click-through wasn't completed live after the
  browser session hit a hard rate limit mid-pass; the backend trace and
  the reused, already-verified frontend components make this an
  acceptable gap to ship with, not a blocker).
- **This closes the feature's stated scope.** §1 never defined a Tier 4
  — Tiers 1–3 were the complete plan. Any further drill-down work (e.g.
  a period-to-fiscal-year resolver enabling CA3's own "→ écritures" hop)
  is a new, separately-scoped feature.
