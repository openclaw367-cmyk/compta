# Liasse fiscale — 2056, 2057, 2059 implementation notes

Companion to `specs/liasse-2050-implementation-spec.md` and
`specs/liasse-2054-2055-implementation-spec.md`, same discipline: built
against the actual forms in `specs/2050-liasse_5320.pdf` (a bundled
2050-series PDF; `specs/2050-liasse_5320.txt` is its `pdftotext -layout`
extraction) and the PCG account nomenclature in
`specs/Reglt 2014-03_Plan comptable general.pdf`
(`specs/pcg-reglt.txt`), never from memory. 2058-A/2058-B (résultat
fiscal) are explicitly out of scope — judgment-heavy, a separate pass.

## §1 — Status

- **2056 (Provisions inscrites au bilan): built.** See §2.
- **2057 (État des échéances des créances et des dettes): NOT built —
  stopped.** See §3. Cadre A and Cadre B both require a maturity
  (échéance) split this app's data model cannot produce.
- **2059-A (Détermination des plus et moins-values): built, but
  structurally empty.** See §4. Every row depends on cession data that
  doesn't exist yet (see CLAUDE.md "Known scope boundaries" —
  `FixedAsset.cessionDate`/`cessionPrice` always null).

## §2 — 2056 (Provisions inscrites au bilan)

Form quoted at `specs/2050-liasse_5320.txt:651-737`. A movement table
(`Montant au début de l'exercice` / `Dotations` / `Reprises` / `Montant
à la fin de l'exercice`) across three sections: TOTAL I (provisions
réglementées, comptes 142-148), TOTAL II (provisions pour risques et
charges, comptes 151/153-158), TOTAL III (provisions pour dépréciation,
comptes 29x/39x/49x/59x).

### Sourcing — no dedicated domain model

Unlike 2054/2055 (`FixedAsset`/`DepreciationEntry`), there is no
`Provision` domain model. "Début"/"dotations"/"reprises" are derived
directly from the ledger by journal: à-nouveau posts each account's
opening balance into the fiscal year's own ledger
(`a-nouveau.service.ts`), so a ligne whose écriture's journal has type
`A_NOUVEAU` IS that account's "début" for the year; every other ligne is
in-year movement — credit lines are dotations, debit lines are reprises,
kept separate (never netted the way a plain trial balance would).
Implemented in `liasse.service.ts` (extends the existing
`ecritureLigne.findMany` query with `ecriture.journal.type`, filters to
`PROVISION_ACCOUNT_CLASS_PREFIXES`) and `tableau-2056.ts`
(`computeTableau2056`, pure function).

### Account mapping — `provision-categories.ts`

Longest-prefix-match, same technique as `immobilisation-categories.ts`.
Every prefix confirmed against the PCG regulation text (classes 14/15
around p.129, class 29 p.128-129, classes 39/49/59's own sections —
grepped, not recalled). Full table in the module itself; summary:

- TOTAL I: 1423 (reconstitution gisements), 1424 (investissement), 143
  (hausse des prix — 1431 AND 1432, one CERFA row for both), 145
  (amortissements dérogatoires), catch-all 144/146/147/148 (autres).
- TOTAL II: 1511 (litiges), 1512 (garanties clients), 1514 (amendes),
  1515 (pertes de change), 153 (pensions), 155 (impôts), 156
  (renouvellement immobilisations), 1572 (gros entretien), catch-all
  bare-151/154/157/158 (autres).
- TOTAL III: 290+2932 (incorporelles), 291+292+2931 (corporelles), 296
  (titres de participations), 297 (autres immo financières), bare-39
  (stocks et en cours), 491 (comptes clients), catch-all 49(non-491)/59
  (autres).

**Two documented "fold into autres" decisions**, not guesses: the CERFA
form names "provisions pour prêts d'installation (art. 39 quinquies H
du CGI)" and "provisions pour charges sociales et fiscales sur congés à
payer" as their own rows, but the PCG 2014-03 nomenclature has **no
account number for either** — confirmed absent by grepping the full
regulation text (`installation`, `congés`), not merely unseeded in this
app's chart. Both route to their family's documented "autres" bucket
(148 / 158 respectively) if a company ever needs them — same discipline
as 2054's bare-213→"sur sol propre" default.

**One structurally-empty line, not a gap**: "titres mis en équivalence"
has no account mapping at all. Mise en équivalence is a
consolidation-level valuation method; this app implements individual
(non-consolidated) accounts only, so the line is always 0,00 by
construction, not because of a missing mapping.

### Deferred, not guessed

The "Dont dotations et reprises : d'exploitation / financières /
exceptionnelles" memo split (form's UE-UK) is **not computed** —
`Tableau2056.dontDotationsReprisesParNature` is always `null`. Answering
it requires knowing each movement's COUNTERPART account (was the
matching 681x/781x debit/credit exploitation, 686x/786x financière, or
687x/787x exceptionnelle?), which means grouping by écriture, not
aggregating flat ligne totals the way the rest of the liasse engine
does — a different query shape, deferred rather than faked.

### Articulation

