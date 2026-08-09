# VAT / Monaco declaration — Implementation Spec (Draft for Review)

**Status: spec + divergence analysis only. `computeMonacoDeclaration()` is
not built.** This is Case B (below) — a Monaco-established entity filing
its own declaration. Case A (a French entity with Monaco activity, filing
the French CA3 with ligne 18 populated) is already handled and untouched.

## 0. Case A vs. Case B — do not conflate

- **Case A** — a French-established entity that also has Monaco activity.
  Files the **French CA3**. Ligne 18, *"Dont TVA sur opérations à
  destination de Monaco"*, is the home for this — a memo sub-line of
  ligne 16, already implemented (structure only; not computed, per the
  earlier CA3 pass). Nothing in this document changes that.
- **Case B** — a Monaco-established entity. Files its **own** declaration
  with Monaco's Direction des Services Fiscaux (DSF), on the form
  described below. `Company.jurisdiction === 'MC'` selects this path.
  **This document is entirely about Case B.**

## 1. Sources

- `specs/Blank VAT form MONACO.pdf` — the actual declaration, 2 pages.
  Read by rendering both pages as images (`pdftotext` extracts text, but
  the rate-line region needed visual confirmation — see §1a) — not by
  linear text extraction alone.
- `specs/Monaco notice TVA.pdf` — the notice, 2 pages, scanned (no text
  layer), read via page-image rendering. Narrower in scope than the form
  — see §0 note above and §3.

### 1a. A concrete example of why visual confirmation mattered

`pdftotext` linearized three separate rows as if they shared one line
number:

```
32 Taux réduit            5,50 %
32 Taux intermédiaire 10,00 %
32 Taux normal            20,00 %
```

That looked like a possible extraction artifact — it wasn't. Rendering
the actual page confirms it: **Monaco genuinely prints "32" next to all
three standard-rate rows**, distinguished only by the rate name, not by a
distinct line number the way France gives 08/09/9B their own codes. This
is reported as-is, not "corrected" to match the French pattern.

## 2. Monaco line spec (from the form, quoted)

### Cadre A — Montant des opérations réalisées

| Ligne | Libellé (verbatim) |
|---|---|
| 01 | Ventes, prestations de services |
| 03 | Achats de prestations de services intracommunautaires |
| 04 | Acquisitions intracommunautaires |
| 05 | Achats de prestations de services hors Union Européenne |
| 06 | Livraisons à soi-même |
| 07 | Achats de biens ou de prestations de services réalisés auprès d'un assujetti non établi en France ou à Monaco |
| 08 | Cessions d'immobilisations |
| 09 | Autres opérations imposables |
| 09b | Importations autoliquidées |
| **A1** | **Total imposable** |
| 10 | Exportations hors Union Européenne |
| 11 | Livraisons intracommunautaires |
| 12 | Autres opérations non imposables |
| 13 | Négoce international |
| 14 | Ventes de biens ou de prestations de services réalisées par un assujetti non établi à Monaco |
| **A2** | **Total non imposable** |
| **15** | **Chiffre d'affaires (total lignes 01 + A2)** |
| 16 | Dont CA réalisé avec la France |
| 17 | Travaux immobiliers réalisés en France |

**Flag, not silently normalized**: ligne 15's own printed formula is
*"total lignes 01 + A2"* — not `A1 + A2`. That excludes lines 03, 04, 05,
06, 07, 08, 09, 09b from "chiffre d'affaires" even though they're part of
`A1` ("Total imposable"). Quoted exactly as printed; not resolved into
what I'd expect from the French form's pattern.

### Cadre B — Décompte de la TVA à payer

**TVA brute** (columns: *Base hors taxe* / *Taxe due*):

| Ligne | Libellé (verbatim) | Rate |
|---|---|---|
| 30 | Taux particuliers | blank on the source (unfilled %) |
| 31 | Anciens taux | — |
| 32 | Taux réduit | 5,50 % |
| 32 | Taux intermédiaire | 10,00 % |
| 32 | Taux normal | 20,00 % |
| 34 | TVA antérieurement déduite à reverser | — |
| **B1** | **Total (ligne 30 à 34)** | — |
| 35 | Dont TVA sur acquisitions intracommunautaires de biens | — |
| 36 | Dont TVA sur opérations à destination de la France | — |
| 37 | Dont TVA sur importations bénéficiant du dispositif d'autoliquidation | — |

