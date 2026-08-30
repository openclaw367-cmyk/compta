# Invoicing / facturation — regulatory research and phased plan

**Status: STEP 1 (regulatory research) and STEP 2 (phased plan) both
complete, 2026-08-30. NO CODE WRITTEN.** Per the standing instruction,
this document exists to establish the regulatory ground *before* any
design-detail or build work — the same discipline this app already
applied to FEC (Article A47 A-1 du LPF), CA3, Monaco VAT, and the
liasse: primary sources first, cited, not recalled from training data.
Nothing in this document is authorization to build; it's the gate that
must be cleared (and re-confirmed by the user) before a real
design-then-verify pass starts, the same two-step this roadmap already
requires for every GATED feature.

**Why this needed its own pass, not just a roadmap bullet**: the French
e-invoicing/e-reporting mandate has been rescheduled repeatedly since
its original 2024 target, and its own supporting infrastructure (the
PPF's role) changed shape mid-reform. Recalling "the PDP thing" from
training data would very likely reproduce a stale calendar or a
since-abandoned architecture — exactly the failure mode this document
exists to prevent.

---

## STEP 1 — Regulatory landscape (cited primary sources)

### 1.1 Current status of the French e-invoicing/e-reporting mandate

**The calendar, as currently in force**, originally set by the 2024
Finance Law (Loi de finances 2024) and reconfirmed — not postponed —
by Article 123 of the Loi de finances 2026:

| Date | Obligation | Who |
|---|---|---|
| **1 September 2026** | **Réception** of e-invoices (via an accredited platform) | ALL VAT-liable businesses, including those under the VAT exemption regime (franchise en base) |
| **1 September 2026** | **Émission** of e-invoices + e-reporting data transmission | Grandes entreprises + ETI (entreprises de taille intermédiaire) |
| **1 September 2027** | **Émission** of e-invoices + e-reporting data transmission | PME, TPE, and micro-entreprises (including auto-entrepreneurs) |

A proposed postponement to 2027/2028 was put to a vote and **rejected
on 11 April 2025** — the reform's timeline is confirmed, not tentative,
as of this research pass.

Sources: [economie.gouv.fr — Tout savoir sur la facturation
électronique](https://www.economie.gouv.fr/tout-savoir-sur-la-facturation-electronique-pour-les-entreprises)
· [impots.gouv.fr — Je passe à la facturation
électronique](https://www.impots.gouv.fr/professionnel/je-passe-la-facturation-electronique)
(page itself shows **"Publié le 16/10/2024, modifié le 27/08/2026"** —
i.e. actively maintained, updated three days before this research pass)
· KPMG Avocats, [Facturation électronique : aménagement des obligations
et renforcement des
sanctions](https://kpmg.com/av/fr/avocats/eclairages/2026/03/facturation-electronique-amenagement-des-obligations-et-renforcement-des-sanctions.html)
(March 2026, on LF2026 art. 123) · multiple independent secondary
sources (Pennylane, Sellsy, Indy, Konica Minolta) cross-agreeing on the
same two dates.

**A real, structural change since the reform's original design, which
must not be recalled from an older mental model**: the **PPF (portail
public de facturation)** was originally meant to be a free public
platform any business could use to issue/receive/transmit e-invoices,
in parallel with private PDPs. **The DGFiP abandoned that role for the
PPF on 15 October 2024.** The PPF now retains only two functions: the
**annuaire** (a directory of businesses and their invoicing
capabilities — opened for testing in H1 2025, publicly queryable since
2025) and the **concentrateur** (a data relay for e-reporting flows to
the tax administration). **There is no longer a free/public option for
actually issuing or transmitting invoices** — every business must
route through a private, DGFiP-accredited platform.

Sources: multiple independent secondary sources cross-agreeing
(Indy.fr, Agiris, Dougs, Lido, Vofact) on the 15 October 2024 DGFiP
announcement and the PPF's reduced annuaire+concentrateur role; KPMG
Avocats (above) independently confirms "cessation of the Public
Invoicing Portal (PPF) development... with private platforms now
assuming central responsibility." *(No single impots.gouv.fr page
stating this in one place was found and fetched directly in this pass
— flagged as a residual primary-source gap; the finding is
well-corroborated across multiple independent secondary sources plus
the professional/legal KPMG source, but a design-pass re-check directly
against a DGFiP/impots.gouv.fr FAQ page is worth doing before this
becomes load-bearing for Phase B.)*

### 1.2 The PPF/PA (formerly PDP) model — does compliant invoicing require accredited-platform transmission?

**Terminology note, current as of this pass**: what was called a
**PDP (plateforme de dématérialisation partenaire)** through most of
the reform's public discussion is now officially termed a **Plateforme
Agréée (PA)** — same role, renamed. Both terms appear in sources of
different vintages; this document uses **PA** going forward and notes
PDP as the prior name.

**The answer to the user's core question, stated plainly**: **yes**,
compliant e-invoice *transmission* under the reform requires routing
through a DGFiP-accredited PA — there is no compliant self-transmission
path once a business's own size threshold is reached. But **generating**
a correctly-formatted, correctly-mentioned invoice does not itself
require accreditation; only the *transmission* leg does, and that leg
can be — must be — delegated to a third-party accredited PA, not built
in-house. See §1.4 for why becoming a PA oneself is out of scope.

**Mandated formats**: three structured formats are accepted, and every
accredited PA must be able to receive/emit/convert all three:

- **Factur-X** — a hybrid format: a human-readable PDF with an embedded
  structured XML data block in one file.
- **UBL** (Universal Business Language) — pure XML.
- **CII** (Cross-Industry Invoice, UN/CEFACT) — pure XML.

Source: consistent across multiple independent secondary sources
(Indy.fr, Tenor, Quadient, Advanced Conseil) — "les trois formats sont
tous interopérables : la Plateforme Agréée... assure automatiquement la
conversion entre formats."

**Becoming a PA — the actual accreditation process**, confirmed to be a
formal, audited, multi-step DGFiP process, not a self-certification:

1. Application filed on `demarche.numerique.gouv.fr` (the Service
   d'Immatriculation), a declarative form plus roughly a dozen
   supporting documents (in French or certified translation).
2. Compliance against a strict cahier des charges: data security,
   Factur-X/UBL/CII technical support, PEPPOL interoperability,
   conformity audit.
3. A conditional "immatriculation sous réserve," then a technical test
   phase, before final registration.
4. Registration is valid **3 years, renewable** — not a one-time
   approval.
5. As of August 2026, **147 platforms are already accredited** — a
   substantial, mature ecosystem to integrate with.

Source: [Ma facture électronique — Procédure d'immatriculation d'une
plateforme
agréée](https://ma-facture-electronique.org/plateforme-agreee/immatriculation-procedure/)
· [Comparateur e-Facturation — Liste des 147 Plateformes Agréées (PDP)
DGFiP — Août
2026](https://comparateur-efacturation.fr/guide/liste-plateformes-agreees)
· consistent secondary-source corroboration (Deltic, Keobiz, DAF-Mag).

### 1.3 Mandatory legal mentions — France

Two **separate, currently-in-force** legal regimes govern what must
appear on a French invoice, independent of the e-invoicing reform (they
apply to *any* invoice today, paper or PDF, and will continue to apply
to the content of a Factur-X/UBL/CII invoice once the reform's
transmission requirement kicks in):

**A. Tax mentions — CGI, Annexe II, article 242 nonies A** (fetched
directly from Légifrance, **"en vigueur depuis le 01/01/2025"**):
identity/address of both parties; VAT numbers (supplier, and client for
certain intra-EU cases); tax representative details where applicable;
"Membre d'un assujetti unique" for VAT-group members; invoice date;
unique sequential/continuous numbering; delivery address if different;
per-line quantity/description/unit price HT/VAT rate or exemption;
whether the invoice is exclusively goods, exclusively services, or
both; discounts/rebates tied to the transaction; delivery/completion
date if different from invoice date; VAT amount due, totalled and
broken out by rate; cash-basis VAT option wording; exemption
citations; "Autoliquidation" (reverse charge) / "Autofacturation"
(self-billing) wording where applicable; special-regime wording (travel
agencies, second-hand goods/art/antiques); new-transport-means
characteristics; itemized detail for public-auction sales.

Source: [Légifrance — Article 242 nonies A, CGI Annexe
II](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050811276)
(fetched directly).

**B. Commercial/payment-terms mentions — Code de commerce, article
L441-10** (formerly L441-6/L441-9, renumbered): the discount conditions
applicable for early payment, the late-payment penalty rate applicable
from the day after the due date, and the **40 € forfaitary recovery
indemnity** (indemnité forfaitaire de recouvrement, `art. D441-5`) —
due automatically from the first day of late payment, no formality
required to claim it.

Source: consistent across multiple independent secondary/professional
sources (Berton & Associés, Assurup, Assistant-juridique.fr, Village de
la Justice), all citing L441-10/D441-5 directly.

**A real scope note for this app's own existing "Mandatory legal
mentions" gap**: this app's ledger-side invoicing/tiers logic already
tracks a due date (`EcritureLigne.dateEcheance`, per the maturity-split
work) but has no concept of the L441-10 late-payment-penalty/40€
indemnity wording at all — a genuinely new mention family, not an
extension of anything already modeled.

**Franchise en base de TVA (auto-entrepreneurs) are NOT exempt from the
reform** — they remain subject to the réception obligation from
September 2026 like everyone else, and to the émission obligation from
September 2027 for their B2B operations, exactly like any other
micro-entreprise. The narrow exemption from *émission* is limited to
businesses whose operations are VAT-exempt under CGI articles 261 to
261 E — and even then, they remain subject to the *réception*
obligation as soon as a supplier is VAT-liable in France.

Source: consistent across multiple independent secondary sources
(Portail-autoentrepreneur.fr, Indy.fr, ClairFacture, Optigest+).

### 1.4 The scope split this reform actually draws: e-invoicing vs. e-reporting

This is load-bearing for what this app needs to build vs. defer:

- **E-invoicing** (the PA-transmission requirement) covers **only
  domestic B2B transactions between VAT-liable parties established in
  France** (Monaco's own status is a separate, unresolved question —
  see §1.6).
- **E-reporting** (a *different*, lighter obligation — aggregated
  transaction/payment data pushed to the administration, not a full
  invoice exchanged with the counterparty) covers everything else: B2B
  international, exports, and B2C. For B2C specifically, this is
  typically daily aggregated data by transaction category and VAT rate,
  not per-invoice.

Source: consistent across multiple independent secondary sources (BDO,
Tiime, Rydge, Getyooz, TeamSystem) — "l'e-invoicing... factures B2B
nationales... l'e-reporting... transmission à l'administration de
données sur des opérations hors B2B France."

**Implication for this app's own scope**: this app's existing demo
companies and target user (a single France/Monaco SME/TPE-sized
company) sell primarily B2B and B2C domestically. A first invoicing
pass can reasonably scope to **domestic sales invoices** (the
e-invoicing case) and treat B2C aggregate e-reporting as an explicit,
later, separately-scoped extension — the same "flag, don't fake"
discipline as every other deferred scope boundary in this app. This is
a recommendation for the eventual design pass, not a decision made
here.

### 1.5 Sanctions

Per KPMG Avocats and consistent secondary corroboration: LF2026
increased the per-invoice fine for a missing/non-compliant e-invoice
from **€15 to €50**, capped at **€15,000 per year**. *(This figure is
corroborated across several independent secondary sources but was not
independently confirmed by fetching the exact LF2026 statutory text in
this pass — flag for re-confirmation at design-pass time if the exact
figure becomes user-facing, e.g. in warning copy.)*

### 1.6 Monaco — a genuinely open question, not resolved by assuming symmetry with France

This app's own established discipline (`CLAUDE.md`, "Monaco compliance
— verify before trusting") is explicit: *"A documented absence isn't
the same as a confirmed absence... don't assume symmetry with Case A
without a cited source."* Applying that same discipline here surfaced a
genuine conflict between sources, not a settled answer:

- **The official Monaco government portal**
  (`monentreprise.gouv.mc/en/themes/accounting-obligations-and-tax/legal-and-accounting-requirements/invoices/invoices-obligatory-notices`,
  **last updated 28/07/2026** — one month before this research pass, so
  not stale) describes only the **pre-reform** dematerialized-invoice
  regime: an invoice "may, subject to acceptance by the recipient, be
  sent electronically, provided the authenticity of their origin and
  the completeness of the content are guaranteed using an electronic
  signature." **No mention of a mandatory PA/platform requirement, no
  September 2026/2027 dates, no reference to the French PPF/PA
  framework at all.**
- A law-firm publication (99 Avocats) confirms Monaco's *own*, separate
  legal basis for invoice dematerialization: **Ordonnance Souveraine
  n°4.199** (20 February 2013) and **Ordonnance Souveraine n°9.821** (9
  March 2023, implementing eIDAS), both anchored in Monaco's own *Code
  des taxes sur le chiffre d'affaires* — a genuinely Monaco-specific
  instrument, not an incorporation-by-reference of the French reform.
  This source does **not** discuss the September 2026/2027 calendar at
  all.
- Only **secondary, non-governmental sources** (a Monaco-based digital
  agency's blog) assert that Monaco companies follow the identical
  French calendar, reasoning from *"Monaco n'est pas membre de l'Union
  européenne, mais partage un territoire de TVA unique avec la
  France"* (the same shared-VAT-territory logic this app's own Monaco
  VAT work already relies on for VAT rates) — but this source **cites
  no Monaco legal instrument** for extending the e-invoicing
  *transmission* mandate specifically, as opposed to VAT rates/rules,
  to Monaco.

**Honest verdict**: Monaco's VAT *rates and computation* rules are
well-established to mirror France's (already verified and shipped in
this app). Whether Monaco's *invoicing/e-invoicing transmission*
mandate follows the same French PA-accreditation calendar is **NOT
confirmed by an official Monaco source** as of this pass. The official
Monaco government portal — current as of one month ago — shows no
evidence of it. This must be tracked as an **open item**, not silently
assumed, exactly like this app already does for Monaco VAT's own open
items (TMP, acomptes provisionnels, filing-frequency mechanics).

**Adjustment (2026-08-30, after user review): build ONE
jurisdiction-parameterized engine, but do not pre-fill Monaco's
parameters from a prediction.** The same shared-engine-plus-per-
jurisdiction-rule-table pattern this app already uses for VAT
(`computeDeclaration()` branching FR/MC) and the liasse
(`trial-balance-engine.ts` shared by both regimes) applies here too —
`Company.jurisdiction` should drive invoicing the same way it already
drives everything else. **But Monaco's own mandatory-mentions list
being separately confirmed (§1.6 above, from the same official page) is
NOT the same thing as the *transmission/numbering/format* regime being
confirmed** — and pre-implementing an MC rule-set that quietly mirrors
France's numbering/écriture/transmission model would be shipping
compliance logic Monaco's own primary source doesn't currently support,
exactly the mistake this app's own "Monaco compliance" discipline
exists to prevent (see CLAUDE.md: *"a documented absence isn't the same
as a confirmed absence"* — and the inverse is just as true: a
*different* documented regime isn't evidence of symmetry either).
Concretely: the engine is architected to take a jurisdiction parameter
end to end (data model, mentions computation, numbering scope), but the
**MC rule-set itself is an explicit "Monaco invoicing rules pending
official confirmation" state** — a stub that throws naming the gap
(`NotImplementedException`, this codebase's own established "keep stub
modules honestly stubbed" convention — see CLAUDE.md, "Conventions"),
never a silent copy of France's mentions, numbering continuity, or
format rules. When Monaco's regime is announced and confirmed against
an official Monaco legal source, filling in the MC parameters becomes a
**contained, additive change** to the same seams — a new rule table
plus a removed stub, not a redesign. This is the actual payoff of
parameterizing now rather than hardcoding French assumptions
everywhere: the seams are designed, not the content.

Sources: [monentreprise.gouv.mc — Invoices, Obligatory
notices](https://monentreprise.gouv.mc/en/themes/accounting-obligations-and-tax/legal-and-accounting-requirements/invoices/invoices-obligatory-notices)
(official Monaco government portal, fetched directly, last updated
28/07/2026) · [99 Avocats — The dematerialisation of Monaco tax
invoices](https://www.99avocats.com/en/publications/the-dematerialisation-of-monaco-tax-invoices)
· bss.mc (secondary, non-governmental — cited for contrast, not relied
upon).

### 1.7 The honest verdict this document exists to deliver

> **Does building compliant invoicing now require PDP/PA
> integration/accreditation, or can we build a compliant invoice
> GENERATOR now and treat transmission as a later, separate layer?**

**Yes, it can be split exactly that way, and it should be** — mirroring
how bank reconciliation split Layer 1a (local engine, buildable and
useful standalone) from Layer 1b (live aggregator connectivity,
external, its own accreditation-adjacent relationship):

- **Invoice generation** — a real data model, the mandatory legal
  mentions per jurisdiction (both now confirmed from primary sources
  above), a Factur-X/PDF rendering, and posting the resulting sale to
  the ledger through this app's existing validated write path — needs
  **no external accreditation of any kind**. This is buildable, useful,
  and legally sound *today*, independent of the reform's transmission
  requirement, exactly the way this app already generates FEC exports
  and CA3 declarations without needing to be a DGFiP-accredited
  *anything*.
- **Compliant transmission** under the reform (the part that actually
  makes an invoice "électronique" in the regulatory sense, once a given
  company's size threshold is reached) requires routing through a
  third-party accredited PA. **This project should never attempt to
  become a PA itself** — the accreditation process (§1.2) is a
  multi-month, audited, 3-year-renewable undertaking oriented at
  platform vendors serving many companies, wildly disproportionate to
  this app's own scope. The correct shape is an **adapter to an
  existing accredited PA**, chosen and contracted with as an external,
  commercial decision — structurally identical to
  `BankAggregatorPort`/`BridgeAggregatorAdapter`.

---

## STEP 2 — Phased plan

### Phase A — compliant invoice generation (GATED)

**What it is**: a real `Invoice`/`InvoiceLine`/`Client` (or reuse of the
existing `Tiers` model — a design-pass decision, not resolved here) data
model; the mandatory legal mentions from §1.3 (France) and §1.6 (Monaco)
rendered onto every generated invoice; Factur-X (and/or plain PDF, a
design-pass decision) output; and — the actually GATED core — a
validated invoice posting a real, balanced écriture (411 client debit /
707-family + 44571-family credit, following this app's own existing
sale-écriture shape already used throughout the seed/sample data) to the
ledger through `EntriesService`'s existing create/validate path. **A
sale invoice creating a ledger entry is ledger-touching and gated by
this app's own standing rule** — never a privileged write path, no
different in kind from how `propose_ecriture` or the batch invoice
queue post through the ordinary write path today.

This phase has **no dependency on any PDP/PA decision** — it is fully
self-contained, and per §1.7 above, fully legally sound as an invoicing
tool in its own right (the same way this app already treats FEC/CA3
generation as complete, verified deliverables without needing to be an
accredited *anything*).

### Phase B — PA / e-transmission (GATED, likely separate initiative)

**What it is**: sending a Phase-A-generated invoice through a
third-party accredited PA so it counts as compliant "émission" under
the reform once a company's own size threshold requires it. Sequenced
exactly like bank-rec Layer 1b: a `InvoicingTransmissionPort`-shaped
interface (mirroring `BankAggregatorPort`/`ChatModelPort`'s own
one-interface-many-adapters precedent), one concrete adapter for
whichever PA is chosen, credential handling reusing
`CredentialEncryptionService` (the accepted "defends against a leaked
DB backup, not full machine access" threat model already documented for
the cloud AI tier and Bridge), and an explicit-consent UX reusing the
`ConsentDialog`/always-visible-provider-indicator vocabulary already
built.

**Choosing which PA to integrate with is an external, commercial
decision** (cost, API maturity/documentation quality, whether they offer
a sandbox), not a technical one this document resolves. Flagged, per
the roadmap, as **likely its own separate initiative** rather than
folded into Phase A's timeline — Phase A alone already delivers real
value (compliant invoices, correctly mentioned, posting correctly to
the ledger) well before any company using this app actually needs PA
transmission (Sept 2027 émission for the PME/TPE/micro-entreprise size
class this app's own demo companies fall into).

**A POTENTIAL Phase B integration target to watch (2026-08-30), not a
commitment**: there is a signal that a provider may offer French-model
(PA-shaped) transmission soon. This is recorded here purely as a watch
item — it changes nothing about Phase A, and does not pull Phase B
forward. It reinforces, rather than changes, the design choice already
made above: Phase B must sit behind an `InvoicingTransmissionPort`-
shaped abstraction (the same one-interface-many-adapters pattern as
`BankAggregatorPort`/`ChatModelPort`) specifically so this project can
integrate with *whichever* accredited PA actually materializes, without
committing to one before it's real. **The bar for a rumor to become an
actual integration target is the same bar Bridge had to clear before
`BridgeAggregatorAdapter` was built**: a real, accredited, publicly
documented API — not an announcement, not a beta signup page. Until
then this stays a watch-list entry, re-checked whenever Phase B is
picked up, not acted on now.

### Decisions flagged for the eventual design pass (not resolved here)

1. **Invoice numbering scheme and its legal continuity requirement.**
   French/Monaco law both require a unique, sequential, chronological
   numbering with no gaps and no reuse (mirroring `EcritureNum`'s own
   discipline in this app) — but it must be its **own** sequence,
   separate from `ecritureNum`, since an invoice number and its écriture
   number are legally distinct identifiers that happen to reference the
   same transaction. Whether it's one global sequence or per-year/
   per-series (some businesses run separate series for domestic vs.
   export, or for credit notes) is a real design question.
2. **Credit notes / avoirs.** These carry their own numbering-continuity
   and legal-mention rules (and their own écriture shape — a reversal of
   the original sale's 411/707/44571 lines, not a fresh unrelated
   entry). Not researched in depth this pass beyond noting they exist
   and are in scope for Phase A's design.
3. **The invoice→écriture posting model.** One combined écriture per
   invoice (mirroring how `disposeFixedAsset()` posts one combined
   écriture per disposal)? Draft-then-validate, matching every other
   creation path in this app (journal grid, à-nouveau, batch invoice
   queue)? This determines the actual write-path shape and needs its
   own review before code, same as every other écriture-shape decision
   in this app's history (cession, à-nouveau).
4. **Multi-currency.** Out of scope for Phase A by default — this app's
   own money-handling rule (`NUMERIC(15,2)`, one implied currency
   throughout) has no multi-currency support anywhere yet, and nothing
   in this research pass suggests inventing it just for invoicing.
   Flag explicitly at design-pass time rather than silently assuming
   single-currency if the target user base needs otherwise.
5. **Monaco scope, RESOLVED (2026-08-30)**: build one
   jurisdiction-parameterized engine (`Company.jurisdiction`-driven,
   same pattern as VAT/liasse), but the MC rule-set itself ships as an
   explicit **"Monaco invoicing rules pending official confirmation"**
   stub (`NotImplementedException`, naming the gap) — never a silent
   copy of France's mentions, numbering, or format rules, even though
   Monaco's *mandatory-mentions list* is separately confirmed (§1.6).
   Re-check `monentreprise.gouv.mc` and/or Monaco's own DSF before ever
   filling in the MC parameters — see §1.6's own adjustment note above
   for the full reasoning.
6. **Client/`Tiers` reuse vs. a dedicated invoicing-client model.** This
   app already has a `Tiers`/auxiliary-account mechanism (401/411-family)
   for clients and suppliers. Whether invoicing reuses that directly or
   needs its own lighter client model (an invoice needs a billing
   address/SIREN/RCI that a bare `Tiers` sub-account doesn't currently
   carry) is a real data-model question for the design pass.

---

## Closing note

This document is a **research-and-plan artifact**, current as of
2026-08-30. It establishes the regulatory ground and a phased shape;
it does **not** constitute a design (no schema, no API shape, no UI) and
authorizes no code. The next step, when this feature is picked up, is a
real design-then-verify pass for Phase A specifically — reviewing the
invoice data model, the posting écriture shape, and the numbering scheme
before any code is written, exactly like every other GATED feature in
this app went through. Re-check §1.1/§1.5/§1.6 against their sources
before that pass starts if meaningful time has passed, since this
reform has changed shape multiple times already and Monaco's status in
particular is explicitly unresolved.