No clean bilan subtotal exists to tie to (the bilan's "amortissements"
column mixes 28x amortissement with 29x dépréciation per asset line —
e.g. AO combines 2811+2911 — so there's no isolated "provisions/
dépréciations only" figure on the bilan to compare against). Instead,
`assertTableau2056TiesToBilan` (`liasse-articulation.ts`) compares two
INDEPENDENT derivations of the same number: 2056's own TOTAL GÉNÉRAL
(built via nature-line classification) against a flat sum of the same
accounts' closing balances straight off the trial balance, by prefix
only, no classification logic at all. A double-counted or dropped
account would make these disagree — same spirit as
`assertVncTiesToLedger`.

### Verified

Hand-computed oracle (`tableau-2056-oracle-fixture.ts`,
`tableau-2056.spec.ts`, `provision-categories.spec.ts`,
`liasse-articulation.spec.ts`): a fresh provision (dotation + partial
reprise) and a fresh dépréciation (dotation only), plus an AN-vs-non-AN
split test and negative-fin/unmapped-account guard tests.
`liasse.service.spec.ts` wires it end to end through the mocked Prisma
layer (journal-type-aware query). Also posted live, as real écritures,
into the "Société Test Multi-Année" fixture company (see CLAUDE.md's
"Test fixtures" section) and verified via a direct `POST
/liasse/generate` call against the real dev DB.

## §3 — 2057 (État des échéances des créances et des dettes) — STOPPED

Form quoted at `specs/2050-liasse_5320.txt:738-829`. Cadre A (état des
créances) prints three columns: `MONTANT BRUT`, `À 1 AN AU PLUS`, `À
PLUS D'UN AN`. Cadre B (état des dettes) is a finer three-way split:
`Montant brut`, `à 1 an au plus`, `à plus d'1 an et 5 ans au plus`, `à
plus de 5 ans` — plus, for emprunts auprès des établissements de crédit
specifically, an ORIGIN-based split (`1 an maximum à l'origine` / `à
plus d'1 an à l'origine`) rather than remaining-maturity-based.

**This requires a maturity/échéance date per ledger line or per
debt/receivable. Confirmed absent**: grepped `schema.prisma`'s
`EcritureLigne` model for `dateEcheance`/`echeance`/`maturity`/`dueDate`
— none exist. `PieceDate`/`EcritureDate` are posting dates, not due
dates. There is no way to derive "due within 1 year" vs "due beyond"
from what's in the ledger today, and guessing a split (e.g. assuming
all fournisseurs/clients are ≤1 year, all emprunts are >1 year) would
be exactly the kind of silent fabrication this codebase's "throw rather
than guess" rule exists to prevent.

Per the explicit guardrail for this batch, **stopped rather than
building a "brut-only" table or a guessed split** — this is the user's
call: either (a) skip 2057 entirely for now, (b) add a real maturity
field to the data model (a genuine feature, not a mapping exercise) and
revisit, or (c) build only the `MONTANT BRUT` totals per nature line
with the maturity columns explicitly marked N/A-pending-maturity-
tracking (mirroring how 2054/2055 marked cessions/reprises N/A). No
code has been written for 2057 in this pass.

## §4 — 2059-A (Détermination des plus et moins-values)

Form quoted at `specs/2050-liasse_5320.txt:1119-1217`. Cadre A
("Détermination de la valeur résiduelle") and Cadre B ("Plus-values,
moins-values") are both per-disposal line-item tables: nature/date
d'acquisition, valeur d'origine, valeur nette réévaluée, amortissements,
valeur résiduelle, prix de vente, plus-value/moins-value, qualification
fiscale (court terme / long terme / taxable à 19%).

**Every row and column depends on cession data.** Per CLAUDE.md's
"Known scope boundaries", `FixedAsset.cessionDate`/`cessionPrice` exist
in the schema but are always null — no cession logic exists yet (no
plus/moins-value computation, no disposal posting flow). This means
2059-A isn't "partially computable with some columns N/A" the way
2054/2055 were (those had real début/acquisitions/dotations movement to
show even with cessions at 0,00) — literally the entire table has
nothing to report, by construction, today.

### What's built

`tableau-2059.ts`'s `computeTableau2059A(assets)` returns an explicit
N/A-shaped result: empty Cadre A/Cadre B row lists, `cadreA`/`cadreB`
totals `'0.00'`, and a `note` field stating cessions aren't supported
yet. It is **not** a no-op — it asserts (`ConflictException`) if it
ever finds a `FixedAsset` with a non-null `cessionDate` within the
reported fiscal year, rather than silently continuing to report an
empty table that would then be wrong. Adding real cession support later
must touch this guard (and build the actual court-terme/long-terme
qualification logic — genuinely judgment-heavy CGI tax rules, out of
scope here) before the guard can be relaxed.

### Articulation

`assertTableau2059TiesToCompteResultat` (`liasse-articulation.ts`)
compares 2059-A's CADRE A + CADRE B totals (always 0,00 given the guard
above) against the compte de résultat's own cession-related lines (F1 +
G2 + HD produits de cessions, minus G1 + G3 + HH charges de cessions —
see CLAUDE.md's "775/675 splits across three different compte-de-
résultat sections" for why those particular codes). Today this is a
trivial 0,00 = 0,00, but it's a REAL check: it would immediately catch
the day someone posts a manual 775/675 cession écriture without going
through (not-yet-built) proper cession support, or vice versa — the
same "orphaned" class of bug the 2054/2055 tie-out caught for
immobilisations.

### Verified

`tableau-2059.spec.ts` covers: no cessions → empty N/A table; a
`FixedAsset` with a non-null `cessionDate` in the reported year → throws
rather than silently omitting it. `liasse-articulation.spec.ts` covers
the tie-out passing at 0,00=0,00 and throwing on an injected mismatch
(a stray produits-de-cession balance with no matching 2059-A entry).