**TVA déductible:**

| Ligne | Libellé (verbatim) |
|---|---|
| 40 | Indiquer ici le pourcentage de déduction applicable pour la période s'il est différent de 100 % |
| 20 | Report du crédit apparaissant à la ligne 29 de la précédente déclaration |
| 22 | TVA déductible dont la mention a été omise sur les déclarations précédentes |
| 23 | Complément de TVA à déduire, avis n° |
| 24 | Transfert de droits à déduction reçus d'autres entreprises, dossiers n° |
| **44** | **Biens constituant des immobilisations** |
| **45** | **Autres biens et services** |
| **B2** | **Total (lignes 20+22+23+24+44+45)** |

**Crédit / Taxe à payer:**

| Ligne | Libellé (verbatim) | Arithmetic |
|---|---|---|
| B3 | Crédit de TVA | = B2 − B1 |
| 48 | TVA nette due | = B1 − B2 |
| 27 | TVA déductible transférée à d'autres entreprises, dossiers n° | — |
| 49 | Taxes assimilées TMP (imprimé à joindre), Base HT | — (TMP undefined by either source, see §5) |
| 28 | Remboursement demandé sur formulaire à joindre à la présente | — |
| 52 | Acomptes provisionnels | — |
| **29** | **Crédit à reporter (lignes B3, 27 et 28)** — *"Cette somme est à reporter ligne 20 de la prochaine déclaration"* | = B3 − 27 − 28 (printed order; not independently re-derived) |
| 53 | Compléments à verser (avis n°) | — |
| **60** | **Total à payer** | = 48 + 49 − 52 + 53 |

### Cadre C — Ventilation de la TVA facturée à l'entreprise

Confirmed identical between the form and the notice (the notice explains
this cadre in detail, uniquely among all cadres — see §3):

| Ligne | Libellé (verbatim, form) |
|---|---|
| 70 | TVA déduite afférente à des factures émises par des entreprises monégasques |
| 71 | TVA déduite afférente à des factures émises par des entreprises françaises |
| 72 | TVA déduite sur importations et acquittée en douane |
| 73 | TVA déduite après autoliquidation sur importations et autres opérations |
| 74 | TVA non déductible ou non déduite |
| 75 | TVA déduite sur acquisitions intracommunautaires de biens |

