# VAT / CA3 — Implementation Spec (Draft for Review)

**Status: decisions confirmed, implementation in progress.** Rate
tracking is `vatRateId` on `EcritureLigne` (Option B), T6 (2,1 %
continentale) is implemented as a standard rate alongside 20/10/5,5,
Monaco stays unbuilt. See "Decisions confirmed" below.

**Correction found while implementing**: the "lignes 01–03 base HT"
reference in the original request doesn't exist on the real form —
visually confirmed against the rendered CA3 pages. Each rate row (08,
09, 9B, T6, ...) carries **both** a "Base hors taxe" and a "Taxe due"
column on the *same* line — there is no separate line for the base.
`computeCa3Declaration()` reports `{ baseHT, taxe }` per rate line, not
per a nonexistent 01/02/03 triplet.

### Decisions confirmed

1. **Rate tracking**: Option B. `EcritureLigne.vatRateId` (nullable FK to
   `VatRate`). Generalizes to both the collectée-by-rate figures and the
   base-HT-by-rate figures, since the tag lives on the line, not the
   account.
2. **T6 (2,1 % continentale)**: implemented now as a fourth standard
   rate alongside 08/09/9B. DOM, Corse, produits pétroliers, and the
   rest of "taux particuliers" stay deferred.
3. **Monaco**: not built. Logged as a known dependency for the later
   Monaco pass: the notice in hand cannot confirm whether Monaco's own
   Cadre B mirrors the French 08/09/9B/16/23/25 structure — the actual
   Monegasque declaration *form* (not just this instructions notice) is
   needed before that pass can start.

Built from the primary sources now in `specs/`, not from memory:

- `specs/3310-ca3-sd_5377.pdf` — the CA3 form itself, cerfa n°10963*31,
  "Régime du réel normal - mini réel", art. 287 du CGI. Current model
  used for this spec.
- `specs/3310-ca3-sd_5047.pdf` — notice 3310-NOT-CA3-SD, cerfa n°50449#28
  (22 pages), the line-by-line explanatory notes for the form above.
- `specs/Monaco notice TVA.pdf` — Principauté de Monaco, Direction des
  Services Fiscaux, "Notice pour l'établissement de la déclaration" (2
  pages). **This PDF has no text layer (scanned image)** — read via
  page-image rendering, not text extraction. It is a notice, not the
  Monegasque declaration form itself; see §4 for what that means for
  confidence.

Both French PDF filenames say "5047"/"5377" but the actual document type
is identified from the text inside them, not the filename — worth noting
since the names don't self-describe which is the form and which is the
notice.

---

## 1. CA3 line spec

Scope for "implement now": a **French-established, mono-établissement,
métropole-only** company under régime réel normal — no DOM, no Corse, no
produits pétroliers, no groupe TVA / assujetti unique, no partial-deduction
(assujetti/redevable partiel) status. This is deliberately the smallest
honest slice of the form; everything else is listed as deferred, not
silently dropped.

### 1a. Cadre A — Montant des opérations réalisées (base HT, informational)

