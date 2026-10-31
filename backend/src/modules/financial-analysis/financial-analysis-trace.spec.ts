import { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { LiasseLigne, buildTrialBalance } from '../liasse/trial-balance-engine';
import { computeCompteResultat2052_2053 } from '../liasse/compte-resultat-2052-2053';
import { traceFinancialAnalysisFormula } from './financial-analysis-trace';

/**
 * Tier 4 oracle tests — see CLAUDE.md "Traceability drill-down (Tier
 * 4)" and this module's own doc comment. A small, dedicated,
 * hand-traced CDR dataset (not the shared liasse oracle — this one
 * needs FM/FN/FO/FX/FY/FZ populated too, which the shared fixture
 * leaves mostly at zero) so every SIG term below has a real,
 * non-trivial value to decompose.
 */

function d(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function ligne(compteNumber: string, debit: string, credit: string): LiasseLigne {
  return {
    compteNumber,
    pcgClass: compteNumber.startsWith('7') ? 7 : 6,
    debit: d(debit),
    credit: d(credit),
  };
}

// Hand-computed:
// - margeCommerciale = FC(707000=10000) - FS(607000=4000) - FT(6037=500) = 5500.00
// - productionDeLExercice = FF(0) + FI(0) + FM(71xxx=300) + FN(0) = 300.00
// - consommationsEnProvenanceDesTiers = FU(601000=2000) + FV(0) + FW(604000=800) = 2800.00
// - valeurAjoutee = 5500 + 300 - 2800 = 3000.00
// - autresChargesExploitationCourante = FO(74000=400) - FX(63000=100) - FY(641000=600) - FZ(645000=200) = -500.00
// - ebe = 3000 - 500 = 2500.00
const CDR_LIGNES: LiasseLigne[] = [
  ligne('707000', '0.00', '10000.00'),
  ligne('607000', '4000.00', '0.00'),
  ligne('603700', '500.00', '0.00'),
  ligne('710000', '0.00', '300.00'),
  ligne('601000', '2000.00', '0.00'),
  ligne('604000', '800.00', '0.00'),
  ligne('740000', '0.00', '400.00'),
  ligne('630000', '100.00', '0.00'),
  ligne('641000', '600.00', '0.00'),
  ligne('645000', '200.00', '0.00'),
];
const cdrAccounts = buildTrialBalance(CDR_LIGNES);

describe('traceFinancialAnalysisFormula', () => {
  it('traces margeCommerciale to FC/FS/FT', () => {
    const result = traceFinancialAnalysisFormula(
      'margeCommerciale',
      cdrAccounts,
      Money.fromString('5500.00'),
    );
    expect(result.officialValue).toBe('5500.00');
    expect(result.terms).toHaveLength(1);
    expect(result.terms[0].codes).toEqual(
      expect.arrayContaining([
        { code: 'FC', label: expect.any(String), sign: 1, value: '10000.00' },
        { code: 'FS', label: expect.any(String), sign: -1, value: '4000.00' },
        { code: 'FT', label: expect.any(String), sign: -1, value: '500.00' },
      ]),
    );
  });

  it('traces valeurAjoutee to its three named sub-terms', () => {
    const result = traceFinancialAnalysisFormula(
      'valeurAjoutee',
      cdrAccounts,
      Money.fromString('3000.00'),
    );
    expect(result.officialValue).toBe('3000.00');
    const margeCommerciale = result.terms.find((t) => t.key === 'margeCommerciale')!;
    expect(margeCommerciale.value).toBe('5500.00');
    const production = result.terms.find((t) => t.key === 'productionDeLExercice')!;
    expect(production.value).toBe('300.00');
    const consommations = result.terms.find((t) => t.key === 'consommationsEnProvenanceDesTiers')!;
    expect(consommations.value).toBe('2800.00');
    expect(consommations.sign).toBe(-1);
  });

  it('traces ebe to its four named sub-terms', () => {
    const result = traceFinancialAnalysisFormula('ebe', cdrAccounts, Money.fromString('2500.00'));
    expect(result.officialValue).toBe('2500.00');
    const autres = result.terms.find((t) => t.key === 'autresChargesExploitationCourante')!;
    expect(autres.value).toBe('-500.00');
  });

  it('throws BadRequestException for an unknown key', () => {
    expect(() => traceFinancialAnalysisFormula('notReal', cdrAccounts, Money.zero())).toThrow(
      BadRequestException,
    );
  });

  it('throws ConflictException when the official value disagrees with the re-derived total', () => {
    expect(() =>
      traceFinancialAnalysisFormula('margeCommerciale', cdrAccounts, Money.fromString('1.00')),
    ).toThrow(ConflictException);
  });

  it('cross-checked against the real computeCompteResultat2052_2053() output for this fixture — the SIG trace must agree with the forward CDR engine, not just its own hand-computed comment', () => {
    const cdr = computeCompteResultat2052_2053(cdrAccounts);
    const fc = cdr.lignes.find((l) => l.code === 'FC')!.montant;
    expect(fc).toBe('10000.00');
    const result = traceFinancialAnalysisFormula(
      'margeCommerciale',
      cdrAccounts,
      Money.fromString('5500.00'),
    );
    expect(result.terms[0].codes!.find((c) => c.code === 'FC')!.value).toBe(fc);
  });
});
