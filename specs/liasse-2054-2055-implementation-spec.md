# Liasse annexes — 2054 (Immobilisations) & 2055 (Amortissements)

**Status: review artifact. No computation built yet.** Scope of this
pass: 2054 and 2055 only — not 2056 (provisions), 2057 (échéances),
2058-A/B/C (résultat fiscal), or 2059-A..G (plus/moins-values, divers),
which stay deferred per instruction.

## 1. What's in `specs/`, and what was already scaffolded

Both forms are in the same bundle already used for 2050-2053:
`specs/2050-liasse_5320.pdf`, pages 5 (**2054-SD**, "IMMOBILISATIONS")
and 7 (**2055-SD**, "AMORTISSEMENTS"). Page 6 (**2054 bis-SD**, "Tableau
des écarts de réévaluation") is part of the same physical page-run but
is a distinct form for legal-revaluation écarts — not opened for this
pass, out of scope. Confirmed present by rendering and reading the page
images directly (`pdftotext` mangles this multi-column layout the same
way it did for 2050-2053).

**What the immobilisations build already scaffolded**: the *data*, not
any 2054/2055 code. `FixedAsset` has `acquisitionDate`,
`acquisitionValue`, `accountId` (the class-2 account), and
`depreciationAccountId` (the class-28 contra account). `DepreciationEntry`
has `fiscalYearId` and `amount`, one row per asset per fiscal year, with
`postedEcritureId` marking whether it actually hit the ledger. Both
`cessionDate`/`cessionPrice` exist on `FixedAsset` but stay null — no
cession logic anywhere (confirmed: `depreciation.controller.ts` exposes
create + list + schedule + post-entry only, no update/cession
endpoint). **No 2054/2055 code exists** — `grep`-ing the backend for
"2054"/"2055" turns up exactly one hit, a doc-comment in
`liasse.controller.ts` saying they're "not generated."

## 2. Line spec

### 2054-SD — IMMOBILISATIONS

Two cadres, matched column-by-column (Cadre A's ending state feeds
Cadre B's "valeur brute début" implicitly via the same row).

**Cadre A** — Valeur brute début (col 1) | Augmentations: réévaluation/
mise en équivalence (col 2) | Augmentations: acquisitions, créations,
apports et virements de poste à poste (col 3).
**Cadre B** — Diminutions: par virement de poste à poste (col 1) |
Diminutions: par cession à des tiers ou mises hors service ou
résultant d'une mise en équivalence (col 2) | Valeur brute fin (col 3)
| Réévaluation légale/mise en équivalence: valeur d'origine fin (col 4).

| Row | A.1 / A.3 | B.1 / B.2 / B.3 |
|---|---|---|
| Frais d'établissement et de développement — TOTAL I | CZ / D9 | IN / CØ / DØ |
| Autres postes d'immobilisations incorporelles — TOTAL II | KD / KF | IO / LV / LW |
| Terrains | KG / KI | IP / LX / LY |
| Constructions — sur sol propre *(dont composants L9)* | KJ / KL | IQ / MA / MB |
| Constructions — sur sol d'autrui *(dont composants M1)* | KM / KO | IR / MD / ME |
| Constructions — inst. générales, agenc., aménag. des constructions *(dont composants M2)* | KP / KR | IS / MG / MH |
| Installations techniques, matériel et outillage industriels *(dont composants M3)* | KS / KU | IT / MJ / MK |
| Autres immo. corp. — inst. générales, agenc., aménag. divers | KV / KX | IU / MM / MN |
| Autres immo. corp. — matériel de transport | KY / LA | IV / MP / MQ |
| Autres immo. corp. — matériel de bureau et mobilier informatique | LB / LD | IW / MS / MT |
| Autres immo. corp. — emballages récupérables et divers | LE / LG | IX / MV / MW |
| Immobilisations corporelles en cours | LH / LJ | MY / MZ / NA |
| Avances et acomptes | LK / LM | NC / ND / NE |
| **TOTAL III** (corporelles) | LN / LP | IY / NG / NH |
| Participations évaluées par mise en équivalence | 8G / 8T | IZ / ØU / M7 |
| Autres participations | 8U / 8W | IØ / ØX / ØY |
| Autres titres immobilisés | 1P / 1S | I1 / 2B / 2C |
| Prêts et autres immobilisations financières | 1T / 1V | I2 / 2E / 2F |
| **TOTAL IV** (financières) | LQ / LS | I3 / NJ / NK |
| **TOTAL GÉNÉRAL (I+II+III+IV)** | ØG / ØJ | I4 / ØK / ØL |

(A.2/B.4 — réévaluation/mise-en-équivalence columns — omitted from the
table above; see §4, out of scope entirely.)

### 2055-SD — AMORTISSEMENTS

**Cadre A** (in scope) — "Situations et mouvements de l'exercice des
amortissements *techniques*" — Montant début (col 1) | Augmentations:
dotations de l'exercice (col 2) | Diminutions: amortissements
afférents aux éléments sortis de l'actif et reprises (col 3) | Montant
fin (col 4).

| Row | Début / Dotations / Diminutions / Fin |
|---|---|
| Frais d'établissement et de développement | CY / EL / EM / EN |
| Fonds commercial | RE / RF / RI / RJ |
| Autres immobilisations incorporelles | PE / PF / PG / PH |
| **TOTAL I** | RK / RM / RN / RO |
| Terrains | PI / PJ / PK / PL |
| Constructions — sur sol propre | PM / PN / PO / PQ |
| Constructions — sur sol d'autrui | PR / PS / PT / PU |
| Constructions — inst. générales, agenc. et aménag. des constructions | PV / PW / PX / PY |
| Installations techniques, matériel et outillage industriels | PZ / QA / QB / QC |
| Autres immo. corp. — inst. générales, agenc., aménag. divers | QD / QE / QF / QG |
| Autres immo. corp. — matériel de transport | QH / QI / QJ / QK |
| Autres immo. corp. — matériel de bureau et informatique, mobilier | QL / QM / QN / QO |
| Autres immo. corp. — emballages récupérables et divers | QP / QR / QS / QT |
| **TOTAL II** | QU / QV / QW / QX |
| **TOTAL GÉNÉRAL (I+II)** | ØN / ØP / ØQ / ØR |

**Cadre B** — "Ventilation des mouvements affectant la provision pour
amortissements dérogatoires" (dotations/reprises split by différentiel
de durée, mode dégressif, amortissement fiscal exceptionnel) —
**structurally inapplicable, not just deferred**: amortissements
dérogatoires exist specifically when the *tax* depreciation method
(dégressif, exceptionnel) diverges from the *book* method (linéaire).
This app only computes linéaire — `DepreciationMethod.DECLINING`
throws `NotImplementedException` — so there is no divergence for Cadre
B to ever report, for any asset this app can depreciate today. Genuinely
N/A, not a gap.

**Cadre C** — "Mouvements affectant les charges réparties sur plusieurs
exercices" (frais d'émission d'emprunt à étaler, primes de
remboursement des obligations) — a different asset class entirely
(class 1/4 loan-cost accounts, already the `CW`/`CM` bilan lines with
no amort split), not `FixedAsset`/`DepreciationEntry` data at all. Out
of scope for this pass, not built from the immobilisations module.

