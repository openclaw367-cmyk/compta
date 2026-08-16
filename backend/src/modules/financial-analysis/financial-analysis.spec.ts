import { Money } from '../../common/decimal';
import { Bilan2050, BilanActifLigne, BilanPassifLigne } from '../liasse/bilan-2050';
import { CompteResultat2052_2053, CompteResultatLigne } from '../liasse/compte-resultat-2052-2053';
import { CashFlowStatement } from '../cash-flow/cash-flow-statement';
import { computeFinancialAnalysis } from './financial-analysis';

/**
 * A small, self-contained, hand-verified scenario — independent of any
 * real fixture/company data, exactly the discipline already established
 * by cash-flow-statement.spec.ts. Live verification against the
 * multi-year fixture AND the FR demo company is done separately against
 * the running dev server — see CLAUDE.md "Analyse financière —
 * retraitement analytique".
 *
 * Hand computation (compte de résultat):
 * - FC 50000, FS 30000, FT 0, FW 5000, FX 1000, FY 8000, FZ 3000, GA 2000, GE 500.
 * - Marge commerciale = FC−FS−FT = 20000.
 * - Production = 0. Consommations = FU+FV+FW = 5000.
 * - VA = 20000+0−5000 = 15000.
 * - EBE = VA+FO−FX−FY−FZ = 15000−1000−8000−3000 = 3000.
 * - Résultat exploitation = EBE+FP+F1+FQ−GA−GB−GC−GD−G1−GE = 3000−2000−500 = 500.
 * - GR (intérêts) 800 → résultat financier = −800. Resultat courant = 500−800 = −300.
 * - HK (IS) 1200 → résultat net = −300+0−0−1200 = −1500.
 * - CA = FC+FF+FI = 50000. Margins: brute 40.00%, EBE 6.00%, exploitation 1.00%, nette −3.00%.
 *
 * Hand computation (bilan, closing) — balanced by construction:
 * - Actif: AN 10000 (immobilisation net), BX 8000, BT 6000, BZ 1000 (= 445660 800 + 445662 200,
 *   the raw accounts folded into BZ on the real form), CF 5000. Total actif net = 30000.
 * - Passif: DA 15000, DU 9500 (dettes financières), DX 4000, DY 2000, DZ 1000, DI (résultat) −1500.
 *   Total passif = 15000+9500+4000+2000+1000−1500 = 30000. Actif=Passif ✓ (not itself asserted by
 *   this module, but load-bearing for the FR−BFR=CF identity below to hold by construction).
 * - BFR exploitation = BX+BT+445660−DX−DY = 8000+6000+800−4000−2000 = 8800.
 * - BFR hors exploitation = 462(0)+445662(200)−DZ(1000)−EA(0) = −800.
 * - BFR total = 8000.
 * - Emplois stables = AN net = 10000. Ressources stables = capitaux propres(15000−1500=13500)
 *   + provisions(0) + dettes fin(9500) = 23000. FR = 23000−10000 = 13000.
 * - Trésorerie nette = FR−BFR = 13000−8000 = 5000 = CF (5000) ✓ — the identity holds because the
 *   bilan is genuinely balanced and every actif/passif line is accounted for in FR or BFR or CF.
 * - Endettement net = 9500−(5000+0) = 4500. Book EV = 13500+4500 = 18000.
 * - Coût de la dette = GR(800)/dettesFin(9500) = 8.42%.
 * - ROE = −1500/13500 = −11.11%. ROA = −1500/30000 = −5.00%. ROCE = 500/18000 = 2.78%.
 * - Actif circulant = 30000−10000 = 20000. Dettes court terme = DX+DY+DZ = 7000 (DW/EA/EB all 0).
 *   Liquidité générale = 20000/7000 = 2.8571. Liquidité réduite = (20000−6000)/7000 = 2.0000.
 * - DSO = BX brut(8000)/CA(50000)×365 = 58.4 jours. Coût des achats = FS+FT+FU+FV+FW = 35000.
 *   DPO = DX(4000)/35000×365 = 41.7 jours. Rotation stocks = BT brut(6000)/35000×365 = 62.6 jours.
 *
 * Hand computation (opening bilan, BFR delta only — no need to balance):
 * - BX 3000, BT 4000, DX 1000, DY 500, 445660 500.
 * - BFR exploitation opening = 3000+4000+500−1000−500 = 6000. Δ = 8800−6000 = 2800.
 * - A hand-built CashFlowStatement embeds the SAME delta split across its own four fields
 *   (variationCreancesClients 5000 + variationStocks 2000 + variationTvaDeductibleAutres 300 −
 *   variationDettesExploitation 4500 = 2800) — by construction, so the tie-out passes.
 *
 * Hand computation (free cash flow, from the same CashFlowStatement):
 * - fluxExploitation.total 1200 (an independent input, not re-derived here).
 * - cashPaidForAcquisitions = acquisitions(3000)+Δ445662(200)−ΔDZ(1000) = 2200.
 * - FCF = 1200−2200 = −1000.
 */

