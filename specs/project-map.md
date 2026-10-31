# Project map — compta-fr-mc

**Generated**: 2026-10-31. **Method**: every claim below was checked directly against the running codebase (`backend/prisma/schema.prisma`, service/controller source, `app.module.ts`'s route allowlist, `App.tsx`'s route table, and the actual test suites — run, not assumed) by five parallel research passes plus direct checks by the orchestrating session. CLAUDE.md and `specs/roadmap.md` were consulted only as a cross-check, never as the primary source. **Where code and docs disagreed, code wins** — every disagreement found is called out explicitly below, not smoothed over.

**Full backend suite, confirmed green at the start of this audit**: 110 suites / 942 tests passing, `tsc`/`eslint` clean both sides, `vite build` clean. Per-cluster re-confirmation during this audit (five parallel passes, each re-running its own slice): 230/230 (core+FEC+import+auth+ops-readiness), 214/214 (VAT+liasse+résultat-fiscal+traceability), 171/171 (cash-flow+financial-analysis+immobilisations+invoicing+recurring), 215/215 (bank-rec+documents+AI-assistant), 99/99 (dashboard+anomalies+activity+search). All green, zero failures anywhere.

---

## How to read the classifications

- **VERIFIED** — code exists, automated tests exist and pass (confirmed directly by this audit), AND there is a genuine independent-verification artifact beyond session narrative: a hand-traced oracle tying two independent derivations together (this app's dominant discipline), a real external compliance-tool report on disk, or a structural guarantee (e.g. a type that cannot compile if misused). "Live-verified in a browser against a real company" claims from CLAUDE.md are **not independently re-run by this audit** (that would require standing up the dev stack and posting test data, which is build/test work, not inventory) — they're carried forward only where the surrounding code is consistent with the claim, and flagged separately where it isn't.
- **BUILT-NOT-VERIFIED** — code exists, compiles, and (where applicable) unit tests pass against mocks — but there is no oracle tying it to ground truth, or the ground truth is an external system this audit could not reach (no sandbox credentials, no real-world sample file).
- **STUBBED/PARTIAL** — a deliberate, named placeholder: a function that throws `NotImplementedException` for part of its input space, or a feature that works for a narrower case than its name suggests, confirmed in code (not just mentioned in docs).
- **PLANNED** — zero code. Confirmed by direct schema/grep search finding nothing, not by trusting the roadmap's own "not built" label.

---

## 1. Core ledger engine & operational readiness

| Item | State | Evidence |
|---|---|---|
| Core ledger (Company/FiscalYear/Account/Journal/Ecriture/EcritureLigne, immutability, sequential numbering, money-as-Decimal) | **VERIFIED** | Models confirmed in schema; `assertFiscalYearOpen()`, `EntriesService`/`EntryValidationService` confirmed; `no-float-money` ESLint rule confirmed real and wired (`eslint.config.mjs`); `EntriesService.validate()`'s counter-increment+update confirmed atomic in one `$transaction`. |
| FEC export (Article A47 A-1) | **VERIFIED** | `docs/compliance/rapport_123456789FEC20261231_test-compta-demat_1_00_10b.pdf` confirmed present on disk — a real external DGFiP-tool validation artifact, not just a claim. |
| FEC import | **VERIFIED, with a doc bug** | `MAX_FEC_IMPORT_SPAN_MONTHS = 13` confirmed. ⚠️ **CLAUDE.md says the grouping key is `` `${journalCode} ${sourceEcritureNum}` `` (space-separated); the actual code uses a literal NULL BYTE as the separator** — confirmed two ways (the fork's byte-level read, and independently by this session: `grep` itself refuses to treat the file as text, and a direct Python byte-count confirms exactly one `\x00` in the file, sitting in that key-construction code). Functionally harmless (arguably safer against a field containing a literal space) but the documentation is factually wrong about the character used. |
| Excel import | **VERIFIED** | Service+spec present, routed, tests pass. |
| CSV bank-statement import + shared delimited-text parser | **VERIFIED** | `csv-statement-parser.service.ts` + `common/text/delimited-text-parser.ts`, both tested, routed. |
| Plan Comptable (full Account CRUD + Excel bulk import) | **VERIFIED** | `rename()`/`remove()`/bulk-import all confirmed real with a full REST surface (`POST/GET/PATCH/DELETE`). |
| Multi-user / auth (JWT+refresh rotation, reuse-detection, ReadOnlyGuard, memberships) | **VERIFIED** | Middleware/guard chain confirmed wired exactly as documented. `ConsoleMailerAdapter` confirmed **genuinely functional**, not a stub — it logs a complete, real, clickable link; the whole invite/reset flow completes end to end through it. |
| Backup & recovery | **VERIFIED** | `GET /backup/export` only — confirmed **no restore endpoint exists anywhere in the module** (by design); `scripts/backup/README.md` confirmed present as the documented manual runbook. |
| Clôture d'exercice archival | **VERIFIED** | `ArchivedExport` model + `@@unique([companyId, fiscalYearId, kind])` confirmed in schema exactly as documented. |
| Bulk-validate | **VERIFIED** | `POST /entries/validate-batch`, mutually-exclusive `ecritureIds`/`fiscalYearId` guard confirmed in code. |
| Multi-client cabinet view (items 1–2: switcher + landing page) | **VERIFIED** | `CompanySwitcher.tsx`/`CabinetPage.tsx` confirmed real, frontend-only, routed at `/cabinet`. **Item 3 (batch cross-company actions) is PLANNED** — see below. |
| Data-import/migration-in for onboarding a new client | **VERIFIED, collectively** | FEC import alone can bootstrap a brand-new client's full chart-of-accounts + journals + historical draft écritures from an external file today; Excel/CSV supplement an already-set-up company. |

---

## 2. VAT — both regimes

| Item | State | Evidence |
|---|---|---|
| CA3 (régime réel normal, France) | **VERIFIED** | `vat.service.ts` branches `FR→CA3 / MC→Monaco / else→NotImplementedException` confirmed as a real `if/else/throw`; `IMPLEMENTED_RATES` (20/10/5.5/2.1%) confirmed. |
| Monaco VAT (Case B) | **VERIFIED, with two confirmed-open sub-items** | Same real jurisdiction branch. **TMP (ligne 49) and acomptes provisionnels (ligne 52) are confirmed genuinely absent from code** (not even a guessed field) — correctly **STUBBED/PARTIAL** within an otherwise-verified module, exactly as the docs claim, independently confirmed. |
| VAT Tier-3 line-trace (CA3 by rate) | **VERIFIED** | `ca3-line-trace.ts` real, routed, FR-only gate confirmed. |
| CA3 Case A — Monaco cross-border memo line (ligne 18 on the French CA3) | **PLANNED** | No `ligne18` field anywhere in `ca3-declaration.ts` — confirmed absent, documented as absent, consistent. |

---

## 3. Liasse fiscale — both regimes

| Item | State | Evidence |
|---|---|---|
| Régime réel normal (bilan 2050/2051, CDR 2052/2053, annexes 2054/2055/2056/2057/2059-A, both `generate()` and `generateSecondary()`) | **VERIFIED** | All files confirmed present and real; both entry points confirmed on `LiasseService`. |
| Régime réel simplifié (2033-A bilan simplifié, 2033-B compte de résultat simplifié) | **VERIFIED** | Real compute files with their own oracle specs, confirmed. |
| 2033-C onward (annexes for régime simplifié) | **PLANNED** | Zero files found matching this scope — confirmed absent, not merely unwired. |
| 2033-B's own "RÉSULTAT FISCAL" section | **PLANNED** | Not built (deliberately — same réintégration/déduction judgment problem as 2058). |

---

## 4. Immobilisations / depreciation

| Item | State | Evidence |
|---|---|---|
| Linear depreciation schedule, dotation posting, cession (disposal) | **VERIFIED** | `depreciation.service.ts`, `cession-proration.ts`, `cession-invariants.ts` all confirmed real and tested (15+14 tests). |
| Dégressif (declining-balance) method | **VERIFIED — shipped 2026-10-31** (Batch 1's GATED anchor, branch `degressif-depreciation`, not yet merged) | `computeDecliningSchedule()` (CGI art. 39 A coefficient table, max-of-dégressif-or-linéaire-restant switch rule) wired into `generateSchedule()`; `NotImplementedException` guard removed. Two hand-traced oracles verified by hand before coding — see CLAUDE.md "Immobilisations / dégressif depreciation." |
| Acquisition-year proration | **STUBBED/PARTIAL, unchanged** | Confirmed throws on a fiscal year that only partially overlaps the asset's depreciation window, for both methods now. Deliberately NOT attempted alongside dégressif (same-file collision, see below) — a separate, later pass. |
| ⚠️ **Code-quality discrepancy — fixed as part of the dégressif pass**: the boundary guards (depreciable-base check, the partial-year-overlap throw) used plain `throw new Error(...)`; both now throw `BadRequestException`, matching the rest of the app's discipline. |

---

## 5. Cash flow & financial analysis

| Item | State | Evidence |
|---|---|---|
| Tableau des flux de trésorerie (cash flow statement) | **VERIFIED** | `assertCashFlowReconciles()` confirmed a real throw (not a warning), tested, routed, frontend wired. |
| Analyse financière (retraitement analytique: SIG cascade, BFR/FR/trésorerie nette, FCF, book EV, ratios) | **VERIFIED** | Confirmed to call `CashFlowService.buildContext()` exactly once — real shared-fetch guarantee, not two independently-drifting formulas. |
| Valuation module (WACC, DCF, comparables, market EV) | **PLANNED** | Repo-wide grep for WACC/DCF/discount-rate found zero implementation anywhere — confirmed genuinely unbuilt. |
| Traceability drill-down Tier 4 (cash flow / financial analysis "formula trace") | **PLANNED** | Explicitly deferred in the original drill-down spec to "its own follow-up conversation" — no trace method exists on either service beyond what Tiers 1–3 (liasse/VAT/résultat-fiscal) already cover. |

---

## 6. Résultat fiscal (2058-A/2058-B)

**VERIFIED** for everything it claims to compute: `WA`/`WS`/`I7` (computed anchor), `WJ`/`WG` (confirmable suggestions), the generic declared worksheet, and the honesty-banner text — confirmed present **in code** (`resultat-fiscal-pdf.ts`, `-excel.ts`, and live in `ResultatFiscalPage.tsx`), not just in CLAUDE.md prose.

**2058-B Cadre I (déficits reportables) is PLANNED, structurally, not just unwired** — a repo-wide schema check found **zero** deficit/carry-forward-shaped model anywhere. Building this needs a new persisted entity wired into `FiscalYearsService.close()` (the same function clôture archival now also uses) before any 2058-B cadre-I code can exist at all.

---

## 7. Traceability drill-down (Tiers 1–3)

**VERIFIED, all three tiers.** `liasse.service.ts` confirmed to have real `traceBilanLine`/`traceCdrLine` (Tier 1), `traceTableau2054/2055/2056` (Tier 2), and `traceTableau2059`/`ca3-line-trace.ts`/`resultat-fiscal-trace.ts` (Tier 3) methods, each with a matching route and a matching frontend drilldown component, confirmed wired into `LiassePage.tsx`/`VatPage.tsx`/`ResultatFiscalPage.tsx`. `FixedAsset.cessionEcritureId` confirmed present in schema exactly as documented.

**⚠️ Documentation drift found (not a code bug)**: `specs/roadmap.md`'s own "Traceability drill-down" section (top-level §3, written before Tier 1 shipped) still frames the "→ attached justificatif" extension to the drill-down chain as an open design decision for a future pass. **It already shipped, as part of Tier 1** — `AccountLedgerDrilldown` already carries a `DocumentIndicator`, confirmed in CLAUDE.md's own Tier 1 write-up and consistent with the component code. The roadmap's top-level summary section simply wasn't updated after the Tier 1 build; the detailed CLAUDE.md record is correct.

**Tier 4 (cash flow / financial analysis) remains PLANNED** — see §5 above.

---

## 8. Invoicing

| Item | State | Evidence |
|---|---|---|
| Phase A posting/gating (Invoice/InvoiceLine, finalize, getMentions) | **VERIFIED** | Full REST surface confirmed real (`POST/GET/PUT/DELETE/finalize/mentions/related-ecritures/devis/mark-encaisse/factur-x`). |
| Factur-X rendering (EN16931, PDF/A-3) | **VERIFIED** | `libxml2-windows-path-fix.ts`/`esm-interop.ts` workarounds confirmed genuinely present; VAT-exempt-line guard confirmed a real `throw new NotImplementedException`. |
| Cash-basis VAT (TVA sur encaissements) | **VERIFIED** | `RegimeTvaServices` enum, 445800 suspense-account handling, `markAsEncaisse()` all confirmed real. |
| Invoice payment status | **VERIFIED** | Cross-module reuse (`classifyInvoicePaymentStatus()` lives in `anomalies/invoice-anomaly-engine.ts`, imported into `invoicing.service.ts`) confirmed genuinely real, not duplicated. |
| Related écritures | **VERIFIED** | `getRelatedEcritures()` + route confirmed real. |
| Devis PDF + bank payment details | **VERIFIED** | `Company.bankName`/`iban`/`bic` confirmed nullable `String?` fields; `POST :id/devis` confirmed real. |
| Tiers identity pre-fill | **VERIFIED** | All six `Account` identity fields confirmed present in schema. |
| Monaco invoicing | **STUBBED/PARTIAL, confirmed unconditional** | `computeInvoiceMentionsMC(): never` — the `never` return type is a compile-time guarantee it cannot return; it always throws, quoted verbatim by the audit, naming the exact external source (monentreprise.gouv.mc) still needed before this can be implemented. Draft creation works; finalize/devis are both hard-gated. |

---

## 9. Bank reconciliation — both layers

| Item | State | Evidence |
|---|---|---|
| Layer 1a (CAMT.053 + CSV import, matching engine, review, `setLettrage()`) | **VERIFIED, with one confirmed external-verification gap** | `EntriesService.setLettrage()` confirmed as the sole immutability-bypass, correctly scoped and audited. **The CAMT.053 fixture is confirmed, in the code's own comments (not just CLAUDE.md), to have never been checked against a real bank export** — `camt053-parser.service.ts` literally states this. This is a real, self-documented pre-ship item (see below), not a code defect. |
| Layer 1b (Bridge aggregator) | **BUILT-NOT-VERIFIED — the clearest pre-ship blocker in the app** | Confirmed **9 separate `PLACEHOLDER` markers** in `bridge-aggregator.adapter.ts`, with a top-of-file comment stating verbatim: *"⚠️ PAPER DESIGN — ZERO REQUESTS HAVE EVER BEEN SENT TO THE REAL BRIDGE API... no code in this file has ever run against a live Bridge sandbox or production endpoint."* Confirmed via grep: zero code paths, test or otherwise, ever reach `api.bridgeapi.io`. The read-only (AIS) scope parameter (`'aggregation'`) is explicitly an unconfirmed guess. |

---

## 10. Supporting documents & AI assistant

| Item | State | Evidence |
|---|---|---|
| Document attachments (attach/view/replace/remove + audit log) | **VERIFIED** | `EcritureDocument`/`EcritureDocumentAuditLog` models confirmed, cascade-delete confirmed, routes confirmed. |
| Deterministic extraction (Layer 2) | **VERIFIED** | Genuinely uses `pdf-parse`, confirmed via import. |
| Cloud suggestion (Layer 3, "Comptable IA") | **VERIFIED** (reuses the cloud tier below, same gate) | |
| AI assistant Phase 1 (16 read-only tools, local model) | **VERIFIED** | Tool count independently re-counted at exactly **16**, matching the documented list name-for-name. |
| AI assistant Phase 2 (`propose_ecriture`, injection-safe invoice extraction) | **VERIFIED** | `EntryValidationService` confirmed genuinely shared between `EntriesService` and `ProposeToolsService` — the actual safety property, not a claim. |
| AI assistant cloud tier (Claude + DeepSeek adapters, consent flow, thread gating) | **Mixed — flag this precisely** | `CredentialEncryptionService` confirmed **genuinely** AES-256-GCM (`createCipheriv`/`createDecipheriv`, not just a name). `cloud-thread-gate.ts`'s provider-switch-refused/new-thread-needs-file rules confirmed real in code. **But**: a direct grep of both `claude-cloud-model.adapter.ts` and `deepseek-cloud-model.adapter.ts` for any "verified"/"real key"/"real API" marker returned **zero matches in either file** — unlike the Bridge adapter, which self-documents its unverified status directly in code, **neither cloud AI adapter carries any in-code trace of its live-verification history**. CLAUDE.md's claim that Claude was live-tested with a real key while DeepSeek wasn't rests **entirely on session narrative**, with no corroborating or contradicting evidence in the code itself. Treat "Claude cloud tier live-verified" as **BUILT-NOT-VERIFIED-BY-THIS-AUDIT** — plausible, detailed, and consistent with the code, but not something this audit can independently confirm from the repository alone. DeepSeek is consistently **BUILT-NOT-VERIFIED** either way (same code shape, nobody claims otherwise). |
| Batch invoice review queue | **VERIFIED** | Confirmed genuinely client-side-only — no new backend route, reuses `/documents/extract` + `/documents/suggest-accounts` + `POST /entries` exactly as documented. |

---

## 11. Recurring entries, anomalies, dashboard

All three: **VERIFIED.**
- Recurring entries: `recurring-entries.service.ts` confirmed to genuinely inject `EntryValidationService` (not `EntriesService.create()` directly) — the real safety property, confirmed by doc comments and import sites together.
- Anomalies: `MIN_HISTORY_MONTHS = 4` confirmed in code exactly as the documented false-positive fix requires.
- Dashboard: `getSummary()` confirmed to make essentially zero direct Prisma calls of its own (one narrow, documented exception) — the "pure presentation, zero new aggregation" claim holds.

---

## 12. Multi-user, reporting exports, UI/UX pass

All **VERIFIED**, no discrepancies found:
- Every report module (liasse, VAT, cash-flow, financial-analysis, résultat-fiscal, ledger) confirmed to have both a `*-pdf.ts` and `*-excel.ts` file — full coverage, no gaps.
- Search (`entries.service.ts`): route-ordering (`/search` before `/:id`) confirmed correct in the actual controller — this was a real, documented landmine, and it's genuinely avoided.
- Command palette, search history, activity feed, `SectionTabs`/`OnboardingChecklist`/`NeedsAttentionPanel`/toast store: all confirmed real, non-trivial files.
- "Citaledge" rename confirmed scoped exactly as documented — present in the 4 user-visible files, deliberately absent from both `package.json` names and the repo folder name.
- Known-scope-boundary "no delete" claims (`Journal`, `VatRate`, `FiscalYear`) independently re-confirmed: none of the three controllers has a `@Delete` route.

---

## PRE-SHIP BLOCKERS (external verification required — ranked by severity)

1. **Bridge aggregator adapter (bank reconciliation Layer 1b)** — confirmed, in the code's own words, a complete paper design. Zero requests ever sent to the real API. Needs real Bridge sandbox credentials (an actual account/contract, outside what any agent can obtain) before any further code is trustworthy. The sandbox pass should be *expected* to find real mismatches (wrong field names, a different response envelope, a wrong scope-parameter name) — it is a real verification pass, not a formality.
2. **CAMT.053 parser — never checked against a real bank export.** The fixture is hand-built and spec-compliant by construction; real banks are known to interpret the ISO 20022 standard loosely (inconsistent label nesting is the one documented example; other structural surprises are plausible and unexercised). Needs one real exported `.xml` file from an actual bank before this reaches a real user's real statement.
3. **AI cloud tier — Claude adapter's "live-verified with a real key" status is unconfirmable from the repository.** Not a blocker in the same sense as #1/#2 (the mechanism — shared `ChatModelPort`/orchestrator/gate — is proven correct via the Bridge-adjacent DeepSeek code path and unit tests), but the specific claim of a successful live round-trip rests entirely on session narrative with zero code-level corroboration. If this matters for a go/no-go decision, re-verify with a real key rather than trusting the claim as-is.
4. **DeepSeek adapter — explicitly never live-tested**, consistently described that way everywhere (code and docs agree). Lower priority than #1/#2 since it shares all the same now-proven machinery as the Claude adapter.

---

## KNOWN STUBS — `NotImplementedException` / explicit "pending" gates in code

Every one of these was independently confirmed to throw unconditionally or for a named subset of input, with a stated unblock:

| Guard | File | Unblocked by |
|---|---|---|
| `computeInvoiceMentionsMC()` (Monaco invoicing) | `invoicing/invoice-mentions.ts` | Confirming Monaco's numbering/transmission regime against `monentreprise.gouv.mc` / Direction des Services Fiscaux de Monaco — a legal-research task, not a coding task. |
| VAT-exempt line → Factur-X | `invoicing/invoice-to-cii.ts` | Adding a UNTDID 5305 exemption-reason field to `InvoiceLine` and resolving a category code. |
| `DepreciationMethod.DECLINING` | `depreciation/depreciation.service.ts` | Implementing the dégressif schedule formula (textbook, citable). |
| Acquisition-year depreciation proration | `depreciation/depreciation-schedule.ts` | Extending `computeLinearSchedule()`'s day-count convention (the cession-side convention already exists as a template). |
| `vat.service.ts`'s jurisdiction branch (anything but FR/MC) | `vat/vat.service.ts` | Not a real gap — defensive-only, `Jurisdiction` enum only has two values. |
| `BankAggregatorLinkService` — Monaco jurisdiction | `bank-aggregator/bank-aggregator-link.service.ts` | Confirming Bridge's (or another aggregator's) Monaco coverage — unconfirmed, same flavor as Monaco invoicing. |
| `liasse.service.ts` — unreachable regime branch | `liasse/liasse.service.ts` | Defensive-only, same reasoning as the VAT one above. |
| 2058-B Cadre I (déficits reportables) | *(no file — structurally absent)* | A new persisted carry-forward entity wired into `FiscalYearsService.close()`. |
| 2033-C onward | *(no file — structurally absent)* | A full annexe build-out, same shape as the 2050-series' own annexe passes. |

---

## SHIPPABILITY FUNDAMENTALS

| Fundamental | Status | Basis |
|---|---|---|
| **Backup/recovery** | **VERIFIED** | Real `pg_dump`-based export confirmed working end to end (export → real round-trip restore into a fresh DB, byte-for-byte verified per CLAUDE.md, structurally confirmed by this audit: export-only route, documented manual restore runbook present on disk). |
| **Clôture d'exercice (period locking / archival)** | **VERIFIED** | `close()` confirmed to require a successful FEC generation+archive before a year can close; `ArchivedExport`'s unique constraint confirmed in schema. |
| **Data-import/migration-in for onboarding existing clients** | **VERIFIED** | FEC import alone bootstraps a full new client (accounts+journals+draft-écritures with auto-fiscal-year resolution); Excel/CSV cover the supplementary cases. No format beyond OFX/QIF is missing for a realistic onboarding. |
| **Cabinet-level multi-client view** | **BUILT (partial)** | Switcher + landing page (items 1–2) are VERIFIED and shipped. **Item 3 — batch cross-company actions — is PLANNED**, not built. A cabinet user can see every client's status today but cannot yet run one action ("export FEC for every client closing this month") across several companies at once. |

All four fundamentals the user asked about are at least built; three of four are fully verified. The one genuine gap (cabinet batch actions) is scoped, not mysterious.

---

## PARALLELIZATION ANALYSIS

### Shared collision hotspots — read this before assigning anything

Four files are touched by **almost every** feature regardless of size, and conflicts there are near-certain if two features land close together in time. This is not hypothetical — this exact session just resolved three such conflicts (in `CLAUDE.md`, `specs/roadmap.md`, and `invoicing.service.ts`) merging four already-built branches. The conflicts were **all mechanical** (two independent new sections/methods landing at the same insertion point) and took seconds each to resolve correctly. Don't avoid parallelism because of these — just expect to spend a few minutes resolving textual conflicts on every merge:

- `CLAUDE.md` — every shipped feature gets a new `##` section, almost always appended near the end.
- `specs/roadmap.md` — every shipped feature flips a status line and touches the "Sequencing" prose nearby.
- `frontend/src/App.tsx` — every new page adds one `<Route>` line.
- `backend/src/app.module.ts` — every new backend module adds itself to the imports array and (if company-scoped) the `companyScopedControllers` allowlist.
- `frontend/src/api/{types.ts,queries.ts}` — every new endpoint adds a type + a hook.

**Two files are genuinely dangerous, not just mechanically noisy — these are the real serialization points:**

- **`backend/prisma/schema.prisma` + the migrations directory.** Prisma's migration history is sequential and ordered. Two branches that each add a model/field independently will conflict in `schema.prisma` text (resolvable, same as above) — but if both also generate a migration file, the two migration histories can produce a DB that doesn't match either branch's own expectations unless migrations are regenerated carefully after merge. **Any two schema-changing features should not be developed fully in parallel without an explicit plan for migration-order reconciliation.** This is the single most important constraint in this whole analysis.
- **`backend/src/modules/entries/{entries.service.ts, entry-validation.service.ts}`.** This is the actual shared ledger-validation core. Every GATED feature in this app's history has deliberately avoided editing it directly (Invoicing, cession, à-nouveau, `propose_ecriture`, recurring entries all *reuse* `EntriesService.create()`/`.validate()` or `EntryValidationService`'s existing checks verbatim, through a new, separate posting module). **Only one roadmap item below would genuinely need to edit this file's own validation logic** (comptabilité analytique's `costCenterId` check, mirroring the existing `vatRateId` check) — that item alone should be treated as needing serial, single-occupant access to this file; everything else that "touches the ledger" does so by calling the existing surface, not editing it.

