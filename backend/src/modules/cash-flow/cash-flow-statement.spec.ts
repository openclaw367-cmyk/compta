import { Money } from '../../common/decimal';
import { Bilan2050, BilanActifLigne, BilanPassifLigne } from '../liasse/bilan-2050';
import { CompteResultat2052_2053, CompteResultatLigne } from '../liasse/compte-resultat-2052-2053';
import { assertCashFlowReconciles, computeCashFlowStatement } from './cash-flow-statement';

/**
 * A small, self-contained, hand-verified scenario — clean round numbers
 * chosen so every intermediate figure below can be checked by hand
 * arithmetic in this comment, independent of any real fixture data.
 * Live verification against the real "Société Test Multi-Année" fixture
 * (résultat -8 800,00, CAF 5 000,00, flux d'exploitation 0,00, flux
 * d'investissement -86 000,00, flux de financement 0,00, réconciliant à
 * -86 000,00 = 14 000,00 − 100 000,00) is done separately against the
 * running dev server — see CLAUDE.md "Tableau des flux de trésorerie".
 *
 * Hand computation for this scenario:
 * - CAF = résultat(2000) + dotations expl(GA 1000 + GD 500 = 1500) + dotations fin(GQ 0)
 *         + VNC cédée(G1 700 + G3 0 = 700) − reprises expl(FP 300) − reprises fin(GM 0)
 *         − produits cession(F1 800 + G2 0 + HD 0 = 800)
 *       = 2000 + 1500 + 700 − 300 − 800 = 3100.
 * - ΔBFR = −Δcréances(1200−0=1200) − Δstocks(400−0=400) + Δdettes(600−0=600) = −1000.
 * - Flux exploitation = 3100 − 1000 = 2100.
 * - Cash payé acquisitions = 5000 − Δ404(2000−0=2000) = 3000 → flux = −3000.
 * - Cash reçu cessions = 1000 − Δ462(0−0=0) = 1000 → flux = +1000.
 * - Flux investissement = −3000 + 1000 = −2000.
 * - Flux financement = Δemprunts(1500−0=1500) + Δcapital(0) + distributions(0) = 1500.
 * - Variation trésorerie = 2100 − 2000 + 1500 = 1600.
 * - Trésorerie: ouverture 100 000,00 → clôture 101 600,00 (chosen to match 100000+1600).
 */

function actifLigne(code: string, net: string): BilanActifLigne {
  return { code, label: code, brut: net, amortissements: '0.00', net };
}

function passifLigne(code: string, montant: string): BilanPassifLigne {
  return { code, label: code, montant };
}

function bilan(actif: BilanActifLigne[], passif: BilanPassifLigne[]): Bilan2050 {
  return {
    actif,
    totalActifBrut: '0.00',
    totalActifAmortissements: '0.00',
    totalActifNet: '0.00',
    passif,
    resultatDeLExercice: '0.00',
    totalPassif: '0.00',
  };
}

const OPENING_BILAN = bilan(
  [actifLigne('CF', '100000.00'), actifLigne('BX', '0.00')],
  [passifLigne('DA', '100000.00')],
);

const CLOSING_BILAN = bilan(
  [actifLigne('CF', '101600.00'), actifLigne('BX', '1200.00'), actifLigne('BR', '400.00')],
  [
    passifLigne('DA', '100000.00'),
    passifLigne('DX', '600.00'),
    passifLigne('DZ', '2000.00'),
    passifLigne('DU', '1500.00'),
  ],
);

/** Every scenario not specifically exercising 445660/445662 supplies these as zero. */
const NO_TVA_DEDUCTIBLE = {
  openingTvaDeductibleAutres: Money.zero(),
  closingTvaDeductibleAutres: Money.zero(),
  openingTvaDeductibleImmobilisations: Money.zero(),
  closingTvaDeductibleImmobilisations: Money.zero(),
};

function cdrLigne(code: string, montant: string): CompteResultatLigne {
  return { code, label: code, montant };
}

