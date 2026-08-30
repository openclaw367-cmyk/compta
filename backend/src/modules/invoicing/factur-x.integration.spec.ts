import { computeInvoiceMentions } from './invoice-mentions';
import { buildCrossIndustryInvoice } from './invoice-to-cii';

/**
 * The genuine "does the generated file validate against the Factur-X
 * standard" proof (real official XSD + Schematron EN16931 business-rule
 * validation via @stafyniaksacha/facturx's own `check()`, both before
 * AND after PDF/A-3 embedding) is proven by a plain `ts-node` smoke
 * test against the real dependency chain, NOT inside Jest — same
 * discipline this app already established for pdfjs-dist (see
 * invoice-extraction.service.spec.ts's own doc comment). Here the
 * blocker is Jest's own VM sandbox, not TypeScript's module transform:
 * `common/esm-interop.ts`'s eval-wrapped dynamic import survives
 * ts-jest's CommonJS transform (confirmed — the eval body is opaque to
 * it), but Jest's `jest-environment-node` itself still throws `"A
 * dynamic import callback was invoked without --experimental-vm-modules"`
 * for ANY real dynamic import, regardless of how it was written.
 * Enabling that flag project-wide for one dependency was rejected for
 * the same reason it was rejected for pdfjs-dist — out of proportion to
 * the gain, and CLAUDE.md is where the real verification result lives:
 * see "Invoicing — Phase A / Factur-X" and
 * specs/invoicing-factur-x-implementation-spec.md for the exact
 * pre-embed/post-embed check() results (both passed cleanly, zero
 * errors) and the genuine Windows-only libxml2-wasm bug found and
 * worked around along the way (common/libxml2-windows-path-fix.ts).
 *
 * What CAN run under Jest — and does, here — is everything that
 * doesn't touch the ESM-only dependency chain at all: the VAT-exempt
 * guard, which throws before ever calling loadFacturXModels().
 */
describe('buildCrossIndustryInvoice — guards (Jest-safe subset)', () => {
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
    name: 'Client Petit',
    addressLine: '5 avenue des Champs',
    postalCode: '75008',
    city: 'Paris',
    countryCode: 'FR',
    sirenOrRci: null,
    vatNumber: 'FR55987654321',
  };

  it('refuses a VAT-exempt line rather than guessing a UNTDID 5305 category code', async () => {
    const mentions = computeInvoiceMentions('FR', COMPANY, CLIENT, {
      invoiceNumber: '1',
      invoiceDate: '2026-08-30',
      isCreditNote: false,
      correctsInvoiceNumber: null,
      lines: [
        {
          description: 'Export exonéré',
          quantity: '1.00',
          unitPriceHT: '100.00',
          vatRatePercent: null,
        },
      ],
    });
    await expect(buildCrossIndustryInvoice(mentions)).rejects.toThrow(/VAT-exempt line/);
  });
});