| Ligne | Libellé | Status |
|---|---|---|
| A1 | Ventes, prestations de services (chiffre d'affaires courant) | **Implement** |
| A2 | Opérations taxables particulières (cessions d'immobilisations, livraisons à soi-même, autoliquidations diverses...) | Defer |
| A3 | Achats de PS auprès d'un assujetti non établi en France (art. 283-2 CGI) | Defer (AIC/imports) |
| A4 | Importations hors produits pétroliers | Defer (AIC/imports) |
| A5 | Sorties de régime fiscal suspensif | Defer (AIC/imports) |
| B1 | Mises à la consommation de produits pétroliers | Defer (produits pétroliers, out of scope) |
| B2 | Acquisitions intracommunautaires (AIC) | Defer (AIC/imports) — feeds ligne 17 |
| B3 | Achats d'électricité/gaz/chaleur/froid imposables en France | Defer |
| B4 | Achats de biens/PS auprès d'un assujetti non établi en France (art. 283-1) | Defer |
| B5 | Régularisations (rabais, avoirs) | Defer (régularisations) |
| E1 | Exportations hors UE | **Implement** (0%, informational) |
| E2 | Autres opérations non imposables | **Implement** (0%, informational) |
| E3–E9, F1–F9 | DOM/Corse-adjacent, intracommunautaire, produits pétroliers, franchise, assujetti unique | Defer |

A1/E1/E2 are informational (feed no TVA arithmetic by themselves) but are
listed as "implement" because a basic-case declaration should still show
them. **Note**: unlike lines 08/09/9B (which require base HT *split by
rate*), A1 is a single aggregate figure — the "by rate" split only
matters once lines 08/09/9B are populated (§2/§3), not for A1 itself.

### 1b. Cadre B — Décompte de la TVA à payer

**TVA brute (collectée):**

| Ligne | Libellé | Arithmetic | Status |
|---|---|---|---|
| 08 | Taux normal 20 % (métropole) | base HT × 20 %, both entered directly | **Implement** |
| 09 | Taux réduit 5,5 % (métropole) | base HT × 5,5 % | **Implement** |
| 9B | Taux réduit 10 % (métropole) | base HT × 10 % | **Implement** |
| 10, 11 | DOM: taux normal 8,5 % / réduit 2,1 % | — | Defer (DOM) |
| T1–T5, T7, 13 | "Taux particuliers": DOM 1,75 %/1,05 %, Corse 13 %/10 %/0,9 %, T7 = retenue TVA droits d'auteur, 13 = anciens taux | — | Defer (territorial/exotic) |
| T6 | France continentale 2,1 % | — | **Implement now, per decision — a standard rate alongside 08/09/9B**, see §1c |
| P1, P2 | Produits pétroliers | — | Defer (produits pétroliers) |
| I1–I6 | Importations, par taux | — | Defer (AIC/imports) |
| 15 | TVA antérieurement déduite à reverser | — | Defer (régularisations) |
| 5B | Sommes à ajouter (y compris acompte congés) | — | Defer |
| **16** | **Total de la TVA brute due** | sum(08, 09, 9B, ..., 5B) — implemented scope: **16 = 08 + 09 + 9B** | **Implement (partial: basic-case rates only)** |
| 17 | Dont TVA sur acquisitions intracommunautaires (memo, subset of 16) | = taxe on B2 | Defer (AIC) |
| 18 | Dont TVA sur opérations à destination de Monaco (memo, subset of 16) | — | Structure only, see §4c |

**TVA déductible:**

| Ligne | Libellé | Arithmetic | Status |
|---|---|---|---|
| 19 | Biens constituant des immobilisations | — | **Implement** |
| 20 | Autres biens et services | — | **Implement** |
| 21 | Autre TVA à déduire (omissions, régularisations, transferts de droits, impayés...) | — | Defer (régularisations) |
| 22 | Report du crédit apparaissant ligne 27 de la déclaration précédente | — | Structure only — needs cross-period state, see §6 |
| 2C | Sommes à imputer (bulletin 3515, acomptes provisionnels) | — | Defer |
| 22A | Coefficient de taxation unique (%, not a monetary line) | — | Defer (secteurs distincts / redevables partiels) |
| **23** | **Total TVA déductible** | sum(19 à 2C) — implemented scope: **23 = 19 + 20** | **Implement (partial)** |
| 24 | Dont TVA déductible sur importations hors produits pétroliers (memo, subset of 23) | — | Defer (imports) |
| 2E | Dont TVA déductible sur produits pétroliers (memo, subset of 23) | — | Defer (produits pétroliers) |

**TVA due ou crédit de TVA** (both boxes exist on the form; exactly one is
populated per period):

| Ligne | Libellé | Arithmetic | Status |
|---|---|---|---|
| 25 | Crédit de TVA | = 23 − 16, **shown only if 23 > 16** | **Implement** |
| TD | TVA due | = 16 − 23, **shown only if 16 ≥ 23** | **Implement** |

**Montant à payer:**

| Ligne | Libellé | Arithmetic | Status |
|---|---|---|---|
| 26 | Remboursement de crédit de TVA demandé (formulaire 3519) | — | Defer (a refund *request* is a separate action, not part of computing the declaration) |
| AA | Crédit de TVA transféré à la société tête de groupe (3310-CA3G) | — | Defer (groupe TVA) |
| **27** | **Crédit de TVA à reporter** | = 25 − 26; **becomes ligne 22 of the *next* declaration** | Structure only, see §6 |
| **28** | **TVA nette due** | = TD − X5 (X5 = crédit d'accise énergie imputé); implemented scope: **28 = TD** (X5 always 0, see below) | **Implement (partial)** |
| 29 | Taxes assimilées (annexe 3310-A) | — | **Defer explicitly** (annexe 3310-A, per your instruction) |
| X1–X4, Y1–Y6, Z1–Z5, M1–M9 | Régularisation d'accise sur les énergies (électricité/gaz/charbon) — **not VAT**, a different tax bundled onto the same form (art. L.312-37-1 du CIBS) | — | **Out of scope entirely**, not a VAT deferral so much as a different tax |
| AB | Total à payer par la société tête de groupe (28+29+Z5) | — | Defer (groupe TVA) |
| **32** | **Total à payer** | = 28 + 29 + Z5 − AB; implemented scope: **32 = 28** | **Implement (partial)** |

### 1c. Explicit flag: T6 (2,1 % France continentale)

You listed 2,1 % as one of the four rates the mapping table should
cover, but on the actual 2026 form, 2,1 % *en France continentale* is
structurally a "taux particulier" line (**T6**), in the same bucket as
DOM/Corse rates — not a peer of 08/09/9B. Notice text: *"Ligne T6 :
Déclarer les opérations réalisées en France continentale imposables au
taux de 2,1 %"* (p. 7 of the notice). 2,1 % is a common rate in practice
(presse, médicaments remboursables) even though it's structurally
grouped with the DOM/Corse "taux particuliers" you asked me to defer.

**Decision needed**: treat T6 as an exception carved out of the "taux
particuliers" deferral (implement it alongside 08/09/9B now), or defer it
with the rest of that bucket until DOM/Corse/taux particuliers are built
together. I have not picked one — the mapping table in §2 shows both.

---

## 2. Account-to-line mapping table

**This is the artifact to confirm before anything else.** Current
company's seeded chart of accounts (`backend/prisma/seed.ts`) has exactly
three VAT-related accounts, all flat — no rate sub-accounts:

| Account (as seeded) | Label | pcgClass |
|---|---|---|
| `445660` | TVA déductible sur autres biens et services | 4 |
| `445662` | TVA déductible sur immobilisations | 4 |
| `445710` | TVA collectée | 4 |

No `44551`/`445510`-style "TVA à décaisser" account and no
"crédit de TVA à reporter" account exist in the seed either — see §2c.

### 2a. Mapping table

| CA3 line | Fed by (PCG account) | Rate | Notes |
|---|---|---|---|
| 19 — Biens constituant des immobilisations (déductible) | `445662` (déductible immo.) | n/a | Notice, p.9: *"les biens constituant des immobilisations sont les biens acquis ou créés, non pour être vendus, mais pour être utilisés d'une manière durable..."* — matches `445662` directly, unambiguous, no rate split needed since 19 is a single total. |
| 20 — Autres biens et services (déductible) | `445660` (déductible autres B&S) | n/a | Same page: *"les autres biens et services sont... les biens qui constituent des valeurs d'exploitation... et... les services"* — matches `445660` directly, unambiguous. |
| 08 — Taux normal 20 % (collectée) | `445710`? | 20 % | **Blocked** — see §3. `445710` is a single flat account; it cannot by itself distinguish a 20 % sale from a 5,5 % one. |
| 09 — Taux réduit 5,5 % (collectée) | `445710`? | 5,5 % | **Blocked** — same account as above. |
| 9B — Taux réduit 10 % (collectée) | `445710`? | 10 % | **Blocked** — same account as above. |
| T6 — 2,1 % continentale (collectée) | `445710`? | 2,1 % | **Blocked** on the rate question like the others — now in scope per decision (§1c), unblocked by `vatRateId`. |
| 16 — Total TVA brute due | sum of whichever of {08,09,9B,[T6]} get unblocked | — | Derived, not separately fed. |
| 23 — Total TVA déductible | `445660` + `445662` | — | Both unambiguous; 23 = 19 + 20 is implementable **today**, independent of the rate question. |
| 25 / TD — Crédit / TVA due | derived from 16 and 23 | — | Arithmetic only, no direct account feed. |
| TVA à décaisser (post-declaration liquidation) | no account exists yet (`44551`-style) | — | See §2c — a *later*, separate concern from `computeDeclaration()`. |
| Crédit de TVA à reporter (post-declaration liquidation) | no account exists yet (`44567`-style) | — | See §2c. |

So: **lines 19, 20, and 23 are fully mappable today.** Lines 08, 09, 9B
(and T6, if in scope) are **not**, for the reason you anticipated —
confirmed against the real seed, not assumed.

### 2b. The rate-tracking question — blocks 08/09/9B/T6, blocks nothing else

Two ways to make `445710` (or whatever collectée account(s)) resolvable
by rate. Neither is implemented; this is the decision computeDeclaration()
is blocked on.

**Option A — rate sub-accounts.** Split `445710` into per-rate PCG
accounts (e.g. `445711` 20 %, `445712` 10 %, `445713` 5,5 %, `445714`
2,1 % if T6 is in scope), the way `445660`/`445662` already split
"déductible" by category. Journal entries pick the right sub-account at
entry time, same as they already pick 19 vs 20.
- Pro: no schema change, fits the existing "account = category" pattern
  used everywhere else in this codebase (à-nouveau, depreciation).
  `AccountCombobox` filtering already works this way.
- Con: rate becomes implicit in which account was picked; if the
  company's rate structure changes (a new reduced rate, a rate change),
  the chart of accounts needs new accounts, not just a new `VatRate` row.
  Doesn't obviously extend to the base-HT-by-rate figures either — see
  the note below.

**Option B — a rate tag on the line.** Add a nullable `vatRateId` (FK to
`VatRate`) on `EcritureLigne`, set at entry time alongside `compteId`.
`445710` stays one flat account; the declaration query groups by
`vatRateId` instead of by account.
- Pro: `VatRate` already exists and already carries `ratePercent` +
  validity dates — this reuses it for its apparent intended purpose
  rather than leaving it as pure metadata. One collectée account, not N.
  Naturally extends to a future by-rate breakdown of the base-HT figures
  too (see below), since the tag lives on the *line*, not the account.
- Con: schema migration touching `EcritureLigne` (a core, heavily-used
  table) and `CreateEcritureLigneDto`; every VAT-relevant journal entry
  now has one more required field to get right, and existing historical
  lines would have no tag (a backfill or "unknown rate" bucket problem
  for anything entered before this ships).

**A related, unprompted-but-adjacent finding**: the same problem exists
one level up. Line 08/09/9B need base HT *and* tax *per rate*, and the
sales accounts that would supply that base HT (`701000`, `706000`,
`707000`, `708000`...) are flat by nature-of-revenue, not by VAT rate,
same as `445710`. Whichever option you pick for the collectée side likely
needs to answer this too, since a single sale posts to *both* a produit
account and `445710` in the same écriture — Option B (tag the line) is
the one that generalizes to both without adding a second parallel
sub-account scheme on the produit side.

**I have not chosen between A and B.** Recommendation, offered not
assumed: B, because it reuses `VatRate` for what looks like its intended
purpose and generalizes to the base-HT problem, at the cost of a real
schema migration — but this is exactly the call you asked to make
yourself.

### 2c. TVA à décaisser / crédit de TVA à reporter

These don't have accounts in the seed at all. That's fine for
`computeDeclaration()` itself — the CA3's "TVA due"/"crédit de TVA"
figures are a computed *report output*, not something read from a
ledger account. Whether/how that output later gets **posted** as a
liquidation écriture (crédit `44551`-style on payment, or booking a
`44567`-style receivable on credit) is a separate, later feature — same
shape as the split this codebase already made between
`DepreciationService.generateSchedule()` (compute) and
`DepreciationService.postDotation()` (post). Not building the posting
half now; flagging that the accounts don't exist yet for when it comes
up.

---

## 3. Rounding and boundary

- **CA3 (France)**: notice p.1, *"LES ARRONDIS FISCAUX — La base
  imposable et le montant de l'impôt sont arrondis à l'euro le plus
  proche. Les bases et cotisations inférieures à 0,50 euro sont
  négligées et celles supérieures ou égales à 0,50 euro sont comptées
  pour 1."* Repeated verbatim at the head of Cadre B (p.6) and again for
  lines 19/20 specifically (p.9): *"La TVA déduite au titre de chacune
  des catégories est arrondie à l'unité la plus proche."* — i.e. every
  monetary box on the form is independently rounded to the nearest euro,
  not just the final total.
- **Monaco**: Ordonnance Souveraine n°13.844 du 6 janvier 1999, Article
  Premier (quoted in the Monaco notice, p.1): *"Les bases des impositions
  de toute nature instituées par Ordonnance Souveraine sont arrondies à
  l'Euro le plus proche. La fraction d'Euro égale à 0,50 est comptée pour
  1."* Also Code des Taxes sur le Chiffre d'Affaires, Article 41 (p.2):
  same rule, applied explicitly to *"l'ensemble des éléments servant à la
  liquidation de la taxe."* **Identical rule to France, independently
  cited on both sides** — genuine convergence, not an assumption.
- **This app**: the ledger (`EcritureLigne.debit`/`credit`,
  `NUMERIC(15,2)`) stays centime-precise, per CLAUDE.md's money-handling
  rule — nothing about VAT changes that. Aggregation for a declaration
  reads centime-precise sums from the ledger via `Money`/`Decimal`
  exactly like `LedgerService.trialBalance()` does today. Rounding to the
  nearest euro happens **only** at the declaration-line boundary — i.e.
  in the DTO/response layer of `computeDeclaration()`, the same way
  `Money.toFecString()` is a boundary-only conversion that never touches
  what's stored. No ledger value is ever rounded; only the reported
  line value is.

---

## 4. Monaco divergence inventory

Read from `specs/Monaco notice TVA.pdf` (2 pages, DSF Monaco, "Notice
pour l'établissement de la déclaration" + extraits du Code des Taxes sur
le Chiffre d'Affaires, Ordonnance Souveraine n°11.887 du 19 février 1996
modifiée). **Caveat up front**: this document is a *notice*
(instructions for filling out a form), not the form itself — I have not
seen Monaco's actual declaration form or its line numbers. Everything
below is scoped to what a 2-page notice can actually tell us; several
areas are marked "not covered" rather than guessed.

| Area | Matches French CA3? | Detail | Source |
|---|---|---|---|
| **Rounding** | **Matches** | Nearest euro, ≥0,50 rounds up, identical wording to the French rule. | Monaco notice p.1 (Ordonnance Souveraine n°13.844) + p.2 Article 41 of the Code des Taxes sur le Chiffre d'Affaires. |
| **Filing frequency** | **Matches** | Monthly by default; quarterly permitted when annual VAT due < €4 000. The French notice states the identical €4 000 threshold for quarterly CA3 filing (p.2 of the French notice: *"exigible annuellement est inférieure à 4 000 € peuvent déposer des déclarations n°3310-CA3 trimestrielles"*). Independently cited on both sides, not assumed. | Monaco notice p.2, Article 70.1–70.2 of the Code des Taxes sur le Chiffre d'Affaires. |
| **Line structure (Cadre B — the actual VAT computation)** | **Not covered by this document** | The notice references "Cadre B : décompte de la TVA à payer" only in passing (to say Cadre C doesn't affect it) — it never shows Cadre B's own line numbers, labels, or rates. I cannot confirm whether Monaco's core computation mirrors the French CA3's lines 08/09/…/28 or differs. **Flag for your professional knowledge**, not resolved here. | Monaco notice p.1, "NB" under Cadre C. |
| **Monaco-specific concept: Cadre C (ventilation de la TVA facturée)** | **Diverges — an addition, not present on the French CA3 at all** | A dedicated section (lignes 70–75) breaking down *deductible* TVA by the supplier's origin: Monaco-established suppliers (ligne 70), France-established suppliers (ligne 71), non-EU imports (ligne 72), post-autoliquidation operations (ligne 73), non-deductible TVA from French suppliers/customs (ligne 74), and TVA on intracommunautaire acquisitions already reported gross at "ligne 35" (ligne 75). Explicitly informational: *"cette ventilation reste sans incidence sur le calcul de la TVA nette."* Its existence implies Monaco's declaration has its own line numbering distinct from the French CA3's (the notice's "ligne 35" doesn't correspond to anything at French CA3 ligne 35), reinforcing the "not covered" row above rather than resolving it. | Monaco notice p.1, "CADRE C" section. |
| **Rates** | **Not covered** | No rate percentages appear anywhere in this notice. Monaco is understood (from the 1963 convention franco-monégasque, per CLAUDE.md) to generally mirror French rates, but this document doesn't state that or list them — I have not verified rates from this source and am not asserting they match. | — (not in source) |
| **Déductible categories** | **Partially covered, structurally different framing** | Cadre C's lignes 70–75 categorize deductible TVA by *supplier origin/operation type* (Monaco supplier / France supplier / import / autoliquidation / non-deductible / AIC), which is a different axis than the French CA3's lignes 19/20 (asset vs. other goods/services). Whether Monaco's Cadre B *also* uses the immobilisations-vs-autres split isn't shown — only the extra Cadre C breakdown is. | Monaco notice p.1. |
| **Filing obligation / accounting register** | Structurally similar, separately codified | Déclaration d'existence within 15 days of starting operations; obligation to keep a numbered, day-by-day register if not otherwise maintaining adequate accounts. Comparable in spirit to French obligations but under Monaco's own Code (Articles 66, A-139 to A-147 of its Annexe), not the CGI. | Monaco notice p.2, Article 66. |
| **Penalties / intérêt de retard** | **Diverges — Monaco has its own regime** | Fixed-euro fines (€15 late filing, up to €150 on formal notice) and a 0,40 %/month late-payment interest plus 10–80 % majorations, all under Monaco's own Code (Articles 105, 106, 110, 111) — not requested in your prompt's dimension list, but present in the source and clearly not the French CGI penalty regime. Noted for completeness; out of scope for `computeDeclaration()` either way. | Monaco notice p.2, Articles 105/106/110/111. |
| **Any Monaco-specific concepts beyond Cadre C** | Not found | The 2-page notice doesn't mention secteurs distincts, coefficient de taxation, or an equivalent to the French "taux particuliers" bucket. Absence here means "not in this document," not "confirmed absent from Monaco's actual rules." | — |

### 4a. What's ambiguous or not covered — for your professional knowledge, not resolved here

- Monaco's actual Cadre B line numbers, labels, and whether its rate
  structure/bucketing matches the French 08/09/9B/T6 split.
- Actual Monaco VAT rates (assumed-but-unverified to mirror France per
  the 1963 convention — CLAUDE.md already flags this; this notice does
  not independently confirm it).
- Whether Monaco's déductible side also splits immobilisations vs. autres
  biens et services the way French lignes 19/20 do.
- Whether a Monaco-established entity's "crédit de TVA" / carry-forward
  mechanic works the same as the French ligne 22/25/27 loop.

### 4b. Two cases to keep structurally distinct

Per your instruction, not implementing either computation now, but
naming the two so the model doesn't conflate them later:

1. **French entity with Monaco activity** — files the *French* CA3, but
   some operations are Monaco-destined. The French CA3 already has a
   home for this: **ligne 18**, *"Dont TVA sur opérations à destination
   de Monaco"* — a memo sub-line of ligne 16 (doesn't change the
   arithmetic, per notice p.9: *"la taxe correspondant aux opérations
   imposables réalisées à destination de Monaco, c'est-à-dire la taxe qui
   devrait être acquittée à Monaco si les opérations... étaient déclarées
   dans chacun des deux États"*). Notice also flags an exclusion:
   *"Les entrepreneurs de travaux immobiliers et les établissements
   bancaires ne sont pas concernés par cette mesure."* Ligne 18 exists in
   §1b's line spec (structure only, not computed).
2. **Monaco-established entity** — files with Monaco's DSF on the
   Monegasque form (whatever that form actually is — not in hand). A
   separate, later Monaco computation pass, not a variant of the French
   one.

`Company.jurisdiction` (`FR` | `MC`) is the selector between these two
declaration *types* going forward; only the FR path gets a computation in
this project's next VAT pass. Case 1 above still runs the FR path (it's
a French filer), just with ligne 18 populated once that's built.

### 4c. Régime scope note

Everything above is **CA3 (régime du réel normal - mini réel)**, per the
form's own header. **Réel simplifié (CA12)** is a different form (annual
declaration with acomptes) and is not addressed here or planned in this
pass — noting it so it isn't assumed covered.

---

## 5. Open decisions for your confirmation

1. **Rate tracking** (§2b) — rate sub-accounts vs. a `VatRate` tag on
   `EcritureLigne`. Blocks lines 08/09/9B/T6 and, by extension, 16/25/TD/28
   for any period where those rates were actually used.
2. **T6 (2,1 % continentale)** (§1c) — implement now alongside 08/09/9B,
   or defer with the rest of "taux particuliers"?
3. Anything in §4a you can resolve from professional knowledge that I
   should fold in before the Monaco pass — flagged, not guessed.

Nothing downstream of these has been built. `computeDeclaration()` is
unchanged.
