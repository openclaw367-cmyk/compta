import { Money } from '../../common/decimal';
import { computeTableau2056 } from './tableau-2056';
import { ORACLE_2056_LIGNES, ORACLE_2056_TOTALS } from './tableau-2056-oracle-fixture';

describe('computeTableau2056', () => {
  it('matches the hand-computed oracle: dotation + partial reprise on one provision, dotation-only on another', () => {
    const result = computeTableau2056(ORACLE_2056_LIGNES);

    const garantiesClients = result.lignes.find((l) => l.code === 'GARANTIES_CLIENTS')!;
    expect(garantiesClients).toMatchObject({
      montantDebut: '0.00',
      dotations: '5000.00',
      reprises: '2000.00',
      montantFin: '3000.00',
    });

    const deprecClients = result.lignes.find((l) => l.code === 'DEPREC_COMPTES_CLIENTS')!;
    expect(deprecClients).toMatchObject({
      montantDebut: '0.00',
      dotations: '1200.00',
      reprises: '0.00',
      montantFin: '1200.00',
    });

    expect(result.totalReglementees).toBe(ORACLE_2056_TOTALS.totalReglementees);
    expect(result.totalRisquesCharges).toBe(ORACLE_2056_TOTALS.totalRisquesCharges);
    expect(result.totalDepreciation).toBe(ORACLE_2056_TOTALS.totalDepreciation);
    expect(result.totalGeneral).toBe(ORACLE_2056_TOTALS.totalGeneral);
    expect(result.dontDotationsReprisesParNature).toBeNull();
  });

  it('every other line is present with all-zero movement — no line is silently omitted', () => {
    const result = computeTableau2056(ORACLE_2056_LIGNES);
    const untouched = result.lignes.find((l) => l.code === 'AMORTISSEMENTS_DEROGATOIRES')!;
    expect(untouched).toMatchObject({
      montantDebut: '0.00',
      dotations: '0.00',
      reprises: '0.00',
      montantFin: '0.00',
    });
  });

  it('treats an à-nouveau-sourced ligne as "début", not movement — the AN/non-AN split this module exists for', () => {
    const result = computeTableau2056([
      {
        accountNumber: '151200',
        isOpeningBalance: true,
        debit: Money.zero(),
        credit: Money.fromString('4000.00'),
      },
      {
        accountNumber: '151200',
        isOpeningBalance: false,
        debit: Money.zero(),
        credit: Money.fromString('1000.00'),
      },
    ]);
    const garantiesClients = result.lignes.find((l) => l.code === 'GARANTIES_CLIENTS')!;
    expect(garantiesClients).toMatchObject({
      montantDebut: '4000.00',
      dotations: '1000.00',
      reprises: '0.00',
      montantFin: '5000.00',
    });
  });

  it('throws if a reprise exceeds what was ever provisioned, producing a negative closing balance', () => {
    expect(() =>
      computeTableau2056([
        {
          accountNumber: '151100',
          isOpeningBalance: false,
          debit: Money.fromString('500.00'),
          credit: Money.zero(),
        },
      ]),
    ).toThrow(/negative/);
  });

  it('throws for a ligne on an account with no 2056 mapping', () => {
    expect(() =>
      computeTableau2056([
        {
          accountNumber: '411000',
          isOpeningBalance: false,
          debit: Money.fromString('100.00'),
          credit: Money.zero(),
        },
      ]),
    ).toThrow(/no 2056 provision-nature mapping/);
  });
});
