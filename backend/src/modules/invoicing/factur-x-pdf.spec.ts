import { PDFDocument } from 'pdf-lib';
import { renderInvoicePdf } from './factur-x-pdf';
import { InvoiceMentions } from './invoice-mentions';

/**
 * pdf-lib has no text-extraction API (see pdf-report-renderer.spec.ts's
 * own doc comment for why) — these tests verify STRUCTURE (one page,
 * never throws across every documentKind/edge-case shape) by
 * round-tripping the built PDF through PDFDocument.load(). Real content
 * verification (every mandatory mention actually appears, correctly
 * positioned) is done by a one-off ts-node smoke test extracting text
 * via pdf-parse, same discipline as the original Factur-X pass — see
 * CLAUDE.md "Invoicing — Factur-X rendering".
 */

const BASE_MENTIONS: InvoiceMentions = {
  jurisdiction: 'FR',
  documentKind: 'FACTURE',
  invoiceNumber: '12',
  invoiceDate: '2026-09-01',
  isCreditNote: false,
  correctsInvoiceNumber: null,
  seller: {
    name: 'Société Démo SARL',
    address: {
      addressLine: '1 rue de la Paix',
      postalCode: '75002',
      city: 'Paris',
      countryCode: 'FR',
    },
    formattedAddress: '1 rue de la Paix, 75002 Paris, FR',
    vatNumber: 'FR12123456789',
    sirenOrRci: '123456789',
    phone: '+33 1 23 45 67 89',
    email: 'contact@demo-sarl.fr',
  },
  buyer: {
    name: 'Client Petit',
    address: {
      addressLine: '5 avenue des Champs',
      postalCode: '75008',
      city: 'Paris',
      countryCode: 'FR',
    },
    formattedAddress: '5 avenue des Champs, 75008 Paris, FR',
    vatNumber: null,
    sirenOrRci: null,
    phone: null,
    email: null,
  },
  lines: [
    {
      description: 'Prestation de conseil',
      quantity: '1.00',
      unitPriceHT: '1000.00',
      totalHT: '1000.00',
      vatRatePercent: '20.00',
    },
  ],
  vatByRate: [{ ratePercent: '20.00', baseHT: '1000.00', vatAmount: '200.00' }],
  totalHT: '1000.00',
  totalVAT: '200.00',
  totalTTC: '1200.00',
  latePaymentPenaltyNotice: 'Taux des pénalités de retard...',
  forfeitIndemnityNotice: 'Indemnité forfaitaire de 40,00 €...',
  escompteNotice: "Pas d'escompte pour paiement anticipé.",
  paymentInstructions: { bankName: 'Banque Populaire', iban: 'FR76...', bic: 'BPXXFRPP' },
};

async function pageCount(bytes: Uint8Array): Promise<number> {
  const loaded = await PDFDocument.load(bytes);
  return loaded.getPageCount();
}

describe('renderInvoicePdf', () => {
  it('produces a single-page PDF for a standard invoice', async () => {
    const bytes = await renderInvoicePdf(BASE_MENTIONS);
    expect(await pageCount(bytes)).toBe(1);
  });

  it('handles a credit note correcting an earlier invoice', async () => {
    const bytes = await renderInvoicePdf({
      ...BASE_MENTIONS,
      documentKind: 'AVOIR',
      invoiceNumber: '13',
      isCreditNote: true,
      correctsInvoiceNumber: '12',
    });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('handles a devis (no invoice number, no L441-10 notices, no closing courtesy line)', async () => {
    const bytes = await renderInvoicePdf({
      ...BASE_MENTIONS,
      documentKind: 'DEVIS',
      invoiceNumber: '',
    });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('handles multiple VAT rates on the same invoice', async () => {
    const bytes = await renderInvoicePdf({
      ...BASE_MENTIONS,
      lines: [
        {
          description: 'Ligne A',
          quantity: '2.00',
          unitPriceHT: '500.00',
          totalHT: '1000.00',
          vatRatePercent: '20.00',
        },
        {
          description: 'Ligne B',
          quantity: '3.00',
          unitPriceHT: '100.00',
          totalHT: '300.00',
          vatRatePercent: '10.00',
        },
      ],
      vatByRate: [
        { ratePercent: '20.00', baseHT: '1000.00', vatAmount: '200.00' },
        { ratePercent: '10.00', baseHT: '300.00', vatAmount: '30.00' },
      ],
      totalHT: '1300.00',
      totalVAT: '230.00',
      totalTTC: '1530.00',
    });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('handles no payment instructions configured (no bank footer)', async () => {
    const bytes = await renderInvoicePdf({ ...BASE_MENTIONS, paymentInstructions: null });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('handles a seller with no phone/email on file (omits the header contact block)', async () => {
    const bytes = await renderInvoicePdf({
      ...BASE_MENTIONS,
      seller: { ...BASE_MENTIONS.seller, phone: null, email: null },
    });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('handles a seller with no city on file (omits "Fait à ..." rather than guessing)', async () => {
    const bytes = await renderInvoicePdf({
      ...BASE_MENTIONS,
      seller: {
        ...BASE_MENTIONS.seller,
        address: { ...BASE_MENTIONS.seller.address, city: null },
        formattedAddress: '1 rue de la Paix, FR',
      },
    });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('handles a buyer with a VAT number and SIREN of its own (a business client)', async () => {
    const bytes = await renderInvoicePdf({
      ...BASE_MENTIONS,
      buyer: { ...BASE_MENTIONS.buyer, vatNumber: 'FR55987654321', sirenOrRci: '987654321' },
    });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('never throws on a WinAnsi-unsupported character reaching the page (sanitized, not fatal)', async () => {
    const bytes = await renderInvoicePdf({
      ...BASE_MENTIONS,
      seller: { ...BASE_MENTIONS.seller, name: 'Trésorerie − Négative SARL' },
    });
    expect(await pageCount(bytes)).toBe(1);
  });
});
