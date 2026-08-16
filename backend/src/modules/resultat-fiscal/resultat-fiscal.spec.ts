import { Money } from '../../common/decimal';
import { CompteResultat2052_2053, CompteResultatLigne } from '../liasse/compte-resultat-2052-2053';
import {
  ResultatFiscalLigne,
  assertResultatFiscalArithmetic,
  computeResultatFiscal,
} from './resultat-fiscal';

/**
 * A small, self-contained, hand-verified scenario — same discipline as
 * cash-flow-statement.spec.ts and financial-analysis.spec.ts.
 *
 * Hand computation:
 * - Résultat comptable (CDR beneficeOuPerte) = 12000.00.
 * - I7 (impôt sur les sociétés) = HK = 3000.00.
 * - WJ confirmed at 800.00 (matches the ledger suggestion of 800.00 — no override this scenario).
 * - WG confirmed at 250.00, OVERRIDDEN from a ledger suggestion of 150.00 (the user found an
 *   additional 100.00 of TVS mis-posted elsewhere and corrected the suggestion upward — exactly the
 *   "confirmable, not silently trusted" behavior this module exists to support).
 * - Declared réintégrations: WD 500.00 (avantages personnels), XD 200.00 (majoration amortissement).
 * - Declared déductions: XA 400.00 (régime mères-filles).
 * - Total réintégrations = I7(3000) + WJ(800) + WG(250) + WD(500) + XD(200) = 4750.00.
 * - Total déductions = 400.00.
 * - Résultat fiscal = 12000 + 4750 − 400 = 16350.00.
 */

function cdrLigne(code: string, montant: string): CompteResultatLigne {
  return { code, label: code, montant };
}

const CLOSING_CDR: CompteResultat2052_2053 = {
  lignes: [cdrLigne('HK', '3000.00')],
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
  beneficeOuPerte: '12000.00',
};

function ligne(code: string, label: string, montant: string): ResultatFiscalLigne {
  return { code, label, montant };
}

describe('computeResultatFiscal', () => {
  it('matches the hand-computed oracle, including a confirmed line overriding its own suggestion', () => {
    const result = computeResultatFiscal({
      closingCompteResultat: CLOSING_CDR,
      suggestedAmendesEtPenalites: Money.fromString('800.00'),
      confirmedAmendesEtPenalites: Money.fromString('800.00'),
      suggestedTaxeVehicules: Money.fromString('150.00'),
      confirmedTaxeVehicules: Money.fromString('250.00'),
      reintegrationsDeclarees: [
        ligne('WD', 'Avantages personnels non déductibles', '500.00'),
        ligne('XD', "Majoration d'amortissement", '200.00'),
      ],
      deductionsDeclarees: [ligne('XA', 'Régime des sociétés mères et des filiales', '400.00')],
    });

    expect(result.resultatComptable).toBe('12000.00');
    expect(result.impotSurLesSocietes).toMatchObject({ code: 'I7', montant: '3000.00' });
    expect(result.reintegrationsConfirmables).toEqual([
      { code: 'WJ', label: 'Amendes et pénalités', suggested: '800.00', confirmed: '800.00' },
      {
        code: 'WG',
        label: 'Taxe sur les véhicules des sociétés',
        suggested: '150.00',
        confirmed: '250.00',
      },
    ]);
    expect(result.totalReintegrations).toBe('4750.00');
    expect(result.totalDeductions).toBe('400.00');
    expect(result.resultatFiscal).toBe('16350.00');

    expect(() => assertResultatFiscalArithmetic(result)).not.toThrow();
  });

  it('never silently substitutes the suggestion for the confirmed value, even when they differ', () => {
    const result = computeResultatFiscal({
      closingCompteResultat: CLOSING_CDR,
      suggestedAmendesEtPenalites: Money.fromString('1000.00'),
      confirmedAmendesEtPenalites: Money.zero(),
      suggestedTaxeVehicules: Money.zero(),
      confirmedTaxeVehicules: Money.zero(),
      reintegrationsDeclarees: [],
      deductionsDeclarees: [],
    });

    // The suggestion (1000.00) is reported, but 0.00 (what was confirmed) is what actually counts.
    expect(result.reintegrationsConfirmables[0]).toMatchObject({
      suggested: '1000.00',
      confirmed: '0.00',
    });
    expect(result.totalReintegrations).toBe('3000.00'); // I7 only — WJ's suggestion never leaked in
  });

  it('a déficit (negative résultat fiscal) is reported as a signed negative value, not flipped', () => {
    const perteCdr: CompteResultat2052_2053 = {
      ...CLOSING_CDR,
      lignes: [],
      beneficeOuPerte: '-5000.00',
    };
    const result = computeResultatFiscal({
      closingCompteResultat: perteCdr,
      suggestedAmendesEtPenalites: Money.zero(),
      confirmedAmendesEtPenalites: Money.zero(),
      suggestedTaxeVehicules: Money.zero(),
      confirmedTaxeVehicules: Money.zero(),
      reintegrationsDeclarees: [],
      deductionsDeclarees: [],
    });

    expect(result.resultatComptable).toBe('-5000.00');
    expect(result.resultatFiscal).toBe('-5000.00');
    expect(() => assertResultatFiscalArithmetic(result)).not.toThrow();
  });

  it('throws when totalReintegrations has drifted from the sum of its own constituent lines', () => {
    const result = computeResultatFiscal({
      closingCompteResultat: CLOSING_CDR,
      suggestedAmendesEtPenalites: Money.zero(),
      confirmedAmendesEtPenalites: Money.zero(),
      suggestedTaxeVehicules: Money.zero(),
      confirmedTaxeVehicules: Money.zero(),
      reintegrationsDeclarees: [],
      deductionsDeclarees: [],
    });
    const corrupted = { ...result, totalReintegrations: '999999.00' };

    expect(() => assertResultatFiscalArithmetic(corrupted)).toThrow(/réintégrations/);
  });
});