## 3. Mapping

### 3a. Confirmed: movement data (not just closing balances) is sourceable

This was the question to settle before anything else, and the answer
is yes for both forms, for a real schema reason in each case:

- **2054's "début" vs "acquisitions" split** comes directly from
  `FixedAsset.acquisitionDate`, a real per-asset field: an asset is
  part of "début" if `acquisitionDate < fiscalYear.startDate`, part of
  "acquisitions" if it falls within `[fiscalYear.startDate,
  fiscalYear.endDate]`. No new field needed.
- **2055's "début" vs "dotations" split** comes directly from
  `DepreciationEntry.fiscalYearId` — each posted dotation is already
  tagged to the specific fiscal year it belongs to. "Début" = sum of
  posted entries for fiscal years strictly before the reported one;
  "dotations de l'exercice" = the posted entry for the reported fiscal
  year itself. This is exactly why `DepreciationService` was built with
  one `DepreciationEntry` row per asset per fiscal year in the first
  place.
- **What is *not* sourceable**: cessions (2054 col B.2, 2055 col A.3's
  "reprises" half) — no cession logic exists. **Virements de poste à
  poste** (2054 col A.3's other half, col B.1) — reclassifying a
  `FixedAsset` to a different account has no code path either;
  `depreciation.controller.ts` has no update endpoint at all, so an
  asset's account is fixed for life. Both computed as 0.00, not
  omitted — see §5.

### 3b. A different engine layer than 2050/2052-2053 — asset-level, not trial-balance

2050/2052-2053's engine (`trial-balance-engine.ts` +
`classifyAccounts()`) aggregates *ledger* debit/credit lines per
account. 2054/2055 need something structurally different: grouping
**`FixedAsset` records** (and their `DepreciationEntry` children) by
category, split by whether their date falls inside or before the
reported fiscal year. The category-routing rule (which account number
maps to which row) is the same *kind* of prefix-matching logic as
`resolveImmobilisationLineCode()`, but must resolve to 2054/2055's
finer rows, not 2050's coarser ones (see §3c) — a new function, not a
reuse of the existing one. The shared piece across both engines isn't
code, it's the discipline: exactly-one-match-or-throw.

