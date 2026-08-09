# Liasse fiscale — régime réel normal (2050-series), line spec + mapping

**Status: review artifact. No computation built yet — this is the line
spec, account mapping, articulation rules, and engine shape for review,
per instruction. Nothing in `src/modules/liasse/` has been touched.**

Scope of this pass: the two foundational forms only — **bilan (2050
Actif / 2051 Passif)** and **compte de résultat (2052 / 2053)**. The
2033-series (régime réel simplifié) mapping, and the rest of the 2050
bundle (2054 immobilisations, 2055 amortissements, 2056 provisions,
2057 échéances, 2058-A/B/C résultat fiscal, 2059-A..G plus/moins-values
& divers), are explicitly deferred — see §7.

## 1. What's in `specs/` — confirmed by opening the files, not assumed

| File | What it actually is | Pages |
|---|---|---|
| `specs/2050-liasse_5320.pdf` | The full **régime réel normal liasse bundle**, cerfa forms **2050-SD through 2059-G-SD**, tax year 2026 (title block reads "DGFiP N° 2050-SD 2026", etc. for each form). Confirmed by rendering pages 1–19 and reading the per-page title blocks. **2050, 2051, 2052, 2053 are all present** (pages 1–4) — this pass has what it needs. | 19 |
| `specs/2033-sd_5394.pdf` | The full **régime réel simplifié liasse bundle**, cerfa forms **2033-A-SD through 2033-G-SD**, tax year 2026. Confirmed the same way. Present for later — **not opened for mapping purposes in this pass**, per instruction (2033 is a deliberate second pass). | ~8 |

**Missing, and it matters**: neither document includes the explanatory
notices they both repeatedly point to — **`2032-NOT-SD`** (referenced
by every asterisked rubric on 2050/2051/2052/2053) and **`2033-NOT-SD`**
(same role for the 2033 bundle) are **not in `specs/`**. Every place
below where the form text alone doesn't resolve a question, that's the
notice that would normally answer it. Flagged per-line below rather
than guessed. The `1330-CVAE-SD` notice (CVAE) is also referenced and
also absent, but CVAE is out of scope for this pass entirely.

Everything below was read from the **rendered form images**
(`pdftotext -layout` mangles this form's multi-column Brut/Amortissements/
Net and France/Export/Total layouts — confirmed by rendering pages to
PNG and reading them directly, same method as the Monaco VAT pass),
never inferred from memory of what a "typical" liasse looks like.

## 2. Line spec

### 2050-SD — BILAN ACTIF

Three value columns per line: **Brut** (code), **Amortissements,
provisions** (code), **Net** (no code — computed as Brut minus
Amortissements, not itself transmitted; confirmed by zooming into the
form: every Net-column cell, including the Net cell on TOTAL GÉNÉRAL, is
blank of a code).

| Section | Label | Brut | Amort. |
|---|---|---|---|
| — | Capital souscrit non appelé — **TOTAL (I)** | AA | *(n/a, shaded)* |
| Immobilisations incorporelles | Frais d'établissement * | AB | AC |
| | Frais de développement * | CX | CQ |
| | Concessions, brevets et droits similaires | AF | AG |
| | Fonds commercial | AH | AI |
| | Autres immobilisations incorporelles | AJ | AK |
| | Immobilisations incorporelles en cours, avances et acomptes | AL | AM |
| Immobilisations corporelles | Terrains | AN | AO |
| | Constructions | AP | AQ |
| | Installations techniques, matériel et outillage industriels | AR | AS |
| | Autres immobilisations corporelles | AT | AU |
| | Immobilisations corporelles en cours, avances et acomptes | AV | AW |
| Immobilisations financières (2) | Participations | CS | CT |
| | Titres immobilisés de l'activité de portefeuille | CU | CV |
| | Créances rattachées à des participations | BB | BC |
| | Autres titres immobilisés | BD | BE |
| | Prêts | BF | BG |
| | Autres immobilisations financières * | BH | BI |
| — | **TOTAL (II)** | BJ | BK |
| Stocks * | Matières premières, approvisionnements | BL | BM |
| | En cours de production de biens | BN | BO |
| | En cours de production de services | BP | BQ |
| | Produits intermédiaires et finis | BR | BS |
| | Marchandises | BT | BU |
| Créances / Divers | Avances et acomptes versés sur commandes | BV | BW |
| | Clients et comptes rattachés (3) * | BX | BY |
| | Autres créances (3) | BZ | CA |
| | Capital souscrit et appelé, non versé | CB | CC |
| | Valeurs mobilières de placement | CD | CE |
| | Disponibilités | CF | CG |
| Comptes de régularisation | Charges constatées d'avance (3) * | CH | CI |
| — | **TOTAL (III)** | CJ | CK |
| — | Frais d'émission d'emprunt (IV) | CW | *(n/a, shaded)* |
| — | Primes de remboursement des emprunts (V) | CM | *(n/a, shaded)* |
| — | Écarts de conversion actif et différences d'évaluation * (VI) | CN | *(n/a, shaded)* |
| — | **TOTAL GÉNÉRAL (I à VI)** | CO | 1A |