### Classification of every open/PLANNED item

| Item | Tag | Core files it would touch | Collision notes |
|---|---|---|---|
| **1a. Quote/Order entities + links** | **SELF-VERIFIABLE** (state-machine oracle: only valid transitions allowed; never touches ledger posting at all, per roadmap's own classification) | New `schema.prisma` models (Quote, Order), new `src/modules/quotes/`, `Invoice` gains an optional `sourceOrderId` (minor touch to `invoicing.service.ts`), new frontend pages | Schema-touching — serialize against any other schema change, see above. Otherwise isolated. |
| **1c. Procure-to-pay** (PurchaseOrder, GoodsReceipt, SupplierInvoice, 3-way match, règlement) | **GATED** — largest lift in the roadmap | New `schema.prisma` models (×3+), new `src/modules/procurement/` (posts via `EntriesService.create()`/`.validate()`, reused not modified — same pattern Invoicing already set), reuses `setLettrage()` as-is | Schema-touching. The actual constraint here is review bandwidth (it's explicitly "the single largest item"), not file collision — it doesn't touch `entries.service.ts` directly. |
| **1d. Payroll interface** (import + gated template posting only) | **GATED but narrow** | New `src/modules/payroll-import/`, posts via `EntriesService` as-is, no new validation rule | Isolated — lowest-risk GATED item on this list. |
| **1f. Prepayments/acomptes** | **GATED** | New `schema.prisma` model (`Prepayment`), new `src/modules/prepayments/`, posts via `EntriesService` reuse | Schema-touching. ⚠️ **Natural follow-on collision, not immediate**: once built, 1e's `getRelatedEcritures()` (`invoicing.service.ts`) is the natural place to add a real-FK-based payment row alongside its current lettrage-guess row — don't build 1f and a change to `getRelatedEcritures()` in two different parallel streams without coordinating. |
| **2a. Stock valuation (FIFO/CUMP)** | **GATED** | New stock module, touches `liasse/bilan-2050.ts` (the "5 stock lines") and `cash-flow/cash-flow-statement.ts` (BFR stock figures, which already has a documented brut-vs-net landmine) | **Hard sequencing dependency on 1c** (needs goods-receipt events to exist first) — see "looks parallelizable but isn't" below. |
| **2b. Comptabilité analytique** (cost-center tagging) | **GATED for the tagging/validation step** (the one item that genuinely edits `entry-validation.service.ts`), **PRESENTATION for the report** | `schema.prisma` (new `CostCenter` model + `EcritureLigne.costCenterId`), `entries/entry-validation.service.ts` (new check, mirrors the existing `vatRateId` check), new report module reusing `trial-balance-engine.ts` read-only | **This is the one item that must be the sole occupant of `entry-validation.service.ts` whenever it's in flight.** Otherwise genuinely independent — roadmap explicitly says it "could be picked up any time, including before Tier 1." |
| **2c. Budgeting/forecasting** | **SELF-VERIFIABLE** (variance arithmetic trivial; the "actual" column is a pure regression check against `trial-balance-engine.ts`, read-only) | `schema.prisma` (new `Budget`/`BudgetLine`), new `src/modules/budgeting/` | Schema-touching, otherwise fully isolated — zero touch to `entries.service.ts`/posting. |
| **Traceability Tier 4** (cash flow / financial analysis formula trace) | **SELF-VERIFIABLE** (same "sum ties to line" oracle discipline as Tiers 1–3) | New trace methods on `cash-flow.service.ts`/`financial-analysis.service.ts` (additive), new frontend drilldown component | No schema change, no ledger-core touch. One of the cleanest items on this whole list. |
| **Cabinet item 3** (batch cross-company actions) | **SELF-VERIFIABLE** (partial-failure reporting — "N of M succeeded, name the rest" — is a clean, regression-testable oracle) | New orchestration module, touches the already-shipped `CabinetPage.tsx` | No ledger-core touch — loops over already-gated per-company actions. |
| **OFX/QIF bank import** | **SELF-VERIFIABLE** (known file → known parsed output, same discipline as CSV/CAMT053) | New parser file only, reuses `persistParsedStatement()` verbatim, one additive route on `bank-reconciliation.controller.ts` | Zero touch to `matching-engine.ts` or `entries.service.ts`. One of the lowest-risk items here. |
| **Real (non-console) mailer adapter** | **SELF-VERIFIABLE in principle** (send succeeds/fails is directly observable) | `mailer.port.ts` + one new adapter file | **Also has an external-verification shape** (needs a real SMTP/API account to confirm) — same texture as Bridge, just much cheaper to close. |
| **Monaco invoicing rule content** | Needs external confirmation before it's buildable at all | `invoicing/invoice-mentions.ts` — a file already touched by nearly every invoicing sub-feature this session | Not a build task yet. Confirm against a cited Monaco source first; only then does a GATED coding task exist. |
| **Monaco VAT open items** (TMP, acomptes) | Same as above | `vat/monaco-declaration.ts` | Same — research blocker, not a file-collision blocker. |
| **CA3 Case A ligne 18** | **SELF-VERIFIABLE** (hand-traceable against the primary source, same discipline as the rest of CA3) | `vat/ca3-declaration.ts` — a heavily-tested, sensitive file | Low practical collision risk today (nothing else is planned to touch this file), but keep it that way — don't pair it with another CA3 change in the same window. |
| **Dégressif depreciation** | **GATED** (textbook formula, hand-traceable oracle) | `depreciation/depreciation.service.ts` + `depreciation-schedule.ts` | ⚠️ **Same file as acquisition-year proration below — do not run both at once.** |
| **Acquisition-year proration** | **GATED** | `depreciation/depreciation-schedule.ts` | ⚠️ Same collision as above. |
| **2058-B Cadre I** (déficits reportables) | **GATED** | New `schema.prisma` model, **`fiscal-years.service.ts`'s `close()`** (the same function clôture archival just extended this session), `resultat-fiscal.service.ts` | Schema-touching AND touches the one shared fiscal-year-close function — treat as needing the serial track on its own. |
| **2033-C onward** | **SELF-VERIFIABLE** (same rule-table + cross-regime-reconciliation oracle the 2033-A/B build already proved out) | New liasse files, additive calls inside `liasse.service.ts`'s `computeReelSimplifie()` path | Mild collision risk only if paired with another liasse change (e.g. 2a's bilan-2050 touch) in the same window — different regime path, low actual overlap. |
| CRM / project-mgmt / procurement e-sourcing / full payroll engine (Tier 3) | Not real build tasks | — | "Integrate, don't build" or "don't build" per the roadmap's own explicit recommendation. Not candidates for parallel engineering work at all right now. |

### Concrete parallel batches you could run now

**Batch 1 — the cleanest, zero-schema-touch trio — EXECUTED 2026-10-31, pending review (not merged):**
- Serial/gated track: **Dégressif depreciation**, done directly (branch `degressif-depreciation`) rather than delegated, since it's the GATED item the user wanted to check by hand.
- In parallel (isolated git worktrees): **OFX/QIF import** and **Traceability Tier 4** — see each one's own branch for status.
- Original analysis (kept for reference, now historical): none of these three touches the ledger core, so there was no *mandatory* human-checkpointed item in this batch — Dégressif was picked as the anchor anyway per the user's own instruction, specifically to exercise the serial/gated review track.

**Batch 2 — one schema change + two presentation tasks:**
- Serial/gated track: **2c Budgeting/forecasting** (SELF-VERIFIABLE, but it's the one with a schema addition in this batch — land its migration first, nothing else touches `schema.prisma` this round).
- In parallel: **Cabinet item 3** (batch cross-company actions — touches only `CabinetPage.tsx` + a new orchestration module) + **real mailer adapter** (touches only `mailer.port.ts` + one new file). Neither depends on the budgeting schema change or on each other.

**Batch 3 — the one GATED-core item, isolated on purpose:**
- Serial/gated track: **2b Comptabilité analytique's tagging step** — this is the ONE item that edits `entry-validation.service.ts`. Give it the whole review slot; don't schedule anything else that touches that file in the same window.
- In parallel: **CA3 Case A ligne 18** (touches `ca3-declaration.ts` only) + **2033-C onward, first annexe** (touches only new liasse files + an additive call in `liasse.service.ts`). Neither overlaps `entry-validation.service.ts` or each other's files.

### Flagged: looks parallelizable but isn't

- **2a Stock valuation** cannot start in parallel with anything until **1c's goods-receipt events exist** — this is a hard data dependency (roadmap's own words: "this item has no data to value without them"), not a file-collision risk. Don't schedule it alongside 1c expecting independent progress; it's strictly sequential after 1c.
- **Monaco invoicing content** and **Monaco VAT open items** look like small, parallel-friendly code tasks but aren't buildable at all yet — both are blocked on external legal-source confirmation (a government portal / tax-authority document), the same shape of blocker as the Bridge sandbox pass, just cheaper to close. Treat as "research task, then maybe code," never as a ready engineering task.
- **The AI cloud tier's "DeepSeek live verification"** looks like a quick parallel task (just run it once with a key) but depends on having a real DeepSeek API key available — an external-access blocker, not an engineering one. Don't put engineering time against it until a key exists.
- **Any frontend work on top of a BUILT-NOT-VERIFIED backend** (e.g., a nicer DeepSeek-tier UI, or a richer Bridge-connection UI) — the backend verification must come first. Building more UI on top of an unverified paper-design adapter just means more surface area to redo once the sandbox pass finds the inevitable mismatches.
- **Dégressif depreciation + acquisition-year proration** look independent (two different "missing features") but are a direct file collision (`depreciation-schedule.ts`) — run one at a time, not two reviewers on the same file simultaneously.
- **1f Prepayments + any concurrent edit to `invoicing.service.ts`'s `getRelatedEcritures()`** — not an immediate collision (1f doesn't require touching that method to ship), but the natural next step after 1f lands is exactly that method, so don't let a second, unrelated invoicing change be mid-flight on that same function when 1f's own follow-up work starts.