function actifLigne(code: string, brut: string, amort = '0.00'): BilanActifLigne {
  const net = Money.fromString(brut).minus(Money.fromString(amort)).toApiString();
  return { code, label: code, brut, amortissements: amort, net };
}

function passifLigne(code: string, montant: string): BilanPassifLigne {
  return { code, label: code, montant };
}

function bilan(
  actif: BilanActifLigne[],
  passif: BilanPassifLigne[],
  resultatDeLExercice: string,
  totalActifNet: string,
  totalPassif: string,
): Bilan2050 {
  return {
    actif,
    totalActifBrut: totalActifNet,
    totalActifAmortissements: '0.00',
    totalActifNet,
    passif,
    resultatDeLExercice,
    totalPassif,
  };
}

const OPENING_BILAN = bilan(
  [actifLigne('BX', '3000.00'), actifLigne('BT', '4000.00')],
  [passifLigne('DX', '1000.00'), passifLigne('DY', '500.00')],
  '0.00',
  '0.00',
  '0.00',
);

const CLOSING_BILAN = bilan(
  [
    actifLigne('AN', '10000.00'),
    actifLigne('BX', '8000.00'),
    actifLigne('BT', '6000.00'),
    actifLigne('BZ', '1000.00'),
    actifLigne('CF', '5000.00'),
  ],
  [
    passifLigne('DA', '15000.00'),
    passifLigne('DU', '9500.00'),
    passifLigne('DX', '4000.00'),
    passifLigne('DY', '2000.00'),
    passifLigne('DZ', '1000.00'),
  ],
  '-1500.00',
  '30000.00',
  '30000.00',
);

function cdrLigne(code: string, montant: string): CompteResultatLigne {
  return { code, label: code, montant };
}

const CLOSING_CDR: CompteResultat2052_2053 = {
  lignes: [
    cdrLigne('FC', '50000.00'),
    cdrLigne('FS', '30000.00'),
    cdrLigne('FW', '5000.00'),
    cdrLigne('FX', '1000.00'),
    cdrLigne('FY', '8000.00'),
    cdrLigne('FZ', '3000.00'),
    cdrLigne('GA', '2000.00'),
    cdrLigne('GE', '500.00'),
    cdrLigne('GR', '800.00'),
    cdrLigne('HK', '1200.00'),
  ],
  totalProduitsExploitation: '50000.00',
  totalChargesExploitation: '49500.00',
  resultatExploitation: '500.00',
  beneficeAttribueOuPerteTransferee: null,
  perteSupporteeOuBeneficeTransfere: null,
  totalProduitsFinanciers: '0.00',
  totalChargesFinancieres: '800.00',
  resultatFinancier: '-800.00',
  resultatCourantAvantImpots: '-300.00',
  resultatExceptionnel: '0.00',
  totalProduits: '50000.00',
  totalCharges: '51500.00',
  beneficeOuPerte: '-1500.00',
};

