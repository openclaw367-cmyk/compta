# Détermination du résultat fiscal (2058-A/2058-B) — design notes

Built against the actual forms — `specs/2050-liasse_5320.pdf` pages
10-11 (2058-A-SD, 2058-B-SD — **not** the two group-regime files also
named `2058-sd_5414.pdf`/`2058-sd_5416.pdf`, which are the *régime
fiscal des groupes de sociétés* (art. 223 A-U CGI) variant, a different
form family this app's companies don't use) — and the notice,
`specs/2032-not-sd_5323.pdf`, plus `specs/CGI complet.pdf` for the cited
articles. Never from memory, same discipline as every other liasse
module.

**This module is fundamentally different from every other liasse
piece already built** (bilan, compte de résultat, 2054/2055/2056/2057/
2059, cash-flow, financial-analysis). Every one of those is a pure
aggregation of ledger balances with a provable articulation invariant —
Actif=Passif, the 2054/2055 tie-out, ΔBFR tying to the cash-flow
statement, etc. The résultat fiscal is a comptable→fiscal
RECONCILIATION made of réintégrations and déductions that are TAX
JUDGMENT, not ledger aggregation. There is no oracle that proves a
given résultat fiscal *correct*, because correctness depends on which
adjustments actually apply under tax law — something no amount of
ledger-reading can determine. **See §4 below — this is the single most
important fact about this module and must not be forgotten by a future
session.**

## §1 — Status

**Built**: the compute layer (`resultat-fiscal.ts`), the fetch/wiring
service (`resultat-fiscal.service.ts`), `POST
/resultat-fiscal/generate`. Verified by hand-computed oracle tests and
live against both the FR demo company and the multi-year fixture — see
§5. **Not built**: any frontend/UI (explicitly deferred, this pass was
backend-only by instruction).

## §2 — Line spec, quoted from the form

### 2058-A-SD — DÉTERMINATION DU RÉSULTAT FISCAL

Header: `WA` Bénéfice comptable de l'exercice (or `WS` Perte comptable
de l'exercice, the déductions-side header).

**I. RÉINTÉGRATIONS** (→ `WR`, TOTAL I): `WB` rémunération de
l'exploitant (entreprises à l'IR) · `WD` avantages personnels non
déductibles* · `WE` amortissements excédentaires (art. 39-4) · `WF`
autres charges et dépenses somptuaires (art. 39-4) · `WG` taxe sur les
véhicules des sociétés · `RA`/`RB` crédit-bail immobilier · `WI`
provisions et charges à payer non déductibles (cf. 2058-B cadre III) ·
`XX` charges ETNC non déductibles · `WJ` amendes et pénalités · `XZ`
charges financières (art. 39-1-3° et 212 bis) · `XY` art. 155 · `I7`
impôt sur les sociétés · `WL`/`L7`/`K7` quote-part sociétés de
personnes/GIE, art. 209 B · `I8`/`ZN`/`WN`/`WO` moins/plus-values
particulières · `XR` écarts OPC · `SU`/`SW`/`M8`/`WQ` réintégrations
diverses · `Y1`/`Y3` taxation au tonnage.

**II. DÉDUCTIONS** (→ `XH`, TOTAL II, header `WS`): `WT` quote-part
pertes sociétés de personnes/GIE · `WU` provisions non déductibles
antérieurement taxées (cf. 2058-B cadre III) · `WV`/`WH`/`WP`/`WW`/`XB`
plus-values à long terme · `I6`/`WZ` autres plus-values · `2A`/`XA`
régime mères-filles · `ZX` participations inéligibles déductibles à 99%
· `ZY` investissements outre-mer · `XD` majoration d'amortissement ·
`XF` (11 zone-exoneration sub-codes: `HT`/`L2`/`L5`/`ØV`/`K3`/`PA`/
`PP`/`1F`/`XC`/`PC`/`PB`) · `XS` écarts OPC · `XG` (8 sub-codes: `X9`/
`YH`/`YA`/`YC`/`YB`/`YD`/`YI`/`ZI`/`YL`, art. 39 decies A-G) · `Y2`
taxation au tonnage.

**III. RÉSULTAT FISCAL**: `XI`/`XJ` bénéfice/déficit avant imputation
(I−II) → `ZL` déficit reporté en arrière → `XL` déficits antérieurs
imputés → **`XN`/`XO`** résultat fiscal.

### 2058-B-SD — DÉFICITS, INDEMNITÉS POUR CONGÉS À PAYER ET PROVISIONS NON DÉDUCTIBLES