Per the notice, ligne 73 specifically recaps déduction from lines 03, 05,
06, 07, 09 (*"La ligne 73 recense, en définitive, la T.V.A. déduite sur
les opérations déclarées aux lignes 03, 05, 06, 07 et 09"*), and per the
form's own NB: *"cette ventilation reste sans incidence sur le calcul de
la TVA nette"* — informational only, doesn't feed B1/B2/B3/48, same as
already understood.

## 3. What the notice does NOT cover

Everything above outside Cadre C comes from the **form's own printed
labels only**. The notice — 2 pages, explicitly *"Extraits du Code des
Taxes sur le Chiffre d'Affaires"* — never explains: ligne 01/08/09
composition, the 30/31 "taux particuliers"/"anciens taux" buckets, what
"TMP" (ligne 49) is or how it's computed, "acomptes provisionnels"
(ligne 52), the B3/48/29 formulas beyond what's printed on the form
itself, or the "15 = 01 + A2" oddity. This is a materially thinner
source than the French 3310-NOT-CA3-SD, which explained nearly every
line — flagged per your instruction rather than papered over.

## 4. Divergence table

Three buckets, per your instruction: **(a) confirmed same** — verbatim
quote from a Monaco source; **(b) confirmed different** — the specific
difference, quoted; **(c) can't tell** — flagged for you, not resolved
by assuming convention parity.

### (a) Confirmed same

| Area | Monaco source (verbatim) | Note |
|---|---|---|
| Rounding | Form: *"L'arrondissement des bases et des cotisations s'effectue à l'euro le plus proche."* Notice (Ord. Souv. n°13.844, Art. Premier): *"...arrondies à l'Euro le plus proche. La fraction d'Euro égale à 0,50 est comptée pour 1."* | Identical wording/rule to France, now confirmed on **both** the form itself and the notice — stronger than the earlier notice-only finding. |
| Déductible split *(labels, not line numbers)* | Ligne 44: *"Biens constituant des immobilisations"*. Ligne 45: *"Autres biens et services"*. | Word-for-word identical to France's ligne 19 / ligne 20 labels. Line **numbers** differ (44/45 vs. 19/20) — see bucket (b). |
| Standard rate percentages | *"32 Taux réduit 5,50 %"*, *"32 Taux intermédiaire 10,00 %"*, *"32 Taux normal 20,00 %"* | Percentages match France's 09/9B/08 exactly. Naming differs ("intermédiaire" vs. "réduit" for the 10 % tier) — a labeling nuance inside an otherwise-matching bucket. |
| Crédit/due direction | *"B3 Crédit de TVA (B2 - B1)"*; *"48 TVA nette due (lignes B1 - B2)"* | Same subtraction direction as France's ligne25=(23−16)/TD=(16−23): déductible-minus-collectée for credit, collectée-minus-déductible for due. Line codes differ. |
| Credit carry-forward loop | Ligne 29: *"Crédit à reporter (lignes B3, 27 et 28)... Cette somme est à reporter ligne 20 de la prochaine déclaration."* | Same cross-period mechanic as France's ligne27→ligne22. Line codes differ (29→20 vs. 27→22). |

### (b) Confirmed different

| Area | Specific difference | Source |
|---|---|---|
| Line numbering scheme | Entirely different from France — no overlap at all (Monaco: 01/03–09b/A1/10–17/A2/15/30–37/B1/20/22–24/44/45/B2/B3/48/27–29/49/52/53/60/70–75; France: 08/09/9B/T6/16/17/18/19/20/21/22/2C/23/24/2E/25/TD/26/27/28/29/32). | Direct read of the rendered form vs. the CA3 form, both confirmed by rendering. |
| Rate-line grouping | All three standard rates share the printed code "32" (three rows); France gives each its own code (08/09/9B). | Rendered form, §1a. |
| 2,1 % as a named rate | No dedicated, pre-printed 2,1 % line the way France names T6 — Monaco declares it through ligne 30 *"Taux particuliers ___%"*, a blank fillable field, instead of a named sub-line. **Resolved, see §6**: this is a declaration-mechanism difference (named line vs. generic field), not evidence the rate doesn't exist for Monaco. | Ligne 30's generic/fillable nature confirmed by rendering the page. |
| Accise sur les énergies | Absent entirely from the Monaco form — no X/Y/Z/M-series régularisation section exists. | Confirmed absent across both rendered pages. |
| "49 Taxes assimilées TMP" | A Monaco-specific assimilated tax with its own Base HT column, folded into ligne 60's total-à-payer formula. Not the same mechanism as France's ligne 29 (annexe 3310-A) — nothing ties TMP to that annexe. | Form, ligne 49. Meaning of "TMP" itself is bucket (c). |
| Cadre A composition | Monaco gives "Cessions d'immobilisations" its own numbered line (08) inside the taxable side; France folds the equivalent into ligne A2 ("opérations taxables particulières") without a distinct number. Also, Monaco's ligne 15 "chiffre d'affaires" total is narrower than "A1 Total imposable" (see §2 flag) — no French equivalent has this specific two-tier total structure. | Form, Cadre A. |

### (c) Can't tell from these documents — flagged for you, not assumed

| Area | What's unresolved |
|---|---|
| **Filing frequency — an actual conflict, not just a gap.** | The notice's Article 70.1 states filing is monthly, or quarterly if annual VAT due < €4 000 — no annual option mentioned. But the example form's own period field reads *"Période de Déclaration: AN - 2023"* — most plausibly "Année 2023" (annual). Either "AN" means something other than annual, or an annual regime exists under a part of the Code des Taxes sur le Chiffre d'Affaires not included in the notice's excerpt (itself labeled *"Extraits"*, i.e. partial). **This directly contradicts the "monthly/quarterly, matches France" convergence already recorded in CLAUDE.md from the notice-only pass** — that entry needs revisiting once this is resolved, not left standing unchallenged. |
| What "31 Anciens taux" actually contains | No taxonomy shown, unlike France's explicit T1–T7/13/P1–P2/I1–I6 breakdown. Genuinely unresolved — deferred, not implemented. Ligne 30 itself is resolved, see §6. |
| PCG account numbers Monaco's declaration reads | **Not answerable from a tax form at all** — a DSF form has no reason to reference a filer's internal chart-of-accounts numbering, and neither document does. What's confirmed is the *label* match (§4a). Whether this app would reuse `445662`/`445660`/`445710` for a Monaco-jurisdiction company, or needs Monaco-specific account rows, is an implementation decision informed by — but not dictated by — that label match. CLAUDE.md already flags "Monaco commonly applies a PCG-aligned chart" as convention-based and not independently cited; this pass doesn't upgrade that. |
| Whether déductible lines (44/45) need rate-tracking | Cadre B's "TVA brute" section structurally requires Base HT + Taxe due per rate (lines 30–32), same shape as France's collectée side. Nothing confirms whether 44/45 need a rate split (France's 19/20 don't either) — presumed no, by absence of contrary evidence, not by a source statement. |
| "TMP" (ligne 49) | Undefined in both documents — full name and computation basis unknown. |
| "Acomptes provisionnels" (ligne 52) | Referenced but not explained by either source. |
| "Régime" code "FB", "SP"/"Insp." fields | Administrative/internal DSF codes on the identification block, not explained — likely not declaration-substance-relevant, but unconfirmed. |

## 5. Account-to-line mapping for Monaco

**Cannot be confirmed from these two documents**, and said plainly rather
than defaulted to "same as France": a tax authority's declaration form
does not — and structurally cannot — reference a taxpayer's internal PCG
account numbering. Both Monaco documents are silent on this by nature,
not by omission.

What *is* confirmed: ligne 44/45's **labels** are verbatim identical to
France's ligne 19/20. If (and only if) a given Monaco-jurisdiction
company in this app uses the same PCG-aligned chart this app already
assumes for Monaco (per CLAUDE.md's existing, still-unverified-from-a-
cited-source convention note), then reusing `445662`/`445660` for its
déductible lines, and a `4457x`-prefixed account for collectée, would be
consistent with that label match — but that's an inference about *this
app's* modeling choice, not a fact the Monaco source documents state.
Flagging it as such rather than writing it into `CLAUDE.md` as
"confirmed."

## 6. Rates — quoted, not assumed

Confirmed directly from the form (§2, §4a): **5,50 %, 10,00 %, 20,00 %**
— exact match to France's three main rates, read from Monaco's own
document, not inferred from "the convention probably keeps them
aligned."

**2,1 % — corrected.** An earlier pass of this document classified 2,1 %
as bucket (c) "can't tell," reasoning that the absence of a pre-printed
2,1 % line (the way France names T6) meant its existence was
unconfirmed. That reasoning was wrong: it mistook *how* a rate is
declared for *whether* it exists. Re-reading the form, ligne 30 reads
*"Taux particuliers ___%"* — a blank, fillable percentage field, the
generic slot for whatever non-standard rate applies. This is Monaco's
mechanism for a taux particulier: one blank field instead of France's
several named sub-lines (T1, T6, ...), not evidence the rate is absent.
Combined with the confirmed convention (CLAUDE.md "Monaco compliance":
VAT largely mirrors French rates under the 1963 Franco-Monégasque tax
convention) and the user's direct domain confirmation that Monaco's rate
set includes 2,1 % (presse, médicaments, same as France), **2,1 % is
implemented, declared via ligne 30**. This moves 2,1 % out of bucket (c)
and into a corrected reading of bucket (b) above (§4b): a real
mechanism difference (generic field vs. named line), not an unresolved
unknown. Implemented in `computeMonacoDeclaration()` as a fourth
`ImplementedRate` tagged `ligne: '30'`, alongside the three `ligne: '32'`
rows — see the doc comment on `IMPLEMENTED_RATES` in
`backend/src/modules/vat/monaco-declaration.ts` for the same correction
recorded in code.

Ligne 31 ("Anciens taux") remains genuinely unresolved — no taxonomy is
shown for what it contains — and stays deferred, unaffected by this
correction.

## 7. Open items before `computeMonacoDeclaration()` can start

All of §4c, plus:

1. Resolve the filing-frequency conflict (monthly/quarterly per the
   notice vs. the "AN" annual-looking period code on the actual form).
2. Decide the PCG-account-reuse question in §5 — a real design decision
   for this app, not something the Monaco documents can settle.
3. ~~Determine whether 2,1 % is a real Monaco rate and if so how it's
   declared~~ — resolved, see §6: implemented via ligne 30.
4. `computeMonacoDeclaration()` is now built (§6, and account scheme
   approved separately) — this document remains the line spec,
   divergence table, and account-mapping analysis of record; keep it in
   sync with the implementation rather than treating it as frozen.