function fluxLigne(overrides: Partial<CashFlowStatement>): CashFlowStatement {
  return {
    fluxExploitation: {
      resultatNet: '-1500.00',
      dotationsAmortissementsProvisions: '0.00',
      reprisesAmortissementsProvisions: '0.00',
      valeurComptableElementsCedes: '0.00',
      produitsDesCessions: '0.00',
      capaciteAutofinancement: '0.00',
      variationCreancesClients: '5000.00',
      variationStocks: '2000.00',
      variationTvaDeductibleAutres: '300.00',
      variationDettesExploitation: '4500.00',
      total: '1200.00',
    },
    fluxInvestissement: {
      acquisitionsImmobilisations: '3000.00',
      variationTvaDeductibleImmobilisations: '200.00',
      variationDettesSurImmobilisations: '1000.00',
      cessionsImmobilisations: '0.00',
      variationCreancesSurCessions: '0.00',
      total: '-2200.00',
    },
    fluxFinancement: {
      variationEmprunts: '0.00',
      variationCapital: '0.00',
      distributions: '0.00',
      total: '0.00',
    },
    variationTresorerie: '-1000.00',
    tresorerieOuverture: '6000.00',
    tresorerieCloture: '5000.00',
    ...overrides,
  };
}

const CASH_FLOW_STATEMENT = fluxLigne({});

