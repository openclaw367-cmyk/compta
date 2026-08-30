import { buildInvoicePostingLignes } from './invoice-posting';

describe('buildInvoicePostingLignes', () => {
  it('posts a single-line SALE: débit client / crédit revenue + TVA', () => {
    const result = buildInvoicePostingLignes(
      'client-411',
      'tva-445710',
      null,
      [
        {
          revenueAccountId: 'revenue-707',
          quantity: '3.00',
          unitPriceHT: '500.00',
          vatRateId: 'rate-20',
          vatRatePercent: '20.00',
          isCashBasisVat: false,
        },
      ],
      'SALE',
    );
    expect(result.totalTTC).toBe('1800.00');
    expect(result.lignes).toEqual([
      { compteId: 'client-411', debit: '1800.00' },
      { compteId: 'revenue-707', credit: '1500.00' },
      { compteId: 'tva-445710', credit: '300.00', vatRateId: 'rate-20' },
    ]);
  });

  it('mirrors the direction for a CREDIT_NOTE: crédit client / débit revenue + TVA', () => {
    const result = buildInvoicePostingLignes(
      'client-411',
      'tva-445710',
      null,
      [
        {
          revenueAccountId: 'revenue-707',
          quantity: '1.00',
          unitPriceHT: '100.00',
          vatRateId: 'rate-20',
          vatRatePercent: '20.00',
          isCashBasisVat: false,
        },
      ],
      'CREDIT_NOTE',
    );
    expect(result.totalTTC).toBe('120.00');
    expect(result.lignes).toEqual([
      { compteId: 'client-411', credit: '120.00' },
      { compteId: 'revenue-707', debit: '100.00' },
      { compteId: 'tva-445710', debit: '20.00', vatRateId: 'rate-20' },
    ]);
  });

  it('groups multiple lines by (revenueAccount, vatRate) into one HT ligne and one TVA ligne per pair — the same account can carry two different rates as two separate lignes', () => {
    const result = buildInvoicePostingLignes(
      'client-411',
      'tva-445710',
      null,
      [
        {
          revenueAccountId: 'revenue-707',
          quantity: '1.00',
          unitPriceHT: '100.00',
          vatRateId: 'rate-20',
          vatRatePercent: '20.00',
          isCashBasisVat: false,
        },
        {
          revenueAccountId: 'revenue-707',
          quantity: '1.00',
          unitPriceHT: '50.00',
          vatRateId: 'rate-20',
          vatRatePercent: '20.00',
          isCashBasisVat: false,
        },
        {
          revenueAccountId: 'revenue-707',
          quantity: '1.00',
          unitPriceHT: '200.00',
          vatRateId: 'rate-10',
          vatRatePercent: '10.00',
          isCashBasisVat: false,
        },
      ],
      'SALE',
    );
    // 150 HT @20% -> 30 TVA; 200 HT @10% -> 20 TVA; TTC = 150+30+200+20 = 400
    expect(result.totalTTC).toBe('400.00');
    expect(result.lignes).toEqual([
      { compteId: 'client-411', debit: '400.00' },
      { compteId: 'revenue-707', credit: '150.00' },
      { compteId: 'tva-445710', credit: '30.00', vatRateId: 'rate-20' },
      { compteId: 'revenue-707', credit: '200.00' },
      { compteId: 'tva-445710', credit: '20.00', vatRateId: 'rate-10' },
    ]);
  });

  it('omits the TVA ligne entirely for a VAT-exempt line, never posting a 0,00 line', () => {
    const result = buildInvoicePostingLignes(
      'client-411',
      'tva-445710',
      null,
      [
        {
          revenueAccountId: 'revenue-707',
          quantity: '1.00',
          unitPriceHT: '1000.00',
          vatRateId: null,
          vatRatePercent: null,
          isCashBasisVat: false,
        },
      ],
      'SALE',
    );
    expect(result.lignes).toEqual([
      { compteId: 'client-411', debit: '1000.00' },
      { compteId: 'revenue-707', credit: '1000.00' },
    ]);
  });

  it('splits across two distinct revenue accounts even at the same rate', () => {
    const result = buildInvoicePostingLignes(
      'client-411',
      'tva-445710',
      null,
      [
        {
          revenueAccountId: 'revenue-706',
          quantity: '1.00',
          unitPriceHT: '100.00',
          vatRateId: 'rate-20',
          vatRatePercent: '20.00',
          isCashBasisVat: false,
        },
        {
          revenueAccountId: 'revenue-707',
          quantity: '1.00',
          unitPriceHT: '100.00',
          vatRateId: 'rate-20',
          vatRatePercent: '20.00',
          isCashBasisVat: false,
        },
      ],
      'SALE',
    );
    expect(result.lignes).toEqual([
      { compteId: 'client-411', debit: '240.00' },
      { compteId: 'revenue-706', credit: '100.00' },
      { compteId: 'tva-445710', credit: '20.00', vatRateId: 'rate-20' },
      { compteId: 'revenue-707', credit: '100.00' },
      { compteId: 'tva-445710', credit: '20.00', vatRateId: 'rate-20' },
    ]);
  });

  // TVA sur les encaissements (CGI art. 269) — see CLAUDE.md "Invoicing — cash-basis VAT".
  describe('cash-basis VAT (TVA sur les encaissements)', () => {
    it('credits the encaissements suspense account instead of 445710 for a cash-basis (706, ENCAISSEMENTS) line', () => {
      const result = buildInvoicePostingLignes(
        'client-411',
        'tva-445710',
        'tva-445800',
        [
          {
            revenueAccountId: 'revenue-706',
            quantity: '1.00',
            unitPriceHT: '500.00',
            vatRateId: 'rate-20',
            vatRatePercent: '20.00',
            isCashBasisVat: true,
          },
        ],
        'SALE',
      );
      expect(result.lignes).toEqual([
        { compteId: 'client-411', debit: '600.00' },
        { compteId: 'revenue-706', credit: '500.00' },
        { compteId: 'tva-445800', credit: '100.00', vatRateId: 'rate-20' },
      ]);
    });

    it('a non-cash-basis line always credits 445710, regardless of account', () => {
      const result = buildInvoicePostingLignes(
        'client-411',
        'tva-445710',
        'tva-445800',
        [
          {
            revenueAccountId: 'revenue-706',
            quantity: '1.00',
            unitPriceHT: '500.00',
            vatRateId: 'rate-20',
            vatRatePercent: '20.00',
            isCashBasisVat: false,
          },
        ],
        'SALE',
      );
      expect(result.lignes).toEqual([
        { compteId: 'client-411', debit: '600.00' },
        { compteId: 'revenue-706', credit: '500.00' },
        { compteId: 'tva-445710', credit: '100.00', vatRateId: 'rate-20' },
      ]);
    });

    it('splits a mixed invoice (one 706 cash-basis line + one 707 débits line) across both TVA accounts in the same écriture', () => {
      const result = buildInvoicePostingLignes(
        'client-411',
        'tva-445710',
        'tva-445800',
        [
          {
            revenueAccountId: 'revenue-706',
            quantity: '1.00',
            unitPriceHT: '500.00',
            vatRateId: 'rate-20',
            vatRatePercent: '20.00',
            isCashBasisVat: true,
          },
          {
            revenueAccountId: 'revenue-707',
            quantity: '1.00',
            unitPriceHT: '100.00',
            vatRateId: 'rate-20',
            vatRatePercent: '20.00',
            isCashBasisVat: false,
          },
        ],
        'SALE',
      );
      expect(result.totalTTC).toBe('720.00');
      expect(result.lignes).toEqual([
        { compteId: 'client-411', debit: '720.00' },
        { compteId: 'revenue-706', credit: '500.00' },
        { compteId: 'tva-445800', credit: '100.00', vatRateId: 'rate-20' },
        { compteId: 'revenue-707', credit: '100.00' },
        { compteId: 'tva-445710', credit: '20.00', vatRateId: 'rate-20' },
      ]);
    });

    it('throws if a cash-basis line is passed with no tvaEncaissementsAccountId — an internal-consistency guard, never silently falls back', () => {
      expect(() =>
        buildInvoicePostingLignes(
          'client-411',
          'tva-445710',
          null,
          [
            {
              revenueAccountId: 'revenue-706',
              quantity: '1.00',
              unitPriceHT: '500.00',
              vatRateId: 'rate-20',
              vatRatePercent: '20.00',
              isCashBasisVat: true,
            },
          ],
          'SALE',
        ),
      ).toThrow('tvaEncaissementsAccountId');
    });
  });
});