const CLOSING_CDR: CompteResultat2052_2053 = {
  lignes: [
    cdrLigne('GA', '1000.00'),
    cdrLigne('GD', '500.00'),
    cdrLigne('FP', '300.00'),
    cdrLigne('F1', '800.00'),
    cdrLigne('G1', '700.00'),
  ],
  totalProduitsExploitation: '0.00',
  totalChargesExploitation: '0.00',
  resultatExploitation: '0.00',
  beneficeAttribueOuPerteTransferee: null,
  perteSupporteeOuBeneficeTransfere: null,
  totalProduitsFinanciers: '0.00',
  totalChargesFinancieres: '0.00',
  resultatFinancier: '0.00',
  resultatCourantAvantImpots: '0.00',
  resultatExceptionnel: '0.00',
  totalProduits: '0.00',
  totalCharges: '0.00',
  beneficeOuPerte: '2000.00',
};

describe('computeCashFlowStatement', () => {
  it('matches the hand-computed oracle across all three sections', () => {
    const statement = computeCashFlowStatement({
      openingBilan: OPENING_BILAN,
      closingBilan: CLOSING_BILAN,
      closingCompteResultat: CLOSING_CDR,
      acquisitionsImmobilisations: Money.fromString('5000.00'),
      cessionsImmobilisations: Money.fromString('1000.00'),
      openingCreancesSurCessions: Money.zero(),
      closingCreancesSurCessions: Money.zero(),
      ...NO_TVA_DEDUCTIBLE,
    });

    expect(statement.fluxExploitation).toMatchObject({
      resultatNet: '2000.00',
      capaciteAutofinancement: '3100.00',
      variationCreancesClients: '1200.00',
      variationStocks: '400.00',
      variationDettesExploitation: '600.00',
      total: '2100.00',
    });

    expect(statement.fluxInvestissement).toMatchObject({
      acquisitionsImmobilisations: '5000.00',
      variationDettesSurImmobilisations: '2000.00',
      cessionsImmobilisations: '1000.00',
      variationCreancesSurCessions: '0.00',
      total: '-2000.00',
    });

    expect(statement.fluxFinancement).toMatchObject({
      variationEmprunts: '1500.00',
      variationCapital: '0.00',
      distributions: '0.00',
      total: '1500.00',
    });

    expect(statement.variationTresorerie).toBe('1600.00');
    expect(statement.tresorerieOuverture).toBe('100000.00');
    expect(statement.tresorerieCloture).toBe('101600.00');

    expect(() => assertCashFlowReconciles(statement)).not.toThrow();
  });

  it('a cession settled on credit (Δ462 > 0) reduces cash actually received', () => {
    const statement = computeCashFlowStatement({
      openingBilan: OPENING_BILAN,
      closingBilan: bilan([actifLigne('CF', '99600.00')], [passifLigne('DA', '100000.00')]),
      closingCompteResultat: {
        ...CLOSING_CDR,
        lignes: [cdrLigne('F1', '1000.00'), cdrLigne('G1', '600.00')],
        beneficeOuPerte: '400.00',
      },
      acquisitionsImmobilisations: Money.zero(),
      cessionsImmobilisations: Money.fromString('1000.00'),
      openingCreancesSurCessions: Money.zero(),
      closingCreancesSurCessions: Money.fromString('1000.00'),
      ...NO_TVA_DEDUCTIBLE,
    });

    // CAF = 400 + 600(VNC) − 1000(produit cession) = 0. ΔBFR = 0. Flux exploitation = 0.
    expect(statement.fluxExploitation.total).toBe('0.00');
    // Cash reçu cessions = 1000 − Δ462(1000) = 0 → the whole sale is still a receivable, no cash yet.
    expect(statement.fluxInvestissement.total).toBe('0.00');
    expect(statement.fluxFinancement.total).toBe('0.00');
    expect(statement.variationTresorerie).toBe('0.00');
    expect(statement.tresorerieCloture).toBe('99600.00');
    // tresorerieOuverture is 100000.00, so a 0.00 variation would need closing = 100000.00 too —
    // deliberately mismatched here to prove assertCashFlowReconciles actually catches a real gap.
    expect(() => assertCashFlowReconciles(statement)).toThrow(/ne réconcilie pas/);
  });

  it('a same-year dotation aux dépréciations clients does not distort Δcréances (BFR uses brut, not net)', () => {
    // Vente à crédit 5000 (résultat), same-year dotation dépréciation clients douteux 1200 (GC).
    // Closing BX: brut 5000, amortissements 1200, net 3800 — using .net here (as an earlier, buggy
    // version of this module did) would understate Δcréances by exactly the dotation amount and
    // leave a residual, non-reconciling gap. This reproduces, in isolation, the exact live bug found
    // against the "Société Test Multi-Année" fixture (see CLAUDE.md "Tableau des flux de
    // trésorerie").
    const statement = computeCashFlowStatement({
      openingBilan: bilan([actifLigne('CF', '100000.00'), actifLigne('BX', '0.00')], []),
      closingBilan: bilan(
        [
          { code: 'CF', label: 'CF', brut: '100000.00', amortissements: '0.00', net: '100000.00' },
          { code: 'BX', label: 'BX', brut: '5000.00', amortissements: '1200.00', net: '3800.00' },
        ],
        [],
      ),
      closingCompteResultat: {
        ...CLOSING_CDR,
        lignes: [cdrLigne('GC', '1200.00')],
        beneficeOuPerte: '3800.00',
      },
      acquisitionsImmobilisations: Money.zero(),
      cessionsImmobilisations: Money.zero(),
      openingCreancesSurCessions: Money.zero(),
      closingCreancesSurCessions: Money.zero(),
      ...NO_TVA_DEDUCTIBLE,
    });

    // CAF = 3800(résultat) + 1200(GC dotation) = 5000. Δcréances(brut) = 5000 − 0 = 5000.
    // Flux exploitation = 5000 − 5000 = 0 — the fully-uncollected sale has zero net cash impact.
    expect(statement.fluxExploitation).toMatchObject({
      capaciteAutofinancement: '5000.00',
      variationCreancesClients: '5000.00',
      total: '0.00',
    });
    expect(statement.variationTresorerie).toBe('0.00');
    expect(() => assertCashFlowReconciles(statement)).not.toThrow();
  });

  it('445660/445662 (TVA déductible) split correctly between exploitation and investissement', () => {
    // Reproduces, in isolation, the exact live gap found on the FR demo company: a 500,00 reconciliation
    // gap traced to four purchases' TVA déductible (three "autres biens" purchases, 200+150+60=410 on
    // 445660; one immobilisation purchase, 90 on 445662), entirely invisible to the flux sections
    // because BZ (which folds 445660/445662 in with genuinely-unrelated accounts) was excluded wholesale.
    // See CLAUDE.md "Tableau des flux de trésorerie" — putting all 500 in exploitation would have
    // reconciled too, but misclassified the 90 immobilisations-VAT as operating instead of investing;
    // the reconciliation invariant alone can't catch a wrong-SECTION allocation, only a wrong total.
    const statement = computeCashFlowStatement({
      openingBilan: bilan([actifLigne('CF', '1000.00')], []),
      closingBilan: bilan(
        [{ code: 'CF', label: 'CF', brut: '590.00', amortissements: '0.00', net: '590.00' }],
        [passifLigne('DZ', '540.00')],
      ),
      closingCompteResultat: { ...CLOSING_CDR, lignes: [], beneficeOuPerte: '0.00' },
      // 450 HT acquisition, entirely credit-financed (DZ 540 TTC = 450 HT + 90 TVA déductible) — zero
      // cash paid, so investissement must net to 0.00, not a phantom ±90 from comparing HT to TTC.
      acquisitionsImmobilisations: Money.fromString('450.00'),
      cessionsImmobilisations: Money.zero(),
      openingCreancesSurCessions: Money.zero(),
      closingCreancesSurCessions: Money.zero(),
      openingTvaDeductibleAutres: Money.zero(),
      closingTvaDeductibleAutres: Money.fromString('410.00'),
      openingTvaDeductibleImmobilisations: Money.zero(),
      closingTvaDeductibleImmobilisations: Money.fromString('90.00'),
    });

    // Exploitation: CAF(0) − Δ445660(410) = −410 — the 410 lands here, not investissement.
    expect(statement.fluxExploitation).toMatchObject({
      variationTvaDeductibleAutres: '410.00',
      total: '-410.00',
    });
    // Investissement: cash payé = (450 + 90) − 540 = 0 — the 90 lands here (added to the HT cost,
    // making it TTC to match DZ), not exploitation, and correctly nets to zero cash paid.
    expect(statement.fluxInvestissement).toMatchObject({
      variationTvaDeductibleImmobilisations: '90.00',
      total: '0.00',
    });
    expect(statement.variationTresorerie).toBe('-410.00');
    expect(statement.tresorerieCloture).toBe('590.00');
    expect(() => assertCashFlowReconciles(statement)).not.toThrow();
  });
});