Memo (not part of the additive total): **CP** "(2) Part à moins d'1 an
des immobilisations financières nettes"; **CR** "(3) Part à plus d'1 an"
(applies to the two `*(3)`-marked créances lines above).

### 2051-SD — BILAN PASSIF avant répartition

Single value column ("Exercice N" — no prior-year column on this
render, no Brut/Amort split: passif items are already net).

| Section | Label | Code |
|---|---|---|
| Capitaux propres | Capital social ou individuel (1) * | DA |
| | Primes d'émission, de fusion, d'apport… | DB |
| | Écarts de réévaluation (2) * *(dont écart d'équivalence: **EK**)* | DC |
| | Réserve légale (3) | DD |
| | Réserves statutaires ou contractuelles | DE |
| | Réserves réglementées (3) * *(dont réserve spéciale des provisions pour fluctuation des cours: **B1**)* | DF |
| | Autres réserves *(dont réserve relative à l'achat d'œuvres originales d'artistes vivants *: **EJ**)* | DG |
| | Report à nouveau | DH |
| | **RÉSULTAT DE L'EXERCICE (bénéfice ou perte)** | DI |
| | Subventions d'investissement | DJ |
| | Provisions réglementées * | DK |
| | **TOTAL (I)** | DL |
| Autres fonds propres | Produit des émissions de titres participatifs | DM |
| | Avances conditionnées | DN |
| | **TOTAL (II)** | DO |
| Provisions pour risques et charges | Provisions pour risques | DP |
| | Provisions pour charges | DQ |
| | **TOTAL (III)** | DR |
| Dettes (4) | Emprunts obligataires convertibles | DS |
| | Autres emprunts obligataires | DT |
| | Emprunts et dettes auprès des établissements de crédit (5) | DU |
| | Emprunts et dettes financières divers *(dont emprunts participatifs: **EI**)* | DV |
| | Instruments financiers à terme | D1 |
| | Avances et acomptes reçus sur commandes en cours | DW |
| | Dettes fournisseurs et comptes rattachés | DX |
| | Dettes fiscales et sociales | DY |
| | Dettes sur immobilisations et comptes rattachés | DZ |
| | Autres dettes | EA |
| Compte de régul. | Produits constatés d'avance (4) | EB |
| | **TOTAL (IV)** | EC |
| — | Écart de conversion passif * et différences d'évaluation — **TOTAL (V)** | ED |
| — | **TOTAL GÉNÉRAL (I à V)** | EE |

Renvois (memo, not additive): **1B** "(1) Écart de réévaluation
incorporé au capital"; **1C/1D/1E** "(2) dont: réserve spéciale de
réévaluation (1959) / écart de réévaluation libre / réserve de
réévaluation (1976)"; **EF** "(3) dont réserve spéciale des plus-values
à long terme"; **EG** "(4) Dettes et produits constatés d'avance à
moins d'un an"; **EH** "(5) Dont concours bancaires courants, et soldes
créditeurs de banques et CCP".

### 2052-SD — COMPTE DE RÉSULTAT DE L'EXERCICE (en liste)

Revenue lines have three value columns: **France**, **Exportations et
livraisons intracommunautaires**, **Total**. Everything else is a
single "Exercice N" column. Codes below are the **Total**-column codes
unless noted.

**Produits d'exploitation** — Ventes de marchandises * (France FA /
Export FB / **Total FC**); Production vendue Biens * (FD/FE/**FF**),
Services * (FG/FH/**FI**); Chiffres d'affaires nets * (FJ/FK/**FL** —
itself France+Export+Total of the three lines above, i.e. `FL = FC + FF
+ FI` and correspondingly `FJ = FA+FD+FG`, `FK = FB+FE+FH`); Production
stockée * **FM**; Production immobilisée * **FN**; Subventions
d'exploitation **FO**; Reprises sur amortissements et provisions * (9)
**FP**; Produits des cessions d'immobilisations incorporelles et
corporelles **F1**; Autres produits (1)(11) **FQ**; **TOTAL DES
PRODUITS D'EXPLOITATION (2) (I) = FR**.

**Charges d'exploitation** — Achats de marchandises (y compris droits
de douane) * **FS**; Variation de stocks (marchandises) * **FT**;
Achats de matières premières et autres approvisionnements * **FU**;
Variation de stocks (matières premières et approvisionnements) *
**FV**; Autres achats et charges externes (3)(6*bis*) * **FW**; Impôts,
taxes et versements assimilés * **FX**; Salaires et traitements *
**FY**; Cotisations sociales (10) **FZ**; Dotations d'exploitation, sur
immobilisations: dotations aux amortissements * (14) **GA**, dotations
aux dépréciations **GB**; sur actif circulant: dotations aux
dépréciations * **GC**; pour risques et charges: dotations aux
provisions **GD**; Valeurs comptables des immobilisations incorporelles
et corporelles cédées **G1**; Autres charges (12) **GE**; **TOTAL DES
CHARGES D'EXPLOITATION (4) (II) = GF**.

**1 – RÉSULTAT D'EXPLOITATION (I – II) = GG**.

**Opérations en commun** — Bénéfice attribué ou perte transférée * (III)
**GH**; Perte supportée ou bénéfice transféré * (IV) **GI**.

**Produits financiers** — Produits financiers de participations (5)
**GJ**; Produits des autres valeurs mobilières et créances de l'actif
immobilisé (5) **GK**; Autres intérêts et produits assimilés (5) **GL**;
Reprises sur dépréciations **GM**; Différences positives de change
**GN**; Produits nets sur cessions de valeurs mobilières de placement
et d'instruments de trésorerie **GO**; Produits des cessions
d'immobilisations financières **G2**; **TOTAL DES PRODUITS FINANCIERS
(V) = GP**.

**Charges financières** — Dotations financières aux amortissements et
provisions * **GQ**; Intérêts et charges assimilées (6) **GR**;
Différences négatives de change **GS**; Valeurs comptables des
immobilisations financières cédées **G3**; Charges nettes sur cessions
de valeurs mobilières de placement **GT**; **TOTAL DES CHARGES
FINANCIÈRES (VI) = GU**.

**2 – RÉSULTAT FINANCIER (V – VI) = GV**.
**3 – RÉSULTAT COURANT AVANT IMPÔTS (I – II + III – IV + V – VI) = GW**.

### 2053-SD — COMPTE DE RÉSULTAT DE L'EXERCICE (Suite)

Produits exceptionnels (7)(VII) **HD**; Charges exceptionnelles (6*bis*
– 6*ter*– 7) (VIII) **HH**; **4 – RÉSULTAT EXCEPTIONNEL (VII – VIII) =
HI**; Participation des salariés aux résultats (IX) **HJ**; Impôts sur
les bénéfices * (X) **HK**; **TOTAL DES PRODUITS (I + III + V + VII) =
HL**; **TOTAL DES CHARGES (II + IV + VI + VIII + IX + X) = HM**; **5 –
BÉNÉFICE OU PERTE (Total des produits – Total des charges) = HN**.

Everything after that — (1) through (14) and the two detail tables (7)
and (8) — is **memo/breakdown only**, not part of the additive total
structure: dont produits nets partiels sur opérations à long terme
(**HO**); dont produits de locations immobilières (**HY**) / produits
d'exploitation afférents à des exercices antérieurs (**1G**); dont
crédit-bail mobilier (**HP**) / immobilier (**HQ**); dont charges
d'exploitation afférentes à des exercices antérieurs (**1H**); dont
produits/intérêts concernant les entreprises liées (**1J**/**1K**); dont
dons art. 238 *bis* CGI (**HX**); dont amortissements PME innovantes
art. 217 *octies* (**RC**) / art. 39 *quinquies* D constructions
nouvelles (**RD**); dont cotisations personnelles de l'exploitant (13)
(**A2**, memo **A5** = hors CSG/CRDS); dont redevances brevets/licences
produits (**A3**) / charges (**A4**); dont primes et cotisations
complémentaires personnelles (**A8**, memos **A10**/**A11**); dont
montant de l'amortissement du fonds de commerce (14) (**HS**); detail
tables for (7) produits/charges exceptionnels and (8)
produits/charges sur exercices antérieurs.

## 3. Account-to-line mapping table

This app doesn't enforce PCG numbering beyond the leading digit
(`AccountsService.resolvePcgClass()` derives `pcgClass` from the first
character only — confirmed by reading `accounts.service.ts`). Everything
below maps by the **2–4 digit account-number prefix conventions from
Règlement ANC 2014-03** (`specs/Reglt 2014-03_Plan comptable general.pdf`,
Art. 932-1 nomenclature, Classes 1–7 — the same document CLAUDE.md
already cites for the VAT account split), because that's the only
signal available beyond the leading digit for a company that follows
normal French chart-of-accounts convention — which this app's own seed
(`backend/prisma/pcg-accounts.ts`) does. **This is a convention, not an
enforced constraint** — an account numbered outside these ranges within
its class would not be picked up by prefix rules and needs its own
design answer (see §7, "unmapped account" question).

All Actif Brut lines = sum of **debit − credit** (net debit balance)
over the account-number range for the corresponding 2x class account
(excluding its 28x/29x contra-account). All Actif Amortissements lines
= sum of **credit − debit** (net credit balance) over the matching
28x/29x/39x/49x/59x contra-account range. Net is never separately
summed — it's Brut minus Amortissements, matching the form's own
uncoded Net column (§2).

### 3a. Bilan Actif (2050)

| Code | PCG accounts (Brut) | PCG accounts (Amort./dépréciation) |
|---|---|---|
| AB/AC | 201 | 2801 |
| CX/CQ | 203 | 2803 |
| AF/AG | 205 | 2805 |
| AH/AI | 207 | 2807 |
| AJ/AK | 206 + 208 *(flagged, see §4)* | 2806 + 2808 |
| AL/AM | 232 + 237 | 2932 (dépréciations en cours, rare) |
| AN/AO | 211 | 2811 (terrains de gisement) + 2911 (dépréciations) |
| AP/AQ | 213 + 214 | 2813 + 2814 |
| AR/AS | 215 | 2815 |
| AT/AU | 212 + 218 | 2812 + 2818 |
| AV/AW | 231 + 238 | 2931 (dépréciations en cours, rare) |
| CS/CT | 261 + 266 | 2961 + 2966 |
| CU/CV | 273 | 2973 |
| BB/BC | 267 | 2967 |
| BD/BE | 25 + 271 + 272 | 2971 + 2972 |
| BF/BG | 274 | 2974 |
| BH/BI | 275 + 276 + 277 | 2975 + 2976 |
| BL/BM | 31 + 32 | 391 + 392 |
| BN/BO | 33 | 393 |
| BP/BQ | 34 | 394 |
| BR/BS | 35 | 395 |
| BT/BU | 37 | 397 |
| BV/BW | 4091 | *(no standard contra — flagged, rare)* |
| BX/BY | 411 + 413 + 416 + 418 | 491 |
| BZ/CA | remaining debit-balance class-4 tiers accounts not otherwise mapped (421–428, 43, 44 incl. **445660/445662 — this app's own VAT-déductible accounts**, 45, 46, 47) | 495 + 496 |
| CB/CC | 109 + 4562 | — |
| CD/CE | 50 | 590 |
| CF/CG | 51 + 53 + 54 + 58, **debit-balance only** (see §4, overdraft flag) | — |
| CH/CI | 486 | — |
| CW | 4816 | *(n/a — shaded on form)* |
| CM | 169 | *(n/a — shaded on form)* |
| CN | 476 | *(n/a — shaded on form)* |

TOTAL (II) = sum of all immobilisations rows. TOTAL (III) = sum of
stocks + créances + disponibilités + CCA. TOTAL GÉNÉRAL = TOTAL(I) +
TOTAL(II) + TOTAL(III) + CW + CM + CN, each column independently.

### 3b. Bilan Passif (2051)

| Code | PCG accounts |
|---|---|
| DA | 101 |
| DB | 104 |
| DC (+ memo EK) | 105 (+ 107, folded in — **flagged, see §4**) |
| DD | 1061 |
| DE | 1063 |
| DF (+ memo B1) | 1064 |
| DG (+ memo EJ) | 1068 |
| DH | 11 (110 credit, 119 debit, net) |
| DI | **not a ledger read — set equal to compte de résultat's HN.** See §5, correction: account 12 reads 0.00 within the fiscal year itself in this app (à-nouveau posts the prior year's result into 120/129 only as part of the *following* year's opening entry — confirmed in `a-nouveau.service.ts`), so DI must be constructed from HN, not independently read. |
| DJ | 13 |
| DK | 14 |
| DM | 1671 |
| DN | 1674 |
| DP | 151 |
| DQ | 153 + 154 + 155 + 156 + 157 + 158 |
| DS | 161 |
| DT | 162 + 163 |
| DU (+ memo EH) | 164 + 165, **plus any class-5 account with a net *credit* balance** (overdraft — 512/514/519) reclassified in here rather than netted against CF disponibilités — **flagged, see §4** |
| DV (+ memo EI) | 166 + 168 |
| DW | 4191 |
| DX | 401 + 403 + 408 |
| DY | 42 (421–428, credit) + 43 + 444 + 4455 + **445710 (this app's own TVA collectée account)** + 447 + 448 |
| DZ | 404 + 405 |
| EA | 455 (**credit balance only** — flagged, see §4) + 456 + 457 + 458 + 46 (credit) + 47 (credit) |
| EB | 487 |
| ED | 477 |

TOTAL (I)=DA..DK, TOTAL(II)=DM+DN, TOTAL(III)=DP+DQ, TOTAL(IV)=DS..EB,
TOTAL(V)=ED, TOTAL GÉNÉRAL=sum of all five.

### 3c. Compte de résultat (2052/2053)

This pass computes **Total only** — the France/Export split (FA/FB,
FD/FE, FG/FH) is **not implemented**, same scoping decision already
made for CA3 (no AIC/imports split). `FJ/FK` stay unimplemented;
`FL`/`FC`/`FF`/`FI` (the Total column) are computed.

| Code | PCG accounts | Note |
|---|---|---|
| FC | 707 (net of 7097) | |
| FF | 701 + 702 + 703 + 704 | Biens vs. Services split — **flagged, see §4** |
| FI | 705 + 706 | |
| FL | = FC + FF + FI | computed subtotal, not a direct account sum |
| FM | 71 (713) | |
| FN | 72 | |
| FO | 74 | |
| FP | 781 | footnote (9) unconfirmed — **flagged** |
| F1 | 7751 + 7752 | **not** all of 775 — see §4 (cessions split) |
| FQ | 75 + 708 | 708 placement flagged, see §4 |
| FS | 607 (net of 6097) | |
| FT | 6037 | |
| FU | 601 + 602 (net of 6091/6092) | |
| FV | 6031 + 6032 | |
| FW | 604 + 605 + 606 + 61 + 62 (net of 6094–6096) | the big "autres achats et charges externes" bucket — covers most of this app's seed's 61x/62x accounts |
| FX | 63 | |
| FY | 641 + 644 | |
| FZ | 645 + 646 + 647 + 648 | |
| GA | 6811 | memo HS (fonds de commerce amortization) needs immobilisations-module tracing, not a ledger total — see §4 |
| GB | 6816 | |
| GC | 6817 | |
| GD | 6815 | |
| G1 | 6751 + 6752 | always 0.00 today — cession not implemented, see §4 |
| GE | 651 + 653 + 654 + 658 | |
| GH/GI | Opérations en commun (655/755 family) | **uncertain — flagged, see §4** |
| GJ | 761 | |
| GK | 762 + 763 | |
| GL | 768 | |
| GM | 786 | |
| GN | 766 | |
| GO | 767 | |
| G2 | 7756 | |
| GQ | 686 | |
| GR | 661 + 664 + 668 | |
| GS | 666 | |
| G3 | 6756 | always 0.00 today — cession not implemented |
| GT | 667 | |
| HD | 771 + 774 + 7758 + 778 | **not** all of 77 — see §4 (cessions split) |
| HH | 671 + 672 + 674 + 6758 + 678 | |
| HJ | 691 | |
| HK | 695 | this app's seed account `695000` maps directly |

All TOTAL/RÉSULTAT lines (FR, GF, GG, GP, GU, GV, GW, HI, HL, HM, HN)
are **computed**, never summed from an account range directly.

## 4. Flagged — distinctions the chart doesn't cleanly support, or that need the missing notice

Ranked by how much they matter to getting a basic case right:

1. **Bank overdrafts must be sign-reclassified from Actif to Passif —
   the single most consequential rule in this mapping.** A class-5
   account (512 Banques, 514 CCP, 519 concours bancaires courants) with
   a net *credit* balance is not "negative disponibilités" — PCG's own
   art. 933-4 explains the terminaison-9 mechanism for contra-accounts,
   and the 2051 form's own memo line **EH** ("dont concours bancaires
   courants, et soldes créditeurs de banques et CCP") confirms this is
   meant to land under **DU**, not net against CF. The engine must
   check the *sign* of each 51x/54x/58x account's balance per account,
   not just its class, and route accordingly. Miss this and a company
   with an overdraft gets a wrong bilan on both sides.
2. **775 "Produits des cessions d'éléments d'actif" splits across three
   different compte-de-résultat sections by sub-account, not by class.**
   7751/7752 (incorporelles/corporelles) land in **F1**, inside
   *produits d'exploitation*; 7756 (financières) lands in **G2**, inside
   *produits financiers*; only 7758 ("autres éléments d'actif") stays in
   **HD**, *produits exceptionnels* — even though the whole 775 account
   is nominally class 77. Same split mirrored on the charges side (675 →
   G1/G3/HH). This is the textbook case of "the chart's class boundary
   doesn't match the form's line boundary" — confirmed from the form
   images (F1/G2 sit under Produits d'exploitation/financiers, not
   under HD), not assumed.
3. **Cession lines (F1, G1, G2, G3) will report 0.00 today, not because
   they're excluded from the mapping, but because no code path in this
   app can post to the underlying accounts yet.** CLAUDE.md already logs
   cession (plus/moins-value, disposal écriture) as unimplemented in the
   depreciation module — `FixedAsset.cessionDate`/`cessionPrice` stay
   null, no DTO/UI surface exists. The mapping is correct as written;
   it'll just always compute to zero until that roadmap item lands. Not
   a liasse-module gap, an upstream one — noting it here so it isn't
   mistaken for a mapping bug later.
4. **GA's memo HS ("dont montant de l'amortissement du fonds de
   commerce") needs joining through the immobilisations module, not a
   ledger total.** `6811` is one aggregate dotations account in this
   app's seed; isolating the portion attributable specifically to fonds
   commercial (account 207) assets requires tracing
   `DepreciationEntry` → `FixedAsset.accountId` → filter to `207`, the
   same join already used for VNC (`fixed-asset-invariants.ts`), not a
   pure trial-balance read. Flagging this as an engine-shape
   consequence, not a blocker for the core additive lines — HS is a
   memo, out of scope for "the two foundational forms" as literally
   requested, but worth knowing before the engine is built so the shape
   accommodates it later.
5. **"Opérations en commun" (GH/GI, source accounts 655/755 family) —
   genuinely uncertain, not just unverified.** The 655/755 account
   family has a gérant-side/non-gérant-side split (6551 vs. 7555 for
   bénéfice, 7551 vs 6555 for perte) that doesn't map onto GH/GI's
   two-line "produit-like / charge-like" structure without the notice
   (2032-NOT-SD) confirming which sub-account feeds which line. Low
   real-world frequency (GIE/opérations-en-commun structures are rare),
   so **deferring GH/GI entirely** rather than guessing is the
   recommended call — flag, don't guess, same standard as everywhere
   else in this codebase.
6. **Maturity-based memo lines (CP/CR on 2050, EG on 2051) aren't
   derivable from this ledger at all.** They require an "à moins/plus
   d'un an" split that depends on a due date, and `EcritureLigne` has no
   due-date field (only `dateLettrage`, which is a reconciliation
   marker, not a maturity). These are memo-only lines, not part of any
   TOTAL — recommend leaving them permanently unimplemented rather than
   half-guessing, and saying so explicitly in the output shape (null,
   not zero, so it's visibly "not computed" rather than "computed as
   zero").
7. **DA/DG/DF's memo breakouts (EK écart d'équivalence, B1 réserve
   fluctuation des cours, EJ réserve œuvres d'artistes vivants) are
   niche sub-cases without a standard 4-digit PCG subaccount confirmed
   in the regulation text I could extract.** Same recommendation: defer
   the memos, compute the parent line (DC/DF/DG) from the full 105/1064/
   1068 range.
8. **206 "Droit au bail" has no dedicated 2050 line** — the form only
   shows Frais d'établissement / Frais de développement /
   Concessions-brevets / Fonds commercial / Autres immobilisations
   incorporelles. Routing 206 into **AJ** ("Autres") is the
   professionally standard convention, but I could not independently
   confirm it from the form or PCG text alone (would normally come from
   2032-NOT-SD) — flagging as "confident but not source-confirmed,"
   distinct from the fully-confirmed rows.
9. **708 "Produits des activités annexes"** — routed to FQ ("Autres
   produits") above as the more defensible reading, but it could
   arguably belong inside FI ("Services") depending on the annexe's
   nature; same "notice would settle this" flag.
10. **"Unmapped account" question — a real engine-design decision, not
    a mapping-table gap.** Because this app only enforces the leading
    digit, a company could create an account number this table's
    prefix rules don't recognize (e.g. a made-up `219999`). Two options:
    (a) the engine throws, naming the unmapped account, same "throw
    rather than guess" pattern as `ca3-declaration.ts`'s
    `DEDUCTIBLE_PREFIX` guard; (b) unmapped balances get bucketed into a
    generic line with a visible warning. **Recommend (a)** for
    consistency with the rest of this codebase's guard philosophy — but
    this is a real design choice, flagging for confirmation rather than
    silently picking one.

## 5. Articulation rules — testable invariants (the oracle)

No official validator exists for this (unlike FEC's Test Compta Demat).
These are the invariants to assert in `*.spec.ts`, mirroring how
`a-nouveau.service.spec.ts` asserts débit=crédit rather than trusting
construction:

1. **Bilan balances — and this one really is computed independently on
   each side, confirmed by re-checking how this app's ledger actually
   posts a result.** `TOTAL GÉNÉRAL Actif (Net, i.e. CO − 1A) ===
   TOTAL GÉNÉRAL Passif (EE)`. Actif's total is built *only* from
   asset-nature accounts (classes 2–3, and the debit-balance halves of
   classes 4–5); Passif's total is built *only* from liability/equity-
   nature accounts (class 1, and the credit-balance halves of classes
   4–5) — two disjoint account partitions of the *same* trial balance,
   summed by completely separate line rules. That's what makes this a
   real signal rather than a tautology: it only holds if the mapping
   correctly partitions *every* account exactly once with the correct
   sign (misclassify the overdraft case in §4.1, or double-count/drop an
   account anywhere, and this breaks). The one line that isn't a raw
   ledger read is **DI** — see the correction in #2 below — but DI is
   *constructed from* class 6/7 accounts, which are on neither the Actif
   nor the rest-of-Passif side, so folding it in doesn't undermine the
   independence of the two sides; it's the standard bilan mechanism (the
   résultat is the connecting figure between the two statements), not a
   shortcut.
2. **Correction — DI is not an independent read, and treating it as one
   would have been a real bug.** I originally wrote this as "`HN ===
   DI`, both independently computed" — that's wrong, and I caught it by
   re-checking how this app's ledger actually posts a result rather than
   assuming a textbook chart of accounts. `a-nouveau.service.ts` posts
   the *prior* year's class 6/7 net result into `120000`/`129000` only
   as part of the *following* year's own opening (à-nouveau) écriture —
   never within the fiscal year itself. So reading account 12 from the
   trial balance of the very year the liasse is being produced for would
   read **0.00**, not the real result, and "confirming" `HN === DI` that
   way would always trivially pass by comparing HN to zero, which is
   worthless as a check and actively misleading as a design. The fix:
   **DI is not a ledger read at all — it's set equal to `HN`,
   constructed, exactly like every other TOTAL/RÉSULTAT line in §5.5.**
   This has a real engine-shape consequence, noted in §6: the compte de
   résultat must be computed *before* the bilan, because the bilan's own
   DI line needs `HN` as an input.
3. **Bilan ties to the trial balance.** Every Brut/Amort/Passif figure
   on 2050/2051 must equal the sum of its mapped accounts' balances in
   the *same* trial-balance snapshot the engine read — i.e. the mapping
   layer must not drop or double-count a single `EcritureLigne`. Testable
   directly: sum all mapped account balances across every bilan line and
   confirm it equals the trial balance's own grand total debit/credit
   for the classes 1–5 accounts.
4. **Bilan's immobilisations Net column ties to the immobilisations
   module's VNC.** For each `FixedAsset`, `valeurBrute` and
   `amortissementsCumules` are computed independently
   (`fixed-asset-invariants.ts`, from `acquisitionValue` and posted
   `DepreciationEntry.amount` respectively — **not** from re-reading the
   ledger's 21x/28x balances). The invariant: grouping `FixedAsset`s by
   the bilan line their `accountId` falls under (e.g. all assets whose
   account is in the 213 range → "Constructions"), `sum(valeurBrute) ===
   ` that line's ledger-derived Brut, and `sum(amortissementsCumules)
   === ` that line's ledger-derived Amortissements. This is a genuine
   cross-check between two independently-sourced numbers (ledger
   aggregation vs. the immobilisations module's own bookkeeping) — if
   they diverge, either a dotation wasn't posted correctly or an
   acquisition écriture bypassed the immobilisations module. Requires
   validated-only écritures on both sides for a fair comparison.
5. **Produits d'exploitation / Charges d'exploitation subtotals sum
   correctly.** `FR === FC+FF+FI+FM+FN+FO+FP+F1+FQ`, `GF ===
   FS+FT+FU+FV+FW+FX+FY+FZ+GA+GB+GC+GD+G1+GE`, and so on up through
   `HN` — every computed TOTAL/RÉSULTAT line is the sum/difference of
   the lines the form itself says it is, per §2's quoted formulas
   (`GG=I-II`, `GV=V-VI`, `GW=I-II+III-IV+V-VI`, `HI=VII-VIII`,
   `HN=Total produits - Total charges`). Purely mechanical, but worth
   asserting explicitly per line rather than trusting the final number
   alone — the same "assert every line" discipline as
   `ca3-declaration.spec.ts`'s hand-computed oracle.
6. **Draft-blocking, same as FEC/CA3/Monaco.** Any validated fiscal year
   still containing a draft écriture refuses to compute — consistent
   with the established pattern, not a new rule.

## 6. Engine shape

Goal: one regime-independent aggregation layer; the 2050 mapping (this
pass) and the 2033 mapping (later) both consume its output without the
engine itself knowing which regime it's serving.

```
trial balance (validated-only, per fiscal year)
        │
        │  reuses/extends LedgerService's existing per-account
        │  debit/credit aggregation (ledger.service.ts), but scoped
        │  to validated écritures only — a compliance artifact,
        │  same guard as FEC/CA3/Monaco, unlike the grand-livre
        │  screen's working balance which includes drafts
        ▼
Map<accountNumber, { label, pcgClass, debit: Money, credit: Money }>
        │
        │  a declarative, regime-agnostic rule list:
        │  { code, label, accountPrefixes[], balanceDirection }
        │  — pure data, no logic
        ▼
applyLineRules(trialBalance, rules) → Record<lineCode, Money>
        │                                   ▲
        │                                   │
   BILAN_2050_RULES /              (later, unbuilt this pass)
   COMPTE_RESULTAT_2052_2053_RULES  BILAN_2033_A_RULES /
        │                           COMPTE_RESULTAT_2033_B_RULES
        ▼
computeCompteResultat2052_2053(trialBalance)   ①  compute this FIRST
        │  produces HN
        ▼
computeBilan2050(trialBalance, { resultatDeLExercice: HN })   ②  then this
   — DI is set to the HN passed in, not read from account 12 — see §5.2's
     correction. This ordering dependency is a direct, load-bearing
     consequence of that finding, not an arbitrary implementation choice:
     the bilan literally cannot compute its own résultat line without the
     compte de résultat's output, because account 12 reads 0.00 within
     the fiscal year itself in this app's ledger. Both functions remain
     pure/no I/O (mirrors Ca3Declaration/MonacoDeclaration's shape) —
     it's a function-call ordering, not a hidden read.
        │
        ▼
assertLiasseArticulation({ bilan, compteResultat, trialBalance, vncByAccount })
   — separate pure function, §5's invariants (bilan-balances and
     ties-to-trial-balance are the two checks that remain genuinely
     independent cross-checks after the DI correction — see §5.1/§5.2),
     throws (NestJS exception, not a plain Error) rather than returning a
     possibly-wrong result
```

Concretely, mirroring the existing `vat/` module's file layout:

- `src/modules/liasse/trial-balance-engine.ts` — the regime-independent
  aggregation (`Map<accountNumber, {...}>` builder), reusable by both
  mapping layers. Candidate to extract from/share with
  `ledger.service.ts` rather than duplicate, since the aggregation
  logic (sum debit/credit per account for a fiscal year) is identical;
  the only difference is validated-only vs. draft-inclusive filtering.
- `src/modules/liasse/bilan-2050.ts`, `compte-resultat-2052-2053.ts` —
  this pass's two rule sets + the pure compute functions, replacing
  today's `NotImplementedException` stub.
- `src/modules/liasse/liasse-articulation.ts` — §5's invariants as one
  function, independently unit-testable against constructed
  (bilan, compteResultat, trialBalance) fixtures without needing a real
  DB.
- `src/modules/liasse/liasse.service.ts` — orchestration: fetch trial
  balance + FixedAsset/DepreciationEntry data, draft-guard, call the
  two compute functions, call the articulation check, return both
  documents.
- 2033 (later): `bilan-2033-a.ts`, `compte-resultat-2033-b.ts`, same
  shape, same `trial-balance-engine.ts` input, no changes to the engine
  itself required — this is the concrete test of "does the engine
  shape actually support a second mapping layer."

## 7. Open items before computation can start

1. ~~`Company.regime` doesn't exist in the schema yet.~~ **Resolved and
   committed** (`add_company_regime` migration): `Regime` enum
   (`REEL_NORMAL` | `REEL_SIMPLIFIE`) on `Company.regime`, default
   `REEL_NORMAL`, existing companies backfilled. No service/DTO/UI
   wiring yet — that lands with the liasse module itself.
2. **§4's ten flagged items** — particularly #1 (overdraft
   reclassification) and #2 (cessions split across sections), which are
   not edge cases but core to getting even a simple company's bilan
   right.
3. **§4 item 10** — throw-on-unmapped vs. bucket-with-warning, a real
   design choice.
4. Confirm the **articulation rules in §5** are the right oracle set —
   in particular whether #4 (VNC cross-check) should be a hard throw
   (blocks computing the liasse) or a soft warning (computes anyway,
   flags the discrepancy) given it's checking two independently-sourced
   figures that could legitimately diverge if immobilisations data is
   incomplete for an existing company being onboarded mid-year.
5. Getting `2032-NOT-SD` (and eventually `2033-NOT-SD`) into `specs/`
   would resolve §4 items 5, 8, 9, and the FP/(9) and GA/(14)
   footnotes — worth acquiring before or during implementation rather
   than shipping best-guess conventions for those specific lines.

Computation (`computeBilan2050`, `computeCompteResultat2052_2053`,
the articulation checks) stays unbuilt until this mapping is confirmed.