**I. Suivi des déficits**: `K4` (déficits restant à reporter, N-1) →
`K4bis`/`K4ter` (transferts de plein droit) → `K5` (déficits imputés, =
2058-A `XB`+`XL`) → `K6` (déficits reportables = `K4+K4bis−K5`) → `YJ`
(déficit de l'exercice = 2058-A `XO`) → `YK` (total = `K6+YJ`).

**II. Indemnités pour congés à payer**: `ZT`.

**III. Provisions et charges à payer non déductibles** — a blank
worksheet ("à détailler sur feuillet séparé"): `ZV`/`ZW` congés à
payer, `8X`-`9C` provisions pour risques et charges (3 rows), `9D`-`9J`
provisions pour dépréciation (3 rows), `9K`-`9T` charges à payer (4
rows) → totals `YN`/`YO` reported to 2058-A `WI`/`WU`.

## §3 — The three-bucket categorization, as built

### (a) COMPUTED — implemented

| Line | Source | Notice citation |
|---|---|---|
| `WA`/`WS` | `CompteResultat2052_2053.beneficeOuPerte`, signed | The one real, assertable anchor — this app's own already-verified figure, no new derivation. |
| `I7` | `CompteResultat2052_2053`'s own `HK` line (compte 695) | **Resolved by the notice**, not inferable from the form alone: *"L'impôt sur les sociétés, la contribution sociale de 3,3% (article 235 ter ZC du CGI) ne sont pas déductibles du résultat"* + separately, *"[695] montant reporté ligne I7 du tableau n°2058 A-SD"* (p.9). `HK` was already a clean, dedicated CDR line (`compte-resultat-2052-2053.ts`, prefix `['695']`) before this module existed — no new ledger query needed. |

### (a) COMPUTED, but SUGGESTED not auto-locked — implemented

| Line | Account | PCG citation |
|---|---|---|
| `WJ` Amendes et pénalités | `6712` | Reglt 2014-03 p.139: `6712 - Pénalités, amendes fiscales et pénales`, distinct from `6711` (pénalités sur marchés — deductible), `6717` (rappel d'impôts), `678` (autres charges exceptionnelles). |
| `WG` Taxe sur les véhicules des sociétés | `63514` | Reglt 2014-03 p.138: `63514 - Taxe sur les véhicules des sociétés`, nested under `6351`/`635`, distinct from `63511`-`63513`/`6352`-`6358`. |

**Not confirmed or contradicted by the notice** — `2032-NOT-SD` has no
standalone explanatory paragraph for either `WJ` or `WG` beyond the
form's own label and a page-8 mention that pénalités/amendes fiscales
et pénales are captured within the compte de résultat's own charges
exceptionnelles bucket (this app's `HH`), which is consistent with,
but doesn't specifically endorse, using `6712` in isolation. Stated
plainly rather than implied: the account-level grounding here comes
from the PCG, not the notice.

**Why "suggested," never auto-populated and locked**: both accounts
are individually addressable in the PCG, but a réintégration is a
judgment about what belongs, not a balance-sheet definition the way an
account IS its own definition for a bilan line. A fine mis-posted to
`6788` instead of `6712` would silently understate the tax base if
this were trusted blindly — worse, the "computed" label would make the
user trust it MORE, not less. `computeResultatFiscal()`'s
`ConfirmableLigne` always reports `suggested` and `confirmed`
separately; nothing merges them. Verified live and by test
(`resultat-fiscal.spec.ts`, "never silently substitutes the suggestion
for the confirmed value") — a case where `suggested: "1000.00"` and
`confirmed: "0.00"` produces a total using `0.00`, not `1000.00`.

### (a) COMPUTED, but NOT modeled as separate fields — a deliberate simplification

| Line | Formula (notice-confirmed) | Why not built as a distinct field |
|---|---|---|
| `XE` | `= WD+WE+WF+WG+RA` | Notice, p.11: *"Mentionner dans la case XE, la somme des montants mentionnés dans les cases WD, WE, WF, WG et RA."* Pure addition, no independent logic. |
| `XW` | `= WI+WJ+XX+XZ` | Notice, p.11: *"Mentionner dans la case XW, la somme des montants mentionnés dans les cases WI, WJ, XX et XZ."* Same. |

Both are real, notice-confirmed (a) COMPUTED lines — but summing the
flat list of individual réintégration lines directly produces the
exact same `TOTAL I`/`WR` the CERFA's own two-step (sum into `XE`/
`XW`, then sum those into `WR`) would, since `XE`/`XW` add no logic
beyond addition. They are a CERFA print-layout grouping, not a
computation this module's arithmetic needs — deferred to whenever a
CERFA-shaped UI is built (a display concern at that point, same
reasoning applied to the `WA`/`WS` positive/negative split, which this
module also collapses into one signed `resultatComptable` value rather
than reproducing the two-line form presentation).

### (c) USER-DECLARED — the generic worksheet, everything else

Confirmed by the notice as genuine tax judgment, not a mapping gap:

- **`WD`** — notice: *"Notamment: dépenses personnelles des
  associés-dirigeants comptabilisées en charges."* No account-level
  signal for "personal expense."
- **`WF`** — art. 39-4 §3°/4° (yachts; chasse/pêche non
  professionnelle; résidences de plaisance). No account distinguishes
  a "voyage de chasse" from ordinary travel.
- **`RA`/`RB`** — crédit-bail immobilier reintegration. This app has
  no crédit-bail/leasing tracking at all.
- **`WI`/`WU`** (and all of 2058-B cadre III) — provisions non
  déductibles. **The form itself ships this as a blank worksheet**
  ("à détailler sur feuillet séparé") — confirming (c) is the form's
  own design, not a gap in this app. Notice examples confirm the
  judgment is genuinely case-by-case: *"la provision pour risques
  constituée dans le cadre de l'évaluation des participations selon la
  méthode de mise en équivalence n'est pas déductible"*; *"les
  provisions pour pertes futures sur stocks ne sont pas déductibles
  (art. 39-1-5°)."*
- **`XX`** — ETNC (non-cooperative jurisdictions). No
  counterparty-jurisdiction data on tiers.
- **`XY`** (art. 155), **`WL`/`L7`/`K7`** (art. 209 B) — notice
  confirms both as genuine international/mixed-activity judgment
  calls (*"résultats bénéficiaires provenant d'une entité établie dans
  un pays à fiscalité privilégiée"*), realistically irrelevant to a
  domestic SME.
- **`WT`, all long-terme plus-value lines** (`WV`/`WH`/`WP`/`WW`/`XB`/
  `I6`/`WZ`/`I8`/`ZN`/`WN`/`WO`), **`XA`/`ZX`, `ZY`, `XD`** — each
  requires a tax-qualification judgment already, deliberately, left
  unbuilt elsewhere in this app (2059-A's court-terme/long-terme split
  is the same class of gap, documented in CLAUDE.md as "needs
  holding-period/nature-of-asset judgment this app doesn't attempt").
- **`ZT`** (2058-B) — indemnités congés à payer déductibles, a
  payroll-detail judgment; no payroll module exists.

### (b) RULE-BASED, parametrizable, but blocked — deferred, not built

| Line | CGI basis (confirmed, quoted) | What's needed before this can move to (a)/(b)-implemented |
|---|---|---|
| `WE` | Art. 39-4 §1°: full ceiling schedule confirmed — base 18 300 €, up to 30 000 €/20 300 €/9 900 € by CO2 emissions band, WLTP classification, and acquisition-date thresholds. | `FixedAsset` has no CO2-emissions/WLTP/"véhicule de tourisme" fields — schema extension needed. |
| `XZ` (art. 39-1-3° portion) | Art. 212 I: related-party loan interest capped at a published quarterly reference rate or market rate if higher. | Needs (i) an admin-settable reference-rate parameter (same shape as `VatRate`), (ii) confirmation the ledger isolates `66117` distinctly. Note: `455` (comptes courants d'associés) is already its own dual-nature-routed bilan line — the related-party debt IS already identifiable in this app's chart, a promising sign for later. |
| `XZ` (art. 212 bis portion) | Confirmed: charges financières nettes deductible up to the greater of 3 000 000 € or 30% of a specially-adjusted EBITDA-fiscal figure. | Genuinely circular (depends on other 2058-A lines already resolved) AND, per the notice, requires a **separate form** (`2464-SD`, not in `specs/`) to compute the "charges financières nettes" figure per the CGI's broad definition (crédit-bail interest, currency gains/losses on loans, guarantee fees, ...). The single most complex candidate on the form — deprioritize even within a "build the rule-based lines" phase. |
| `ZL`/`XL` (2058-A) | Confirmed clean: report en arrière capped at `min(bénéfice N-1, 1 000 000 €)`; report en avant imputation capped at `1 000 000 € + 50% de l'excédent`. | Blocked entirely on the 2058-B cadre I persistence gap — see §4. |

Also confirmed long-tail and explicitly deferred, no realistic near-term
build case: the 11 `XF` zone-exoneration sub-codes (FRR, entreprises
nouvelles, JEI, ZFU-TE, SIIC, zone défense, bassin urbain, bassin
d'emploi, ZFANG, ZRR, zone développement prioritaire); the `XG`
sub-codes (art. 39 decies A-G exceptional deductions — several
confirmed by the notice as **already date-expired** for new
acquisitions, e.g. base 39 decies *"applicable aux biens acquis à
compter du 15 avril 2015 et jusqu'au 14 avril 2017"*); régime des
sociétés mères and its 99%-neutralisation sibling (`XA`/`ZX`);
investissements outre-mer (`ZY`); taxation au tonnage (`Y1`/`Y2`/`Y3`);
`XY`/art. 155; `WL`/`L7`/`K7`/art. 209 B; crédit-bail (`RA`/`RB`).

## §4 — 2058-B scope, stated plainly

**This pass delivers 2058-B's cadre III (provisions non déductibles)
only — not a full 2058-B.** Concretely:

- **Cadre III** — built, as the generic declared-adjustment worksheet,
  feeding `WI`/`WU` on 2058-A. This is the substance of what "2058-B"
  means in this module today.
- **Cadre I (suivi des déficits)** — **not built, not stubbed with a
  manual `K4` field.** The notice confirms `K4` is a genuine
  cross-fiscal-year chain: *"K4: il s'agit du montant porté sur la
  ligne YK du tableau n°2058-B-SD déposé au titre de l'exercice
  précédent."* This app has no persisted entity for tax-deficit
  carry-forward at all — a parallel, tax-only ledger distinct from
  `DH` (the accounting report-à-nouveau, already carried by
  `a-nouveau.service.ts`). A manual, unenforced `K4` input field was
  considered and rejected: it would produce numbers that *look*
  complete while silently drifting the first time someone forgets to
  carry `YK` forward by hand across a fiscal-year boundary — worse
  than not having the cadre at all. **The prerequisite for a real
  cadre I (and therefore a real full 2058-B) is a new persisted
  `DeficitFiscalReportable`-shaped entity** (or similar), carrying `K6`
  from year N into year N+1's `K4`, almost certainly wired into the
  fiscal-year-close flow the same way à-nouveau is today. Not started.
- **Cadre II (indemnités congés à payer)** — `ZT`, optional-regime
  (art. 39.1.1° bis) specific, narrow applicability. Deferred with the
  rest of the long-tail.

## §5 — The load-bearing design fact

**This module guarantees its ARITHMETIC. It does not, and cannot,
guarantee tax completeness.**

Every other module in this app proves its own correctness via an
independent articulation invariant: Actif=Passif, the 2054/2055
tie-out, ΔBFR tying between cash-flow and financial-analysis, the
trésorerie-nette identity. Those are genuine cross-checks — if the
invariant holds, the output is provably right, because the invariant
is derived independently of the figure it's checking.

`assertResultatFiscalArithmetic()` re-derives `totalReintegrations`/
`totalDeductions`/`resultatFiscal` from their own constituent lines and
throws on drift — but **every one of those constituent lines, except
`WA`/`WS` and `I7`, either came from a ledger suggestion the caller
could confirm incorrectly, or was declared by the caller directly with
zero independent check on whether it belongs, whether its amount is
right, or whether some OTHER réintégration was simply never
declared.** A worksheet that's arithmetically perfect can still be
fiscally wrong by omission — this module has no way to detect that,
by design, because detecting it would require exactly the tax judgment
§3's (c) bucket establishes this app cannot supply.

**This is a categorically different kind of "verified" than every
other module in this codebase claims, and a future session — or this
app's own UI copy — must never collapse the distinction.** A green
"arithmetic ties" indicator here means exactly that and nothing more.
When the UI is eventually built, this must be surfaced prominently
(not fine print): something to the effect of *"Ce tableau se recoupe
arithmétiquement — cela ne garantit pas que tous les retraitements
fiscaux applicables ont été déclarés."*

## §6 — Verified

Hand-computed oracle tests in `resultat-fiscal.spec.ts` (4 tests): a
full worksheet with a confirmed-line override and both declared
réintégrations/déductions; a test proving a suggestion never silently
substitutes for its confirmation even when they differ; a déficit
(negative résultat fiscal) reported signed, not flipped; and a test
proving `assertResultatFiscalArithmetic` actually throws on a corrupted
total. Separately, live against both real companies:

- **FR demo company** (`x-company-id: cmrgmp9di0000o5p89u5ru7r8`,
  `fiscalYearId: cmrgmp9dr0002o5p8fhuk06x6`): `resultatComptable
  "5405.00"` ties exactly to the compte de résultat's own
  `beneficeOuPerte`. With a confirmed `WJ` override (suggestion
  `0.00` → confirmed `150.00`) plus a declared réintégration (`WD`
  200.00) and déduction (`XA` 75.00): `resultatFiscal` correctly
  computed as `5405 + (0+150+0+200) − 75 = 5680.00`.
- **Multi-year fixture** (`x-company-id: cmsm0x5cc0000o5j8z8a3rr53`,
  `fiscalYearId: cmsm0xdlq0004o5j8ja1yc84k`): `resultatComptable
  "-8800.00"` ties exactly, reported as a signed déficit, `resultatFiscal`
  unchanged with no adjustments declared.
