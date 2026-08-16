import { ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { Bilan2050 } from '../liasse/bilan-2050';
import { CompteResultat2052_2053 } from '../liasse/compte-resultat-2052-2053';
import { CESSION_PRODUIT_CODES, CESSION_CHARGE_CODES } from '../liasse/liasse-articulation';

/**
 * Tableau des flux de trésorerie, méthode indirecte. Not a CERFA form —
 * no "spec" PDF to quote — the user gave the structure directly. Reads
 * two already-computed Bilan2050s (opening and closing) plus the closing
 * CompteResultat2052_2053; never re-reads the ledger itself. See
 * CashFlowService for where the opening/closing bilans come from (the
 * opening one is derived from the fiscal year's own à-nouveau lines, not
 * an independently-generated prior-year liasse — see that module's doc
 * comment for why).
 *
 * Scope decisions, all deliberate:
 * - BFR movement only covers BX (clients), the 5 stock lines, and DX+DY
 *   (dettes fournisseurs/fiscales/sociales) — BZ ("autres créances") is
 *   excluded entirely because it commingles genuinely-operating items
 *   (TVA déductible) with non-operating ones (462, créances sur
 *   cessions) that bilan-2050.ts's line mapping can't separate; folding
 *   it into BFR would silently mix an investing-flow item into the
 *   exploitation section.
 * - BX and the stock lines' BFR movement uses GROSS (brut) values, never
 *   BilanActifLigne.net — found live, not by inspection: a first version
 *   used .net and left a reconciliation gap of exactly 1200.00 on the
 *   multi-year fixture, matching to the centime a same-year dotation aux
 *   dépréciations clients douteux (6817/491000). CAF already reintegrates
 *   every dépréciation dotation/reprise on stocks and créances as a
 *   non-cash item via GC/FP (see dotationsAmortissementsProvisions/
 *   reprisesAmortissementsProvisions below) — that addback treats the
 *   full dotation as if the receivable/stock were untouched. Subtracting
 *   the NET (already-reduced-by-that-same-dotation) closing balance in
 *   the BFR line then only captures part of the true uncollected amount,
 *   silently pocketing the rest. Using .brut for these two lines is the
 *   standard French tableau-de-financement convention for exactly this
 *   reason, not a workaround specific to this bug.
 * - Investing cash actually paid/received nets against Δ404/405 (DZ, a
 *   clean dedicated bilan line) and Δ462 (NOT clean — 462 is one of
 *   several accounts folded into BZ, so it must be supplied separately
 *   as a raw account balance, not read off the bilan) — an asset bought
 *   or sold partly on credit doesn't move cash until the receivable/
 *   payable is settled.
 * - `produitsCession`/`chargesCessionVNC` reuse CESSION_PRODUIT_CODES/
 *   CESSION_CHARGE_CODES (F1/G2/HD and G1/G3/HH) exactly as
 *   liasse-articulation.ts's 2059-A tie-out already does — including
 *   that tie-out's own known imprecision (HD/HH also catch non-cession
 *   exceptional items, e.g. amendes, dons). Not a new gap: the same
 *   simplification this codebase already accepted for 2059-A.
 * - `distributions` is always "0.00" — no affectation-du-résultat
 *   mechanism exists anywhere in this app (à-nouveau carries the whole
 *   prior result into 120/129 with no distribution/réserve split), so
 *   there is nothing to read. A documented, permanent gap, not a guess.
 */

const CLIENTS_CODE = 'BX';
const STOCK_CODES = ['BL', 'BN', 'BP', 'BR', 'BT'];
const DETTES_EXPLOITATION_CODES = ['DX', 'DY'];
const DETTES_IMMOBILISATIONS_CODE = 'DZ';
const EMPRUNTS_CODES = ['DS', 'DT', 'DU', 'DV'];
const CAPITAL_CODE = 'DA';
const DISPONIBILITES_CODE = 'CF';

function netActif(bilan: Bilan2050, codes: string[]): Money {
  return codes.reduce((sum, code) => {
    const line = bilan.actif.find((l) => l.code === code);
    return sum.plus(line ? Money.fromString(line.net) : Money.zero());
  }, Money.zero());
}

/** Gross (avant dépréciation) — see module doc comment for why BFR uses this, not netActif. */
function brutActif(bilan: Bilan2050, codes: string[]): Money {
  return codes.reduce((sum, code) => {
    const line = bilan.actif.find((l) => l.code === code);
    return sum.plus(line ? Money.fromString(line.brut) : Money.zero());
  }, Money.zero());
}

function montantPassif(bilan: Bilan2050, codes: string[]): Money {
  return codes.reduce((sum, code) => {
    const line = bilan.passif.find((l) => l.code === code);
    return sum.plus(line ? Money.fromString(line.montant) : Money.zero());
  }, Money.zero());
}

export interface CashFlowStatementInput {
  openingBilan: Bilan2050;
  closingBilan: Bilan2050;
  closingCompteResultat: CompteResultat2052_2053;
  /** Σ FixedAsset.acquisitionValue for assets whose acquisitionDate falls within the reported fiscal year. */
  acquisitionsImmobilisations: Money;
  /** Σ FixedAsset.cessionPrice for assets whose cessionDate falls within the reported fiscal year. */
  cessionsImmobilisations: Money;
  /** Raw account 462 ("Créances sur cessions d'immobilisations") balance at fiscal-year start — not derivable from Bilan2050, which folds 462 into BZ alongside unrelated accounts. */
  openingCreancesSurCessions: Money;
  /** Same, at fiscal-year end. */
  closingCreancesSurCessions: Money;
}

export interface FluxExploitation {
  resultatNet: string;
  dotationsAmortissementsProvisions: string;
  reprisesAmortissementsProvisions: string;
  valeurComptableElementsCedes: string;
  produitsDesCessions: string;
  capaciteAutofinancement: string;
  variationCreancesClients: string;
  variationStocks: string;
  variationDettesExploitation: string;
  total: string;
}

export interface FluxInvestissement {
  acquisitionsImmobilisations: string;
  variationDettesSurImmobilisations: string;
  cessionsImmobilisations: string;
  variationCreancesSurCessions: string;
  total: string;
}

export interface FluxFinancement {
  variationEmprunts: string;
  variationCapital: string;
  /** Always "0.00" — see module doc comment. */
  distributions: string;
  total: string;
}

export interface CashFlowStatement {
  fluxExploitation: FluxExploitation;
  fluxInvestissement: FluxInvestissement;
  fluxFinancement: FluxFinancement;
  /** Sum of the three sections' totals — must equal tresorerieCloture − tresorerieOuverture, see assertCashFlowReconciles. */
  variationTresorerie: string;
  tresorerieOuverture: string;
  tresorerieCloture: string;
}

/** Pure computation, no I/O. */
export function computeCashFlowStatement(input: CashFlowStatementInput): CashFlowStatement {
  const {
    openingBilan,
    closingBilan,
    closingCompteResultat,
    acquisitionsImmobilisations,
    cessionsImmobilisations,
    openingCreancesSurCessions,
    closingCreancesSurCessions,
  } = input;

  const montantByCode = new Map(closingCompteResultat.lignes.map((l) => [l.code, l.montant]));
  const get = (code: string) => Money.fromString(montantByCode.get(code) ?? '0.00');

  const resultatNet = Money.fromString(closingCompteResultat.beneficeOuPerte);
  const dotationsAmortissementsProvisions = get('GA')
    .plus(get('GB'))
    .plus(get('GC'))
    .plus(get('GD'))
    .plus(get('GQ'));
  const reprisesAmortissementsProvisions = get('FP').plus(get('GM'));
  const produitsDesCessions = CESSION_PRODUIT_CODES.reduce(
    (sum, code) => sum.plus(get(code)),
    Money.zero(),
  );
  const valeurComptableElementsCedes = CESSION_CHARGE_CODES.reduce(
    (sum, code) => sum.plus(get(code)),
    Money.zero(),
  );

  const capaciteAutofinancement = resultatNet
    .plus(dotationsAmortissementsProvisions)
    .plus(valeurComptableElementsCedes)
    .minus(reprisesAmortissementsProvisions)
    .minus(produitsDesCessions);

  const variationCreancesClients = brutActif(closingBilan, [CLIENTS_CODE]).minus(
    brutActif(openingBilan, [CLIENTS_CODE]),
  );
  const variationStocks = brutActif(closingBilan, STOCK_CODES).minus(
    brutActif(openingBilan, STOCK_CODES),
  );
  const variationDettesExploitation = montantPassif(closingBilan, DETTES_EXPLOITATION_CODES).minus(
    montantPassif(openingBilan, DETTES_EXPLOITATION_CODES),
  );

  const totalExploitation = capaciteAutofinancement
    .minus(variationCreancesClients)
    .minus(variationStocks)
    .plus(variationDettesExploitation);

  const variationDettesSurImmobilisations = montantPassif(closingBilan, [
    DETTES_IMMOBILISATIONS_CODE,
  ]).minus(montantPassif(openingBilan, [DETTES_IMMOBILISATIONS_CODE]));
  const variationCreancesSurCessions = closingCreancesSurCessions.minus(openingCreancesSurCessions);

  const cashPaidForAcquisitions = acquisitionsImmobilisations.minus(
    variationDettesSurImmobilisations,
  );
  const cashReceivedFromCessions = cessionsImmobilisations.minus(variationCreancesSurCessions);
  const totalInvestissement = cashReceivedFromCessions.minus(cashPaidForAcquisitions);

  const variationEmprunts = montantPassif(closingBilan, EMPRUNTS_CODES).minus(
    montantPassif(openingBilan, EMPRUNTS_CODES),
  );
  const variationCapital = montantPassif(closingBilan, [CAPITAL_CODE]).minus(
    montantPassif(openingBilan, [CAPITAL_CODE]),
  );
  const distributions = Money.zero();
  const totalFinancement = variationEmprunts.plus(variationCapital).plus(distributions);

  const variationTresorerie = totalExploitation.plus(totalInvestissement).plus(totalFinancement);

  const tresorerieOuverture = netActif(openingBilan, [DISPONIBILITES_CODE]);
  const tresorerieCloture = netActif(closingBilan, [DISPONIBILITES_CODE]);

  return {
    fluxExploitation: {
      resultatNet: resultatNet.toApiString(),
      dotationsAmortissementsProvisions: dotationsAmortissementsProvisions.toApiString(),
      reprisesAmortissementsProvisions: reprisesAmortissementsProvisions.toApiString(),
      valeurComptableElementsCedes: valeurComptableElementsCedes.toApiString(),
      produitsDesCessions: produitsDesCessions.toApiString(),
      capaciteAutofinancement: capaciteAutofinancement.toApiString(),
      variationCreancesClients: variationCreancesClients.toApiString(),
      variationStocks: variationStocks.toApiString(),
      variationDettesExploitation: variationDettesExploitation.toApiString(),
      total: totalExploitation.toApiString(),
    },
    fluxInvestissement: {
      acquisitionsImmobilisations: acquisitionsImmobilisations.toApiString(),
      variationDettesSurImmobilisations: variationDettesSurImmobilisations.toApiString(),
      cessionsImmobilisations: cessionsImmobilisations.toApiString(),
      variationCreancesSurCessions: variationCreancesSurCessions.toApiString(),
      total: totalInvestissement.toApiString(),
    },
    fluxFinancement: {
      variationEmprunts: variationEmprunts.toApiString(),
      variationCapital: variationCapital.toApiString(),
      distributions: distributions.toApiString(),
      total: totalFinancement.toApiString(),
    },
    variationTresorerie: variationTresorerie.toApiString(),
    tresorerieOuverture: tresorerieOuverture.toApiString(),
    tresorerieCloture: tresorerieCloture.toApiString(),
  };
}

/**
 * THE oracle: the sum of the three flux sections must equal the actual
 * Δtrésorerie between the opening and closing bilan (both independently
 * derived — opening from the fiscal year's own à-nouveau lines, closing
 * from the full fiscal year's validated ledger). Same discipline as
 * assertBilanBalances: a mismatch means a real error upstream (a cash
 * movement that didn't post through one of the three sections' source
 * accounts), never plugged or silently accepted.
 */
export function assertCashFlowReconciles(statement: CashFlowStatement): void {
  const variationTresorerie = Money.fromString(statement.variationTresorerie);
  const actualDelta = Money.fromString(statement.tresorerieCloture).minus(
    Money.fromString(statement.tresorerieOuverture),
  );
  if (!variationTresorerie.equals(actualDelta)) {
    throw new ConflictException(
      `Tableau des flux de trésorerie ne réconcilie pas : la somme des trois flux ` +
        `(${variationTresorerie.toApiString()}) ne correspond pas à la variation réelle de ` +
        `trésorerie (${statement.tresorerieOuverture} → ${statement.tresorerieCloture}, soit ` +
        `${actualDelta.toApiString()}). Cela signifie qu'un mouvement de trésorerie n'a pas été ` +
        "correctement classé dans l'un des trois flux — jamais un cas à corriger en forçant la valeur.",
    );
  }
}
