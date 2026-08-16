import { ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { Bilan2050 } from '../liasse/bilan-2050';
import { CompteResultat2052_2053 } from '../liasse/compte-resultat-2052-2053';
import { CashFlowStatement } from '../cash-flow/cash-flow-statement';
import { IMMOBILISATION_BILAN_CODES } from '../liasse/liasse-articulation';

/**
 * Retraitement analytique — the analyst's/investor's economic
 * re-presentation of the compliance bilan/compte de résultat/tableau de
 * flux already built elsewhere in this app. Fully deterministic: every
 * figure here is a ledger-derived sum, or a ratio of two ledger-derived
 * sums — never an assumption (WACC, discount rate, revenue multiple,
 * market price). Assumption-driven valuation (DCF, comparables, market
 * EV) is explicitly OUT of scope, deferred to a future "Valuation"
 * module that will CONSUME this module's deterministic outputs (EBE/
 * EBITDA, FCF, endettement net, capitaux propres, book EV, cost of debt)
 * as its own inputs — see CLAUDE.md "Analyse financière — retraitement
 * analytique" for the full derivation and every scope decision below.
 *
 * Ratios/percentages/day-counts below are NOT monetary values — they're
 * dimensionless quotients or day counts, inherently rounded for human
 * display (unlike money, which stays exact to the centime via Decimal
 * throughout this app). They're computed via Prisma.Decimal's own
 * arbitrary-precision `.dividedBy()`/`.times()` (through Money.toDecimal()),
 * never a native JS float division — precision-safe, just not
 * money-typed, since a ratio genuinely isn't money. Every denominator
 * that could be exactly zero is guarded: `null` ("n/a"), never a
 * divide-by-zero blowup or a silently wrong 0.00.
 *
 * Scope decisions, all deliberate:
 * - **BFR exploitation uses the EXACT SAME accounts, in the EXACT SAME
 *   gross-receivables convention, as cash-flow-statement.ts's own
 *   embedded ΔBFR** (BX brut + stocks brut + 445660 − DX − DY) — this is
 *   a SNAPSHOT (closing balance) here, vs. a DELTA there, but the two
 *   must agree: Δ(this module's BFR exploitation snapshot) must equal
 *   cash-flow-statement.ts's own variationCreancesClients+
 *   variationStocks+variationTvaDeductibleAutres−variationDettesExploitation.
 *   Asserted as a real tie-out (`assertBfrExploitationTiesToCashFlow`),
 *   not just "we hope they match" — same discipline as
 *   assertVncTiesToLedger's two-independently-sourced-numbers check.
 * - **BFR hors exploitation** = créances hors exploitation (462 +
 *   445662, the same two raw accounts cash-flow-statement.ts already
 *   carves out of BZ for investissement) minus dettes hors exploitation
 *   (DZ + EA). Deliberately narrow, same "flag, don't fake" discipline
 *   as cash-flow-statement.ts's own BZ exclusion: BZ's genuinely-opaque
 *   remainder (425/441/442/443/465) is excluded from BOTH BFR buckets,
 *   and so are DW/EB/CH/BV (avances/acomptes, charges/produits
 *   constatés d'avance) — no per-account signal exists to classify them
 *   as exploitation vs. hors exploitation without guessing. This means
 *   `bfrExploitation + bfrHorsExploitation` is NOT the same thing as
 *   "total actif circulant net − total passif circulant" — a deliberate,
 *   documented gap, not an oversight.
 * - **FR (fonds de roulement)** = ressources stables (capitaux propres,
 *   INCLUDING DK — provisions réglementées sit inside "Capitaux
 *   propres" on the real CERFA 2051 form, see LiassePage.tsx's own
 *   PASSIF_SECTIONS grouping — plus DP/DQ provisions pour risques et
 *   charges, plus DS/DT/DU/DV dettes financières) minus emplois stables
 *   (immobilisations nettes, IMMOBILISATION_BILAN_CODES, reused verbatim
 *   from liasse-articulation.ts, now exported for this reuse). **Known,
 *   pre-existing limitation carried over, not new**: DU commingles
 *   genuine long-term bank debt (164/165) with short-term concours
 *   bancaires courants (519) and the dual-nature-routed 512/514/516/517
 *   credit-balance overdraft amount — already flagged in CLAUDE.md's
 *   "Liasse fiscale / 2057" section for the exact same reason (2057's
 *   own maturity split can't separate them either). Treating DU as a
 *   single "dettes financières" figure here is only correct when no
 *   overdraft is folded into it — verified true on both test companies
 *   live (see CLAUDE.md), and the trésorerie-nette tie-out below is
 *   exactly the check that would surface it if it ever weren't.
 * - **Trésorerie nette = FR − BFR + provisionsSurActifCirculant**, computed
 *   this way and asserted equal to disponibilités read directly off the
 *   bilan (CF). The third term is load-bearing, not cosmetic — **found
 *   live, not by inspection**: a first version used FR − BFR alone and
 *   left a residual, non-reconciling gap of exactly 1 200,00 on the
 *   multi-year fixture, matching to the centime the SAME same-year
 *   dotation aux dépréciations clients douteux (491000/6817) that
 *   cash-flow-statement.ts's own brut-vs-net bug (see that module's doc
 *   comment) already surfaced once this session. The root cause here is
 *   a basis mismatch, not a new bug: BFR exploitation is deliberately
 *   GROSS (BX/stocks brut, matching cash-flow-statement.ts's own
 *   convention — see the bullet above), but FR's capitaux propres is
 *   NET (résultat already absorbed the dépréciation charge). The
 *   textbook FR−BFR=Trésorerie identity only holds when both sides use
 *   the same basis — `provisionsSurActifCirculant` (BX's own
 *   `amortissements` field, i.e. account 491/BY, plus the 5 stock
 *   lines' own `amortissements` fields, i.e. accounts 391-397/BM-BU) is
 *   EXACTLY the gap between BFR-gross and BFR-net, so adding it back
 *   corrects the basis mismatch at its source rather than plugging the
 *   residual. A strict generalization, not a special case: it's `0.00`
 *   whenever no dépréciation contra exists on these accounts (true for
 *   the FR demo company, confirmed live — the formula reduces to plain
 *   FR − BFR there, unchanged), and the BFR figures themselves (both
 *   the snapshot and their tie-out to cash-flow-statement.ts's ΔBFR)
 *   are completely untouched by this fix — this corrects the
 *   FR−BFR−trésorerie identity, not BFR itself.
 * - **Free cash flow** = cash-flow-statement.ts's own
 *   fluxExploitation.total minus the SAME cashPaidForAcquisitions figure
 *   already computed inside computeCashFlowStatement (re-derived here
 *   from FluxInvestissement's own public fields —
 *   acquisitionsImmobilisations + variationTvaDeductibleImmobilisations
 *   − variationDettesSurImmobilisations — rather than a second raw
 *   ledger query, so it's mechanically guaranteed to match).
 * - **Endettement net** = dettes financières (DS+DT+DU+DV) − disponibilités
 *   (CF) − valeurs mobilières de placement (CD, net of CE dépréciation) —
 *   VMP included as quasi-cash, a common, documented analyst convention,
 *   not a silent guess. **Capitaux propres** (book equity) = the same
 *   "capitaux propres" bucket used for FR's ressources stables (DA..DK)
 *   plus DI (résultat de l'exercice). **Book EV** = capitaux propres +
 *   endettement net — book-based, explicitly NOT a valuation (no market
 *   price, no multiple, no discount rate anywhere in this figure).
 * - **Cost of debt** = charges d'intérêts (GR) / dettes financières —
 *   `null` ("n/a") when dettes financières is exactly 0.00, never a
 *   divide-by-zero. Money is discretized to the centime in this app, so
 *   there is no meaningful "near-zero but not exactly zero" case to
 *   guard separately — exactly zero is the only way a real
 *   divide-by-zero could occur here.
 * - **"Marge brute"**, the one genuinely ambiguous term in the build
 *   instruction, resolved as: marge commerciale ÷ chiffre d'affaires
 *   (not ÷ ventes de marchandises alone) — consistent with the other
 *   three margins (EBE, exploitation, nette), all expressed as a % of
 *   the SAME chiffre d'affaires denominator (FC+FF+FI), so the four
 *   margins are directly comparable to each other. A formula choice,
 *   documented explicitly, not a hidden assumption.
 * - **DSO/DPO/rotation des stocks** use créances/dettes/stocks BRUT
 *   (TTC, as posted) against chiffre d'affaires/achats HT (no VAT line)
 *   — a standard, widely-used simplification (documented, not hidden):
 *   a fully VTA-consistent day-count would require assuming a blended
 *   VAT rate, which is exactly the kind of assumption this module
 *   avoids by design.
 * - **"Rentabilité d'exploitation"** (listed under ratios) and "marge
 *   d'exploitation" (listed under margins) are the SAME formula
 *   (résultat d'exploitation ÷ CA) — intentionally cross-listed under
 *   both headings, a common practice in French financial-analysis
 *   taxonomy, not a duplication bug.
 */

const CLIENTS_CODE = 'BX';
const STOCK_CODES = ['BL', 'BN', 'BP', 'BR', 'BT'];
const DETTES_EXPLOITATION_CODES = ['DX', 'DY'];
const DETTES_IMMOBILISATIONS_CODE = 'DZ';
const AUTRES_DETTES_CODE = 'EA';
const DETTES_COURT_TERME_CODES = ['DW', 'DX', 'DY', 'DZ', 'EA', 'EB'];
/** DK (provisions réglementées) belongs here, not with DP/DQ — see module doc comment. */
const CAPITAUX_PROPRES_CODES = ['DA', 'DB', 'DC', 'DD', 'DE', 'DF', 'DG', 'DH', 'DJ', 'DK'];
const PROVISIONS_RISQUES_CHARGES_CODES = ['DP', 'DQ'];
const DETTES_FINANCIERES_CODES = ['DS', 'DT', 'DU', 'DV'];
const DISPONIBILITES_CODE = 'CF';
const VMP_CODE = 'CD';

function brutActif(bilan: Bilan2050, codes: string[]): Money {
  return codes.reduce((sum, code) => {
    const line = bilan.actif.find((l) => l.code === code);
    return sum.plus(line ? Money.fromString(line.brut) : Money.zero());
  }, Money.zero());
}

function netActif(bilan: Bilan2050, codes: string[]): Money {
  return codes.reduce((sum, code) => {
    const line = bilan.actif.find((l) => l.code === code);
    return sum.plus(line ? Money.fromString(line.net) : Money.zero());
  }, Money.zero());
}

/** A line's own dépréciation contra (e.g. BX's `.amortissements` field is account 491/BY) — see provisionsSurActifCirculant. */
function amortActif(bilan: Bilan2050, codes: string[]): Money {
  return codes.reduce((sum, code) => {
    const line = bilan.actif.find((l) => l.code === code);
    return sum.plus(line ? Money.fromString(line.amortissements) : Money.zero());
  }, Money.zero());
}

function montantPassif(bilan: Bilan2050, codes: string[]): Money {
  return codes.reduce((sum, code) => {
    const line = bilan.passif.find((l) => l.code === code);
    return sum.plus(line ? Money.fromString(line.montant) : Money.zero());
  }, Money.zero());
}

function cdrMontant(cdr: CompteResultat2052_2053, code: string): Money {
  const ligne = cdr.lignes.find((l) => l.code === code);
  return ligne ? Money.fromString(ligne.montant) : Money.zero();
}

/** Dimensionless ratio, 4-decimal precision — null ("n/a") when the denominator is exactly zero. */
function ratioOrNull(numerator: Money, denominator: Money): string | null {
  if (denominator.isZero()) return null;
  return numerator.toDecimal().dividedBy(denominator.toDecimal()).toFixed(4);
}

/** Percentage string (e.g. "12.34" meaning 12.34%) — null ("n/a") when the denominator is exactly zero. */
function percentOrNull(numerator: Money, denominator: Money): string | null {
  if (denominator.isZero()) return null;
  return numerator.toDecimal().dividedBy(denominator.toDecimal()).times(100).toFixed(2);
}

/** Day count (e.g. "45.2" jours) — null ("n/a") when the denominator is exactly zero. */
function daysOrNull(numerator: Money, denominator: Money): string | null {
  if (denominator.isZero()) return null;
  return numerator.toDecimal().dividedBy(denominator.toDecimal()).times(365).toFixed(1);
}

export interface SigCascade {
  margeCommerciale: string;
  productionDeLExercice: string;
  consommationsEnProvenanceDesTiers: string;
  valeurAjoutee: string;
  ebe: string;
  resultatExploitation: string;
  resultatFinancier: string;
  resultatCourantAvantImpots: string;
  resultatExceptionnel: string;
  resultatNet: string;
}

/**
 * Each solde is built purely from CDR_RULES line codes (compte-resultat-2052-2053.ts), run through
 * the SAME account-classification the compliance form already uses. `resultatExploitation` is
 * reconstructed independently from the cascade's own building blocks and asserted equal to the
 * CDR's own resultatExploitation (GG) — algebraically guaranteed by construction (the cascade's
 * codes partition exactly into totalProduitsExploitation/totalChargesExploitation), but asserted
 * anyway so a future edit that drops or mistypes a code is caught immediately, not silently wrong.
 */
function computeSigCascade(cdr: CompteResultat2052_2053): SigCascade {
  const margeCommerciale = cdrMontant(cdr, 'FC')
    .minus(cdrMontant(cdr, 'FS'))
    .minus(cdrMontant(cdr, 'FT'));
  const productionDeLExercice = cdrMontant(cdr, 'FF')
    .plus(cdrMontant(cdr, 'FI'))
    .plus(cdrMontant(cdr, 'FM'))
    .plus(cdrMontant(cdr, 'FN'));
  const consommationsEnProvenanceDesTiers = cdrMontant(cdr, 'FU')
    .plus(cdrMontant(cdr, 'FV'))
    .plus(cdrMontant(cdr, 'FW'));
  const valeurAjoutee = margeCommerciale
    .plus(productionDeLExercice)
    .minus(consommationsEnProvenanceDesTiers);
  const ebe = valeurAjoutee
    .plus(cdrMontant(cdr, 'FO'))
    .minus(cdrMontant(cdr, 'FX'))
    .minus(cdrMontant(cdr, 'FY'))
    .minus(cdrMontant(cdr, 'FZ'));
  const resultatExploitationCascade = ebe
    .plus(cdrMontant(cdr, 'FP'))
    .plus(cdrMontant(cdr, 'F1'))
    .plus(cdrMontant(cdr, 'FQ'))
    .minus(cdrMontant(cdr, 'GA'))
    .minus(cdrMontant(cdr, 'GB'))
    .minus(cdrMontant(cdr, 'GC'))
    .minus(cdrMontant(cdr, 'GD'))
    .minus(cdrMontant(cdr, 'G1'))
    .minus(cdrMontant(cdr, 'GE'));

  const resultatExploitationCdr = Money.fromString(cdr.resultatExploitation);
  if (!resultatExploitationCascade.equals(resultatExploitationCdr)) {
    throw new ConflictException(
      `SIG cascade's résultat d'exploitation (${resultatExploitationCascade.toApiString()}) does not ` +
        `equal the compte de résultat's own résultat d'exploitation (${resultatExploitationCdr.toApiString()}). ` +
        "This means the cascade's line-code groupings have drifted from CDR_RULES's own exploitation " +
        'totals — a mapping bug, never a case to silently accept.',
    );
  }

  return {
    margeCommerciale: margeCommerciale.toApiString(),
    productionDeLExercice: productionDeLExercice.toApiString(),
    consommationsEnProvenanceDesTiers: consommationsEnProvenanceDesTiers.toApiString(),
    valeurAjoutee: valeurAjoutee.toApiString(),
    ebe: ebe.toApiString(),
    resultatExploitation: resultatExploitationCdr.toApiString(),
    resultatFinancier: cdr.resultatFinancier,
    resultatCourantAvantImpots: cdr.resultatCourantAvantImpots,
    resultatExceptionnel: cdr.resultatExceptionnel,
    resultatNet: cdr.beneficeOuPerte,
  };
}

export interface Margins {
  /** CA = FC (ventes marchandises) + FF (production vendue biens) + FI (production vendue services). */
  chiffreDAffaires: string;
  margeBrute: string | null;
  margeEbe: string | null;
  margeExploitation: string | null;
  margeNette: string | null;
}

function computeMargins(cdr: CompteResultat2052_2053, sig: SigCascade): Margins {
  const ca = cdrMontant(cdr, 'FC').plus(cdrMontant(cdr, 'FF')).plus(cdrMontant(cdr, 'FI'));
  return {
    chiffreDAffaires: ca.toApiString(),
    margeBrute: percentOrNull(Money.fromString(sig.margeCommerciale), ca),
    margeEbe: percentOrNull(Money.fromString(sig.ebe), ca),
    margeExploitation: percentOrNull(Money.fromString(sig.resultatExploitation), ca),
    margeNette: percentOrNull(Money.fromString(sig.resultatNet), ca),
  };
}

function computeBfrExploitation(bilan: Bilan2050, tvaDeductibleAutres: Money): Money {
  return brutActif(bilan, [CLIENTS_CODE])
    .plus(brutActif(bilan, STOCK_CODES))
    .plus(tvaDeductibleAutres)
    .minus(montantPassif(bilan, DETTES_EXPLOITATION_CODES));
}

function computeBfrHorsExploitation(
  bilan: Bilan2050,
  creancesSurCessions: Money,
  tvaDeductibleImmobilisations: Money,
): Money {
  return creancesSurCessions
    .plus(tvaDeductibleImmobilisations)
    .minus(montantPassif(bilan, [DETTES_IMMOBILISATIONS_CODE]))
    .minus(montantPassif(bilan, [AUTRES_DETTES_CODE]));
}

export interface BfrSnapshot {
  bfrExploitation: string;
  bfrHorsExploitation: string;
  bfrTotal: string;
}

/**
 * THE tie-out to cash-flow-statement.ts: Δ(BFR exploitation snapshot, opening→closing) must equal
 * that module's own embedded ΔBFR (variationCreancesClients+variationStocks+
 * variationTvaDeductibleAutres−variationDettesExploitation) — same accounts, same gross-receivables
 * convention, two consumers, must agree. Returns the closing snapshot for the caller to use.
 */
function assertBfrExploitationTiesToCashFlow(input: {
  openingBilan: Bilan2050;
  closingBilan: Bilan2050;
  openingTvaDeductibleAutres: Money;
  closingTvaDeductibleAutres: Money;
  cashFlowStatement: CashFlowStatement;
}): Money {
  const bfrExploitationOpening = computeBfrExploitation(
    input.openingBilan,
    input.openingTvaDeductibleAutres,
  );
  const bfrExploitationClosing = computeBfrExploitation(
    input.closingBilan,
    input.closingTvaDeductibleAutres,
  );
  const deltaBfrExploitation = bfrExploitationClosing.minus(bfrExploitationOpening);

  const flux = input.cashFlowStatement.fluxExploitation;
  const deltaBfrFromCashFlow = Money.fromString(flux.variationCreancesClients)
    .plus(Money.fromString(flux.variationStocks))
    .plus(Money.fromString(flux.variationTvaDeductibleAutres))
    .minus(Money.fromString(flux.variationDettesExploitation));

  if (!deltaBfrExploitation.equals(deltaBfrFromCashFlow)) {
    throw new ConflictException(
      `BFR exploitation's own Δ (${deltaBfrExploitation.toApiString()}) does not equal the tableau ` +
        `des flux de trésorerie's embedded ΔBFR (${deltaBfrFromCashFlow.toApiString()}). These two ` +
        'modules must agree — same accounts, same gross-receivables convention — so a mismatch means ' +
        'one of the two formulas has drifted from the other, never a case to silently accept.',
    );
  }

  return bfrExploitationClosing;
}

export interface FondsDeRoulement {
  ressourcesStables: string;
  emploisStables: string;
  fondsDeRoulement: string;
}

function bookCapitauxPropres(bilan: Bilan2050): Money {
  return montantPassif(bilan, CAPITAUX_PROPRES_CODES).plus(
    Money.fromString(bilan.resultatDeLExercice),
  );
}

function computeFondsDeRoulement(bilan: Bilan2050): FondsDeRoulement {
  const capitauxPropres = bookCapitauxPropres(bilan);
  const provisions = montantPassif(bilan, PROVISIONS_RISQUES_CHARGES_CODES);
  const dettesFinancieres = montantPassif(bilan, DETTES_FINANCIERES_CODES);
  const ressourcesStables = capitauxPropres.plus(provisions).plus(dettesFinancieres);
  const emploisStables = netActif(bilan, IMMOBILISATION_BILAN_CODES);
  return {
    ressourcesStables: ressourcesStables.toApiString(),
    emploisStables: emploisStables.toApiString(),
    fondsDeRoulement: ressourcesStables.minus(emploisStables).toApiString(),
  };
}

export interface TresorerieNette {
  /** FR − BFR + provisionsSurActifCirculant — see module doc comment for why the third term is needed. */
  parFrMoinsBfr: string;
  /** BX's own amortissements (491/BY) + the 5 stock lines' own amortissements (391-397/BM-BU) — the exact basis gap between BFR-gross and BFR-net. */
  provisionsSurActifCirculant: string;
  disponibilites: string;
}

function computeProvisionsSurActifCirculant(bilan: Bilan2050): Money {
  return amortActif(bilan, [CLIENTS_CODE, ...STOCK_CODES]);
}

function computeTresorerieNette(fr: string, bfrTotal: string, bilan: Bilan2050): TresorerieNette {
  const provisionsSurActifCirculant = computeProvisionsSurActifCirculant(bilan);
  const parFrMoinsBfr = Money.fromString(fr)
    .minus(Money.fromString(bfrTotal))
    .plus(provisionsSurActifCirculant);
  return {
    parFrMoinsBfr: parFrMoinsBfr.toApiString(),
    provisionsSurActifCirculant: provisionsSurActifCirculant.toApiString(),
    disponibilites: netActif(bilan, [DISPONIBILITES_CODE]).toApiString(),
  };
}

/** See module doc comment — this identity holds exactly when DU carries no real overdraft (a separate, still-open caveat). */
function assertTresorerieTies(tresorerie: TresorerieNette): void {
  if (
    !Money.fromString(tresorerie.parFrMoinsBfr).equals(Money.fromString(tresorerie.disponibilites))
  ) {
    throw new ConflictException(
      `Trésorerie nette via FR − BFR + provisionsSurActifCirculant (${tresorerie.parFrMoinsBfr}) ` +
        `does not equal disponibilités lues directement sur le bilan (${tresorerie.disponibilites}). ` +
        'This can happen when a bank overdraft (concours bancaires courants, compte 519, or a ' +
        'credit-balance 512/514/516/517 account) is commingled into DU alongside genuine long-term ' +
        'bank debt — a known, pre-existing limitation (see CLAUDE.md "Liasse fiscale / 2057" for the ' +
        'same DU commingling flagged there) — never a case to silently accept without checking which.',
    );
  }
}

export interface FreeCashFlow {
  fluxExploitation: string;
  cashPaidForAcquisitions: string;
  freeCashFlow: string;
}

/** Re-derives cashPaidForAcquisitions from FluxInvestissement's own public fields — never a second raw query, so it's mechanically guaranteed to match cash-flow-statement.ts's own internal figure. */
function computeFreeCashFlow(cashFlowStatement: CashFlowStatement): FreeCashFlow {
  const fluxExploitation = Money.fromString(cashFlowStatement.fluxExploitation.total);
  const investissement = cashFlowStatement.fluxInvestissement;
  const cashPaidForAcquisitions = Money.fromString(investissement.acquisitionsImmobilisations)
    .plus(Money.fromString(investissement.variationTvaDeductibleImmobilisations))
    .minus(Money.fromString(investissement.variationDettesSurImmobilisations));
  return {
    fluxExploitation: fluxExploitation.toApiString(),
    cashPaidForAcquisitions: cashPaidForAcquisitions.toApiString(),
    freeCashFlow: fluxExploitation.minus(cashPaidForAcquisitions).toApiString(),
  };
}

export interface EndettementEtCapitaux {
  dettesFinancieres: string;
  /** CF + CD (VMP, net) — VMP included as quasi-cash, a documented convention, see module doc comment. */
  tresorerieEtEquivalents: string;
  endettementNet: string;
  capitauxPropres: string;
  /** Book-based (equity + net debt) — NOT a valuation. See module doc comment. */
  bookEnterpriseValue: string;
}

function computeEndettementEtCapitaux(bilan: Bilan2050): EndettementEtCapitaux {
  const dettesFinancieres = montantPassif(bilan, DETTES_FINANCIERES_CODES);
  const tresorerieEtEquivalents = netActif(bilan, [DISPONIBILITES_CODE, VMP_CODE]);
  const endettementNet = dettesFinancieres.minus(tresorerieEtEquivalents);
  const capitauxPropres = bookCapitauxPropres(bilan);
  return {
    dettesFinancieres: dettesFinancieres.toApiString(),
    tresorerieEtEquivalents: tresorerieEtEquivalents.toApiString(),
    endettementNet: endettementNet.toApiString(),
    capitauxPropres: capitauxPropres.toApiString(),
    bookEnterpriseValue: capitauxPropres.plus(endettementNet).toApiString(),
  };
}

export interface CoutDeLaDette {
  chargesDInteret: string;
  dettesFinancieres: string;
  /** null ("n/a") when dettesFinancieres is exactly 0.00 — see module doc comment. */
  taux: string | null;
}

function computeCoutDeLaDette(
  cdr: CompteResultat2052_2053,
  dettesFinancieres: Money,
): CoutDeLaDette {
  const chargesDInteret = cdrMontant(cdr, 'GR');
  return {
    chargesDInteret: chargesDInteret.toApiString(),
    dettesFinancieres: dettesFinancieres.toApiString(),
    taux: percentOrNull(chargesDInteret, dettesFinancieres),
  };
}

export interface Ratios {
  liquiditeGenerale: string | null;
  liquiditeReduite: string | null;
  gearing: string | null;
  autonomieFinanciere: string | null;
  roe: string | null;
  roa: string | null;
  roce: string | null;
  /** Same formula as margins.margeExploitation — intentionally cross-listed, see module doc comment. */
  rentabiliteExploitation: string | null;
  dsoClients: string | null;
  dpoFournisseurs: string | null;
  rotationStocks: string | null;
}

/** FS+FT (achats de marchandises + leur variation de stock) + FU+FV+FW (consommations en provenance des tiers) — the DPO/rotation-stocks denominator, the full "coût des achats" the SIG cascade's own line codes cover. */
function computeCoutDesAchats(cdr: CompteResultat2052_2053): Money {
  return cdrMontant(cdr, 'FS')
    .plus(cdrMontant(cdr, 'FT'))
    .plus(cdrMontant(cdr, 'FU'))
    .plus(cdrMontant(cdr, 'FV'))
    .plus(cdrMontant(cdr, 'FW'));
}

function computeRatios(input: {
  bilan: Bilan2050;
  sig: SigCascade;
  endettementEtCapitaux: EndettementEtCapitaux;
  ca: Money;
  coutDesAchats: Money;
}): Ratios {
  const { bilan, sig, endettementEtCapitaux, ca, coutDesAchats } = input;
  const actifCirculant = Money.fromString(bilan.totalActifNet).minus(
    netActif(bilan, IMMOBILISATION_BILAN_CODES),
  );
  const stocksNet = netActif(bilan, STOCK_CODES);
  const dettesCourtTerme = montantPassif(bilan, DETTES_COURT_TERME_CODES);
  const totalBilan = Money.fromString(bilan.totalPassif);
  const capitauxPropres = Money.fromString(endettementEtCapitaux.capitauxPropres);
  const resultatNet = Money.fromString(sig.resultatNet);
  const resultatExploitation = Money.fromString(sig.resultatExploitation);
  const bookEnterpriseValue = Money.fromString(endettementEtCapitaux.bookEnterpriseValue);
  const clientsBrut = brutActif(bilan, [CLIENTS_CODE]);
  const dettesFournisseurs = montantPassif(bilan, ['DX']);
  const stocksBrut = brutActif(bilan, STOCK_CODES);

  return {
    liquiditeGenerale: ratioOrNull(actifCirculant, dettesCourtTerme),
    liquiditeReduite: ratioOrNull(actifCirculant.minus(stocksNet), dettesCourtTerme),
    gearing: percentOrNull(Money.fromString(endettementEtCapitaux.endettementNet), capitauxPropres),
    autonomieFinanciere: percentOrNull(capitauxPropres, totalBilan),
    roe: percentOrNull(resultatNet, capitauxPropres),
    roa: percentOrNull(resultatNet, totalBilan),
    roce: percentOrNull(resultatExploitation, bookEnterpriseValue),
    rentabiliteExploitation: percentOrNull(resultatExploitation, ca),
    dsoClients: daysOrNull(clientsBrut, ca),
    dpoFournisseurs: daysOrNull(dettesFournisseurs, coutDesAchats),
    rotationStocks: daysOrNull(stocksBrut, coutDesAchats),
  };
}

export interface FinancialAnalysisResult {
  sig: SigCascade;
  margins: Margins;
  bfr: BfrSnapshot;
  fondsDeRoulement: FondsDeRoulement;
  tresorerieNette: TresorerieNette;
  freeCashFlow: FreeCashFlow;
  endettementEtCapitaux: EndettementEtCapitaux;
  coutDeLaDette: CoutDeLaDette;
  ratios: Ratios;
}

export interface FinancialAnalysisInput {
  openingBilan: Bilan2050;
  closingBilan: Bilan2050;
  closingCompteResultat: CompteResultat2052_2053;
  cashFlowStatement: CashFlowStatement;
  openingTvaDeductibleAutres: Money;
  closingTvaDeductibleAutres: Money;
  closingTvaDeductibleImmobilisations: Money;
  closingCreancesSurCessions: Money;
}

/** Pure computation, no I/O. */
export function computeFinancialAnalysis(input: FinancialAnalysisInput): FinancialAnalysisResult {
  const sig = computeSigCascade(input.closingCompteResultat);
  const margins = computeMargins(input.closingCompteResultat, sig);

  const bfrExploitationClosing = assertBfrExploitationTiesToCashFlow({
    openingBilan: input.openingBilan,
    closingBilan: input.closingBilan,
    openingTvaDeductibleAutres: input.openingTvaDeductibleAutres,
    closingTvaDeductibleAutres: input.closingTvaDeductibleAutres,
    cashFlowStatement: input.cashFlowStatement,
  });
  const bfrHorsExploitation = computeBfrHorsExploitation(
    input.closingBilan,
    input.closingCreancesSurCessions,
    input.closingTvaDeductibleImmobilisations,
  );
  const bfr: BfrSnapshot = {
    bfrExploitation: bfrExploitationClosing.toApiString(),
    bfrHorsExploitation: bfrHorsExploitation.toApiString(),
    bfrTotal: bfrExploitationClosing.plus(bfrHorsExploitation).toApiString(),
  };

  const fondsDeRoulement = computeFondsDeRoulement(input.closingBilan);
  const tresorerieNette = computeTresorerieNette(
    fondsDeRoulement.fondsDeRoulement,
    bfr.bfrTotal,
    input.closingBilan,
  );
  assertTresorerieTies(tresorerieNette);

  const freeCashFlow = computeFreeCashFlow(input.cashFlowStatement);
  const endettementEtCapitaux = computeEndettementEtCapitaux(input.closingBilan);
  const coutDeLaDette = computeCoutDeLaDette(
    input.closingCompteResultat,
    Money.fromString(endettementEtCapitaux.dettesFinancieres),
  );
  const ratios = computeRatios({
    bilan: input.closingBilan,
    sig,
    endettementEtCapitaux,
    ca: Money.fromString(margins.chiffreDAffaires),
    coutDesAchats: computeCoutDesAchats(input.closingCompteResultat),
  });

  return {
    sig,
    margins,
    bfr,
    fondsDeRoulement,
    tresorerieNette,
    freeCashFlow,
    endettementEtCapitaux,
    coutDeLaDette,
    ratios,
  };
}