describe('computeFinancialAnalysis', () => {
  it('matches the hand-computed oracle across every section', () => {
    const result = computeFinancialAnalysis({
      openingBilan: OPENING_BILAN,
      closingBilan: CLOSING_BILAN,
      closingCompteResultat: CLOSING_CDR,
      cashFlowStatement: CASH_FLOW_STATEMENT,
      openingTvaDeductibleAutres: Money.fromString('500.00'),
      closingTvaDeductibleAutres: Money.fromString('800.00'),
      closingTvaDeductibleImmobilisations: Money.fromString('200.00'),
      closingCreancesSurCessions: Money.zero(),
    });

    expect(result.sig).toMatchObject({
      margeCommerciale: '20000.00',
      productionDeLExercice: '0.00',
      consommationsEnProvenanceDesTiers: '5000.00',
      valeurAjoutee: '15000.00',
      ebe: '3000.00',
      resultatExploitation: '500.00',
      resultatFinancier: '-800.00',
      resultatCourantAvantImpots: '-300.00',
      resultatExceptionnel: '0.00',
      resultatNet: '-1500.00',
    });

    expect(result.margins).toMatchObject({
      chiffreDAffaires: '50000.00',
      margeBrute: '40.00',
      margeEbe: '6.00',
      margeExploitation: '1.00',
      margeNette: '-3.00',
    });

    expect(result.bfr).toMatchObject({
      bfrExploitation: '8800.00',
      bfrHorsExploitation: '-800.00',
      bfrTotal: '8000.00',
    });

    expect(result.fondsDeRoulement).toMatchObject({
      ressourcesStables: '23000.00',
      emploisStables: '10000.00',
      fondsDeRoulement: '13000.00',
    });

    expect(result.tresorerieNette).toMatchObject({
      parFrMoinsBfr: '5000.00',
      disponibilites: '5000.00',
    });

    expect(result.freeCashFlow).toMatchObject({
      fluxExploitation: '1200.00',
      cashPaidForAcquisitions: '2200.00',
      freeCashFlow: '-1000.00',
    });

    expect(result.endettementEtCapitaux).toMatchObject({
      dettesFinancieres: '9500.00',
      tresorerieEtEquivalents: '5000.00',
      endettementNet: '4500.00',
      capitauxPropres: '13500.00',
      bookEnterpriseValue: '18000.00',
    });

    expect(result.coutDeLaDette).toMatchObject({
      chargesDInteret: '800.00',
      dettesFinancieres: '9500.00',
      taux: '8.42',
    });

    expect(result.ratios).toMatchObject({
      liquiditeGenerale: '2.8571',
      liquiditeReduite: '2.0000',
      gearing: '33.33',
      autonomieFinanciere: '45.00',
      roe: '-11.11',
      roa: '-5.00',
      roce: '2.78',
      rentabiliteExploitation: '1.00',
      dsoClients: '58.4',
      dpoFournisseurs: '41.7',
      rotationStocks: '62.6',
    });
  });

  it('guards every ratio against a zero denominator with null ("n/a"), never a divide-by-zero', () => {
    const zeroBilan = bilan([actifLigne('CF', '0.00')], [], '0.00', '0.00', '0.00');
    const zeroCdr: CompteResultat2052_2053 = {
      lignes: [],
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
      beneficeOuPerte: '0.00',
    };
    const zeroFlux = fluxLigne({
      fluxExploitation: {
        resultatNet: '0.00',
        dotationsAmortissementsProvisions: '0.00',
        reprisesAmortissementsProvisions: '0.00',
        valeurComptableElementsCedes: '0.00',
        produitsDesCessions: '0.00',
        capaciteAutofinancement: '0.00',
        variationCreancesClients: '0.00',
        variationStocks: '0.00',
        variationTvaDeductibleAutres: '0.00',
        variationDettesExploitation: '0.00',
        total: '0.00',
      },
      fluxInvestissement: {
        acquisitionsImmobilisations: '0.00',
        variationTvaDeductibleImmobilisations: '0.00',
        variationDettesSurImmobilisations: '0.00',
        cessionsImmobilisations: '0.00',
        variationCreancesSurCessions: '0.00',
        total: '0.00',
      },
      variationTresorerie: '0.00',
      tresorerieOuverture: '0.00',
      tresorerieCloture: '0.00',
    });

    const result = computeFinancialAnalysis({
      openingBilan: zeroBilan,
      closingBilan: zeroBilan,
      closingCompteResultat: zeroCdr,
      cashFlowStatement: zeroFlux,
      openingTvaDeductibleAutres: Money.zero(),
      closingTvaDeductibleAutres: Money.zero(),
      closingTvaDeductibleImmobilisations: Money.zero(),
      closingCreancesSurCessions: Money.zero(),
    });

    expect(result.margins).toMatchObject({
      margeBrute: null,
      margeEbe: null,
      margeExploitation: null,
      margeNette: null,
    });
    expect(result.coutDeLaDette.taux).toBeNull();
    expect(result.ratios).toMatchObject({
      liquiditeGenerale: null,
      liquiditeReduite: null,
      gearing: null,
      autonomieFinanciere: null,
      roe: null,
      roa: null,
      roce: null,
      rentabiliteExploitation: null,
      dsoClients: null,
      dpoFournisseurs: null,
      rotationStocks: null,
    });
  });

  it('throws when BFR exploitation does not tie to the tableau des flux de trésorerie', () => {
    const mismatched = fluxLigne({
      fluxExploitation: {
        ...CASH_FLOW_STATEMENT.fluxExploitation,
        variationCreancesClients: '5100.00', // off by 100 vs. the bilan-derived delta
      },
    });

    expect(() =>
      computeFinancialAnalysis({
        openingBilan: OPENING_BILAN,
        closingBilan: CLOSING_BILAN,
        closingCompteResultat: CLOSING_CDR,
        cashFlowStatement: mismatched,
        openingTvaDeductibleAutres: Money.fromString('500.00'),
        closingTvaDeductibleAutres: Money.fromString('800.00'),
        closingTvaDeductibleImmobilisations: Money.fromString('200.00'),
        closingCreancesSurCessions: Money.zero(),
      }),
    ).toThrow(/BFR exploitation/);
  });

  it('throws when trésorerie nette via FR−BFR does not equal disponibilités read off the bilan', () => {
    const mismatchedBilan = bilan(
      [
        actifLigne('AN', '10000.00'),
        actifLigne('BX', '8000.00'),
        actifLigne('BT', '6000.00'),
        actifLigne('BZ', '1000.00'),
        actifLigne('CF', '6000.00'), // bumped from 5000 — no longer matches FR − BFR
      ],
      CLOSING_BILAN.passif,
      '-1500.00',
      '31000.00',
      '31000.00',
    );

    expect(() =>
      computeFinancialAnalysis({
        openingBilan: OPENING_BILAN,
        closingBilan: mismatchedBilan,
        closingCompteResultat: CLOSING_CDR,
        cashFlowStatement: CASH_FLOW_STATEMENT,
        openingTvaDeductibleAutres: Money.fromString('500.00'),
        closingTvaDeductibleAutres: Money.fromString('800.00'),
        closingTvaDeductibleImmobilisations: Money.fromString('200.00'),
        closingCreancesSurCessions: Money.zero(),
      }),
    ).toThrow(/Trésorerie nette/);
  });

  it('provisionsSurActifCirculant closes the exact 1 200,00 gap found live on the multi-year fixture (BX dépréciation contra)', () => {
    // Mirrors the live "Société Test Multi-Année" FY2026 figures exactly: BX brut 5000,00 with a
    // 1 200,00 dépréciation contra (compte 491, dotation dépréciation clients douteux), a 90 000,00
    // créance sur cession (462, folded into BZ on the bilan's own form), immobilisations net
    // 271 400,00, capital 385 000,00, provisions 3 000,00, résultat −8 800,00, disponibilités
    // 14 000,00. A first version of parFrMoinsBfr (FR − BFR alone) gave 12 800,00 here — this proves
    // the +1 200,00 term closes it to the centime, not by inspection but by reproducing the exact
    // live scenario as a literal, hand-traced oracle.
    const openingBilanFixture = bilan([], [], '0.00', '0.00', '0.00');
    const closingBilanFixture = bilan(
      [
        actifLigne('AN', '271400.00'),
        actifLigne('BX', '5000.00', '1200.00'),
        actifLigne('BZ', '90000.00'),
        actifLigne('CF', '14000.00'),
      ],
      [passifLigne('DA', '385000.00'), passifLigne('DP', '3000.00')],
      '-8800.00',
      '379200.00',
      '379200.00',
    );
    const cashFlowFixture = fluxLigne({
      fluxExploitation: {
        ...CASH_FLOW_STATEMENT.fluxExploitation,
        variationCreancesClients: '5000.00',
        variationStocks: '0.00',
        variationTvaDeductibleAutres: '0.00',
        variationDettesExploitation: '0.00',
      },
    });

    const result = computeFinancialAnalysis({
      openingBilan: openingBilanFixture,
      closingBilan: closingBilanFixture,
      closingCompteResultat: CLOSING_CDR,
      cashFlowStatement: cashFlowFixture,
      openingTvaDeductibleAutres: Money.zero(),
      closingTvaDeductibleAutres: Money.zero(),
      closingTvaDeductibleImmobilisations: Money.zero(),
      closingCreancesSurCessions: Money.fromString('90000.00'),
    });

    // BFR itself is untouched by the fix — still the plain gross figure, unaffected.
    expect(result.bfr).toMatchObject({
      bfrExploitation: '5000.00',
      bfrHorsExploitation: '90000.00',
      bfrTotal: '95000.00',
    });
    expect(result.fondsDeRoulement.fondsDeRoulement).toBe('107800.00');
    // FR − BFR alone would be 107800 − 95000 = 12800,00 — the pre-fix, non-reconciling figure.
    expect(
      Money.fromString(result.fondsDeRoulement.fondsDeRoulement)
        .minus(Money.fromString(result.bfr.bfrTotal))
        .toApiString(),
    ).toBe('12800.00');
    expect(result.tresorerieNette).toMatchObject({
      provisionsSurActifCirculant: '1200.00',
      parFrMoinsBfr: '14000.00',
      disponibilites: '14000.00',
    });
  });

  it('provisionsSurActifCirculant is 0,00 on the FR demo company shape — the formula reduces to plain FR − BFR, unchanged', () => {
    // No dépréciation contra anywhere in this scenario (mirrors the FR demo company, which reconciled
    // live without the third term) — proves the fix is a strict generalization, not a special case.
    const result = computeFinancialAnalysis({
      openingBilan: OPENING_BILAN,
      closingBilan: CLOSING_BILAN,
      closingCompteResultat: CLOSING_CDR,
      cashFlowStatement: CASH_FLOW_STATEMENT,
      openingTvaDeductibleAutres: Money.fromString('500.00'),
      closingTvaDeductibleAutres: Money.fromString('800.00'),
      closingTvaDeductibleImmobilisations: Money.fromString('200.00'),
      closingCreancesSurCessions: Money.zero(),
    });

    expect(result.tresorerieNette).toMatchObject({
      provisionsSurActifCirculant: '0.00',
      parFrMoinsBfr: '5000.00',
      disponibilites: '5000.00',
    });
  });
});