### 3c. Granularity mismatch with the existing 2050 mapping — a real decision, not just an implementation detail

2054/2055 want **finer rows** than `bilan-2050.ts` currently produces.
Bilan's `AP` ("Constructions") is one line fed by prefixes `['213',
'214']` combined; 2054/2055 want **three separate rows** (sur sol
propre / sur sol d'autrui / installations générales des constructions).
Bilan's `AT` ("Autres immobilisations corporelles") is one line fed by
`['212', '218']` combined; 2054/2055 want **four separate rows**. The
PCG nomenclature *can* support this — 213 subdivides into 2131
(bâtiments, "sur sol propre") and 2135 (installations générales),
214 is its own top-level account ("sur sol d'autrui"), 218 subdivides
into 2181/2182/2183+2184/2186 — but **this app's seed only has the bare
parent accounts** (`213000`, `218100`, `218200`, `218300`, `218400`),
never the finer sub-codes.

Proposed resolution, flagged for confirmation rather than assumed:
route by the finer PCG prefixes where a company actually uses them
(`214` → sur sol d'autrui, `2135` → installations générales, `2181`/
`2182`/`2183`+`2184`/`2186` → their respective autres-corp rows), and
treat a **bare `213` with no recognized sub-code as "sur sol propre"**
by convention (the common/default case) rather than as unmapped. This
mirrors the same kind of confident-but-not-source-confirmed call
already made for `206`→`AJ` in the 2050 pass — flagging it the same
way, not silently deciding. The alternative (collapsing 2054/2055 to
bilan's existing coarser buckets) would misrepresent real per-company
data by forcing everything into one placeholder row; recommend the
finer routing.

### 3d. Account-to-row mapping (2054 brut / 2055 amortissements, same account set for both)

| Category | 2054 row | 2055 row | PCG accounts |
|---|---|---|---|
| Frais d'établissement/développement | TOTAL I | Frais d'étab./dév. | 201, 203 |
| Autres postes incorporelles *(2054 only — folds fonds commercial in)* | TOTAL II | — | 205, 206, 207, 208, 232, 237 |
| Fonds commercial *(2055 only — separate row)* | *(within TOTAL II above)* | Fonds commercial | 207 |
| Autres immo. incorporelles *(2055 only, excl. fonds commercial)* | *(within TOTAL II above)* | Autres immo. incorp. | 205, 206, 208 |
| Terrains | Terrains | Terrains | 211, 212 |
| Constructions — sur sol propre | ✓ | ✓ | 213 (bare / non-2135) |
| Constructions — sur sol d'autrui | ✓ | ✓ | 214 |
| Constructions — inst. générales des constructions | ✓ | ✓ | 2135 |
| Installations techniques, matériel, outillage industriels | ✓ | ✓ | 215 |
| Autres corp. — inst. générales, agenc. divers | ✓ | ✓ | 2181 |
| Autres corp. — matériel de transport | ✓ | ✓ | 2182 |
| Autres corp. — matériel bureau/informatique, mobilier | ✓ | ✓ | 2183, 2184 |
| Autres corp. — emballages récupérables | ✓ | ✓ | 2186 |
| Immobilisations corporelles en cours | ✓ | *(not depreciated while "en cours")* | 231 |
| Avances et acomptes | ✓ | *(not depreciated)* | 238 |
| Participations mise en équivalence | *(out of scope, §4)* | — | — |
| Autres participations | ✓ | *(not amortized — financière)* | 261, 266 |
| Autres titres immobilisés | ✓ | *(not amortized)* | 271, 272, 273 |
| Prêts et autres immo. financières | ✓ | *(not amortized)* | 274, 275, 276, 277 |

**Note the 2054/2055 row-structure mismatch for incorporelles is real,
not an oversight**: 2054 groups frais-d'établissement-*et*-développement
as one TOTAL-I row and folds fonds commercial into TOTAL II's "autres
postes"; 2055 gives fonds commercial its own dedicated row instead.
Each form is mapped to its own printed structure — I did not force
artificial parity between the two.

## 4. Explicitly out of scope for this pass (structurally, not just "not built yet")

- **2054 col A.2 / col B.4** (réévaluation légale / évaluation par mise
  en équivalence) and the **"Participations évaluées par mise en
  équivalence"** row entirely — no revaluation or equity-method field
  exists anywhere on `FixedAsset`. Always 0.00 / unmapped by design,
  not a missing-data gap to close later with existing fields.
- **2054's "dont composants" memos** (L9/M1/M2/M3) — French GAAP's
  component approach (splitting one asset into parts with different
  useful lives). `FixedAsset` is one component per row; no
  sub-component tracking exists. Not applicable to this app's model.
- **2055 Cadre B** (amortissements dérogatoires) — see §2, genuinely
  N/A given linear-only depreciation, not deferred.
- **2055 Cadre C** (charges à répartir — frais d'émission d'emprunt,
  primes de remboursement) — different asset class, not
  `FixedAsset`-based at all.

## 5. The cession gap — exactly which cells stay at 0.00

Per instruction, stated explicitly rather than left implicit:

- **2054 Cadre B, col 1 (virements de poste à poste)**: always 0.00 —
  no reclassification code path exists (no `FixedAsset` update
  endpoint).
- **2054 Cadre B, col 2 (cessions/mises hors service)**: always 0.00 —
  `cessionDate`/`cessionPrice` stay null, no cession logic.
- **2054 Cadre A, col 3's "virements" half**: same reason as B.1 — the
  column is printed as one combined "Acquisitions, créations, apports
  et virements de poste à poste," but only the acquisitions portion is
  ever populated; virements contribute nothing, always.
- **2055 Cadre A, col 3 (diminutions: éléments sortis + reprises)**:
  always 0.00 — depends on the same missing cession logic (an asset's
  amortissements are only reversed when it's disposed of).

None of these are guessed at or backfilled with a plausible-looking
number — they compute to a real, correct 0.00 given the current
dataset, and will only become non-zero once cession logic is built
(tracked as existing, separate roadmap work, not part of this pass).

## 6. Articulation with the bilan — the annexe's version of Actif=Passif

Per bilan line group, 2054's ending brut (col B.3) minus 2055's ending
amortissements (col A.4), summed over the accounts feeding that bilan
line, must equal the bilan's own Net figure for that line — three
separate, independently-checkable ties (not one big check), each
following the same "two disjoint sources must agree" shape as the
bilan's own Actif=Passif check:

1. **`AP` (Constructions)**: bilan's `AP.net` = (2054's *sur sol
   propre* + *sur sol d'autrui* + *installations générales des
   constructions* ending-brut rows) − (2055's matching three
   ending-amortissements rows).
2. **`AT` (Autres immobilisations corporelles)**: bilan's `AT.net` =
   (2054's four autres-corp ending-brut rows) − (2055's matching four
   ending-amortissements rows).
3. **`AN` (Terrains)**: bilan's `AN.net` = 2054's Terrains ending brut
   (2055's Terrains amort row is near-always 0.00 in practice, since
   terrains aren't normally depreciable, but the check should still
   subtract it rather than assume zero).

All three, in turn, must still tie to the immobilisations module's own
VNC (`fixed-asset-invariants.ts`) for the same accounts — the
already-existing bilan↔VNC check doesn't change, 2054/2055 just add a
second, independently-sourced way to arrive at the same number (this
time via the movement tables' own arithmetic — début + acquisitions −
cessions = fin — rather than a direct point-in-time sum), which is a
genuine cross-check of the *movement* logic specifically, not a
restatement of the existing closing-balance check.

**A latent bug found while working this out, not yet fixed**:
`liasse.service.ts`'s `buildVncByLine()` (line 116) fetches
`prisma.fixedAsset.findMany({ where: { companyId } })` — every asset
the company has, with **no `acquisitionDate` filter**. It correctly
scopes `depreciationEntries` to the reported fiscal year or earlier
(line 121), but not the assets themselves. For a company reporting a
*past, closed* fiscal year that has since acquired new assets, this
would incorrectly include a later asset's `acquisitionValue` in the
VNC comparison — a real mismatch against the ledger-derived Brut, which
correctly excludes it (the trial balance is genuinely scoped to the
reported fiscal year's own écritures). Not yet manifested as a test
failure — the existing oracle tests exercise `assertLiasseArticulation`
directly against hand-built `VncCheckLine[]` fixtures, never through
`buildVncByLine()` itself, so this path has no coverage today.
**Flagging now, to fix as part of building 2054's début/acquisitions
split** (which needs the identical `acquisitionDate <= asOfEndDate`
filter anyway) — the same fix serves both.

## 7. Open items before computation can start

1. Confirm the granularity decision in §3c (finer 2054/2055-native
   rows, bare-`213`-defaults-to-"sur sol propre" convention) rather
   than collapsing to bilan-2050's coarser buckets.
2. Confirm the `buildVncByLine()` date-filter bug (§6) should be fixed
   as part of this pass rather than filed separately.
3. Confirm Cadre B (2055, dérogatoires) and Cadre C (2055, charges
   réparties) stay fully out of scope, not represented in the output
   shape at all (vs. e.g. present but always-null fields).
4. Confirm the three-line articulation check in §6 (AN/AP/AT
   independently) is the right shape, not a single combined check.

Computation stays unbuilt until this mapping is confirmed.
