import { ConflictException, NotImplementedException } from '@nestjs/common';
import {
  assertInvoiceMentionsTieToPosting,
  computeDevisMentions,
  computeInvoiceMentions,
} from './invoice-mentions';

const COMPANY = {
  name: 'Société Démo SARL',
  addressLine: '1 rue de la Paix',
  postalCode: '75002',
  city: 'Paris',
  countryCode: 'FR',
  siren: '123456789',
  rci: null,
  vatNumber: 'FR12123456789',
  paymentInstructions: null,
};

const CLIENT = {
  name: 'Client Petit SARL',
  addressLine: '12 rue de la Paix',
  postalCode: '75002',
  city: 'Paris',
  countryCode: 'FR',
  sirenOrRci: '987654321',
  vatNumber: 'FR98987654321',
};

const INVOICE = {
  invoiceNumber: '1',
  invoiceDate: '2026-08-30',
  isCreditNote: false,
  correctsInvoiceNumber: null,
  lines: [
    {
      description: 'Prestation A',
      quantity: '3.00',
      unitPriceHT: '500.00',
      vatRatePercent: '20.00',
    },
    {
      description: 'Prestation B (export, exonérée)',
      quantity: '1.00',
      unitPriceHT: '200.00',
      vatRatePercent: null,
    },
  ],
};

describe('computeInvoiceMentions — FR', () => {
  it('computes every CGI 242 nonies A / L441-10 mention this pass models, for a mixed taxed+exempt invoice', () => {
    const mentions = computeInvoiceMentions('FR', COMPANY, CLIENT, INVOICE);
    expect(mentions.jurisdiction).toBe('FR');
    expect(mentions.invoiceNumber).toBe('1');
    expect(mentions.seller.name).toBe('Société Démo SARL');
    expect(mentions.seller.vatNumber).toBe('FR12123456789');
    expect(mentions.buyer.name).toBe('Client Petit SARL');
    expect(mentions.buyer.address.countryCode).toBe('FR');
    expect(mentions.seller.formattedAddress).toBe('1 rue de la Paix, 75002 Paris, FR');
    expect(mentions.lines).toHaveLength(2);
    expect(mentions.lines[0].totalHT).toBe('1500.00');
    expect(mentions.lines[1].vatRatePercent).toBeNull();
    // Only the taxed line contributes a VAT-by-rate bucket.
    expect(mentions.vatByRate).toEqual([
      { ratePercent: '20.00', baseHT: '1500.00', vatAmount: '300.00' },
    ]);
    expect(mentions.totalHT).toBe('1700.00');
    expect(mentions.totalVAT).toBe('300.00');
    expect(mentions.totalTTC).toBe('2000.00');
    expect(mentions.latePaymentPenaltyNotice).toContain('L441-10');
    expect(mentions.forfeitIndemnityNotice).toContain('40,00');
  });

  it('marks a credit note honestly, carrying the corrected invoice number', () => {
    const mentions = computeInvoiceMentions('FR', COMPANY, CLIENT, {
      ...INVOICE,
      isCreditNote: true,
      correctsInvoiceNumber: '1',
    });
    expect(mentions.isCreditNote).toBe(true);
    expect(mentions.correctsInvoiceNumber).toBe('1');
    expect(mentions.documentKind).toBe('AVOIR');
  });

  it('documentKind is FACTURE for an ordinary (non-credit-note) invoice', () => {
    const mentions = computeInvoiceMentions('FR', COMPANY, CLIENT, INVOICE);
    expect(mentions.documentKind).toBe('FACTURE');
  });

  it('paymentInstructions is null when the company has not configured bank details', () => {
    const mentions = computeInvoiceMentions('FR', COMPANY, CLIENT, INVOICE);
    expect(mentions.paymentInstructions).toBeNull();
  });

  it('paymentInstructions carries the configured bank details through', () => {
    const mentions = computeInvoiceMentions(
      'FR',
      {
        ...COMPANY,
        paymentInstructions: { bankName: 'Banque Populaire', iban: 'FR76...', bic: 'BPXXFRPP' },
      },
      CLIENT,
      INVOICE,
    );
    expect(mentions.paymentInstructions).toEqual({
      bankName: 'Banque Populaire',
      iban: 'FR76...',
      bic: 'BPXXFRPP',
    });
  });
});

describe('computeDevisMentions', () => {
  const DEVIS_INVOICE = { invoiceDate: '2026-08-30', lines: INVOICE.lines };

  it('produces a DEVIS with no invoice number, priced identically to a facture', () => {
    const mentions = computeDevisMentions('FR', COMPANY, CLIENT, DEVIS_INVOICE);
    expect(mentions.documentKind).toBe('DEVIS');
    expect(mentions.invoiceNumber).toBe('');
    expect(mentions.isCreditNote).toBe(false);
    expect(mentions.correctsInvoiceNumber).toBeNull();
    // Same arithmetic as computeInvoiceMentions on the identical line set.
    expect(mentions.totalHT).toBe('1700.00');
    expect(mentions.totalVAT).toBe('300.00');
    expect(mentions.totalTTC).toBe('2000.00');
  });

  it('throws NotImplementedException for MC, the same gate as computeInvoiceMentions', () => {
    expect(() => computeDevisMentions('MC', COMPANY, CLIENT, DEVIS_INVOICE)).toThrow(
      NotImplementedException,
    );
  });
});

describe('computeInvoiceMentions — MC', () => {
  it('throws NotImplementedException naming the pending-confirmation gap, never a silent copy of FR', () => {
    expect(() => computeInvoiceMentions('MC', COMPANY, CLIENT, INVOICE)).toThrow(
      NotImplementedException,
    );
    try {
      computeInvoiceMentions('MC', COMPANY, CLIENT, INVOICE);
      fail('expected a throw');
    } catch (e) {
      expect((e as Error).message).toContain('pending official confirmation');
      expect((e as Error).message).toContain('invoicing-plan.md');
    }
  });
});

describe('assertInvoiceMentionsTieToPosting', () => {
  it('passes silently when the two figures agree', () => {
    const mentions = computeInvoiceMentions('FR', COMPANY, CLIENT, INVOICE);
    expect(() => assertInvoiceMentionsTieToPosting(mentions, '2000.00')).not.toThrow();
  });

  it('throws ConflictException when the posted total diverges from the mentions total', () => {
    const mentions = computeInvoiceMentions('FR', COMPANY, CLIENT, INVOICE);
    expect(() => assertInvoiceMentionsTieToPosting(mentions, '1999.00')).toThrow(ConflictException);
  });
});
