import { NotImplementedException } from '@nestjs/common';
import type { Models as FacturXModels } from '@stafyniaksacha/facturx';
import { Money } from '../../common/decimal';
import { importEsm } from '../../common/esm-interop';
import { InvoiceMentions } from './invoice-mentions';

/**
 * Maps this app's own InvoiceMentions data (already jurisdiction-
 * branched, already tied to the posted écriture — see invoice-
 * mentions.ts) into a @stafyniaksacha/facturx CrossIndustryInvoiceType,
 * targeting the EN16931 ("Comfort") profile — see
 * specs/invoicing-factur-x-implementation-spec.md for why this profile
 * (the fullest currently-published one; EXTENDED is still "under
 * construction" per FNFE-MPE's own page) and why this library (real
 * official XSD + Schematron EN16931 BR-* validation, Node-native, no
 * Java dependency this sandboxed environment doesn't have).
 *
 * Field shapes here are confirmed against the library's own official
 * example, `examples/Facture_FR_EN16931.xml` in its repository — not
 * derived from the raw UN/CEFACT spec text or guessed from the models'
 * TypeScript signatures alone, since a wrong required-field shape would
 * only surface as an opaque XSD validation failure.
 *
 * SCOPE, stated precisely: only STANDARD-RATED lines are supported this
 * pass — a VAT-exempt line (InvoiceMentionsLine.vatRatePercent === null)
 * throws rather than guessing a VAT category code (UNTDID 5305 has
 * several: E/Exempt, Z/Zero-rated, G/Export, O/Out-of-scope, AE/Reverse
 * charge — which one applies is a legal judgment this app's own data
 * doesn't currently capture, e.g. no exemption-reason field exists).
 * Flag, don't fake — see the implementation spec for the full reasoning.
 *
 * `@stafyniaksacha/facturx` is ESM-only (see its own README); this
 * project's backend is CommonJS throughout. A static `import` of a
 * VALUE from it would compile to a `require()` call and throw
 * ERR_REQUIRE_ESM at runtime — the exact same class of incompatibility
 * CLAUDE.md already documents for pdfjs-dist. `import type` (erased at
 * compile time, never becomes a `require()`) is safe for type
 * positions; every runtime VALUE use goes through a cached dynamic
 * `import()` instead, via `loadFacturXModels()` — this is why
 * `buildCrossIndustryInvoice()` below is async even though its own
 * logic is otherwise pure.
 */

let cachedModels: typeof FacturXModels | null = null;
async function loadFacturXModels(): Promise<typeof FacturXModels> {
  if (!cachedModels) {
    const mod =
      await importEsm<typeof import('@stafyniaksacha/facturx')>('@stafyniaksacha/facturx');
    cachedModels = mod.Models;
  }
  return cachedModels;
}

export type CrossIndustryInvoiceType = InstanceType<typeof FacturXModels.CrossIndustryInvoiceType>;

// UNTDID 1001 document type codes.
const DOCUMENT_TYPE_CODE_INVOICE = '380';
const DOCUMENT_TYPE_CODE_CREDIT_NOTE = '381';

// UNTDID 5305 VAT category code — this pass only emits "S" (standard rate).
const VAT_CATEGORY_STANDARD = 'S';

// UN/ECE Recommendation 20 unit code for "one" (piece) — this app has no
// per-line unit-of-measure field yet, so every line uses this generic default,
// a stated simplification, not a guess about the actual unit.
const DEFAULT_UNIT_CODE = 'C62';

// UNTDID 4461 payment-means code — '58' is SEPA credit transfer, the only
// method this app's Company.iban/bic fields represent (see invoicing.
// service.ts's buildCompanyMentionsInput()).
const PAYMENT_MEANS_SEPA_CREDIT_TRANSFER = '58';

const GUIDELINE_EN16931 = 'urn:cen.eu:en16931:2017';

/**
 * Money-string → native number, ONLY at this exact boundary (the
 * external library's typed model requires a plain `number`, not a
 * Decimal/string) — the same kind of narrow, documented escape hatch as
 * `Money.fromNumber()`/`moneyRatio()` elsewhere in this app, never a
 * general license to use Number()/parseFloat() on money. Safe here:
 * this app's amounts are NUMERIC(15,2), well within a JS double's exact-
 * integer range even after scaling, and the value is never fed back
 * into further money arithmetic — only serialized into XML.
 */
function toAmountNumber(moneyString: string): number {
  return Money.fromString(moneyString).toDecimal().toNumber();
}

function formatIssueDate(isoDate: string): string {
  return isoDate.replaceAll('-', '');
}

export async function buildCrossIndustryInvoice(
  mentions: InvoiceMentions,
): Promise<CrossIndustryInvoiceType> {
  const exemptLine = mentions.lines.find((l) => l.vatRatePercent === null);
  if (exemptLine) {
    throw new NotImplementedException(
      `Factur-X rendering does not yet support a VAT-exempt line ("${exemptLine.description}") — ` +
        'which UNTDID 5305 category code applies (exempt/zero-rated/export/out-of-scope/reverse-' +
        "charge) is a legal judgment this app's data doesn't capture yet. Only standard-rated " +
        'invoices can be rendered to Factur-X this pass — see invoice-to-cii.ts.',
    );
  }

  const M = await loadFacturXModels();

  const buildAddress = (address: InvoiceMentions['seller']['address']) =>
    new M.TradeAddressType({
      lineOne: address.addressLine ? new M.TextType({ value: address.addressLine }) : undefined,
      postcodeCode: address.postalCode ? new M.CodeType({ value: address.postalCode }) : undefined,
      cityName: address.city ? new M.TextType({ value: address.city }) : undefined,
      countryID: new M.CountryIDType({ value: address.countryCode }),
    });

  const buildParty = (party: InvoiceMentions['seller']) =>
    new M.TradePartyType({
      name: new M.TextType({ value: party.name }),
      postalTradeAddress: buildAddress(party.address),
      specifiedLegalOrganization: party.sirenOrRci
        ? new M.LegalOrganizationType({
            id: new M.IDType({ value: party.sirenOrRci, schemeID: '0002' }),
          })
        : undefined,
      specifiedTaxRegistration: party.vatNumber
        ? [
            new M.TaxRegistrationType({
              id: new M.IDType({ value: party.vatNumber, schemeID: 'VA' }),
            }),
          ]
        : undefined,
    });

  const paymentTermsDescription = [
    mentions.latePaymentPenaltyNotice,
    mentions.forfeitIndemnityNotice,
    mentions.escompteNotice,
  ].join(' ');

  return new M.CrossIndustryInvoiceType({
    exchangedDocumentContext: new M.ExchangedDocumentContextType({
      guidelineSpecifiedDocumentContextParameter: new M.DocumentContextParameterType({
        id: new M.IDType({ value: GUIDELINE_EN16931 }),
      }),
    }),
    exchangedDocument: new M.ExchangedDocumentType({
      id: new M.IDType({ value: mentions.invoiceNumber }),
      typeCode: new M.DocumentCodeType({
        value: mentions.isCreditNote ? DOCUMENT_TYPE_CODE_CREDIT_NOTE : DOCUMENT_TYPE_CODE_INVOICE,
      }),
      issueDateTime: new M.DateTimeType({
        dateTimeString: formatIssueDate(mentions.invoiceDate),
        format: '102',
      }),
    }),
    supplyChainTradeTransaction: new M.SupplyChainTradeTransactionType({
      includedSupplyChainTradeLineItem: mentions.lines.map(
        (line, index) =>
          new M.SupplyChainTradeLineItemType({
            associatedDocumentLineDocument: new M.DocumentLineDocumentType({
              lineID: new M.IDType({ value: String(index + 1) }),
            }),
            specifiedTradeProduct: new M.TradeProductType({
              name: new M.TextType({ value: line.description }),
            }),
            specifiedLineTradeAgreement: new M.LineTradeAgreementType({
              netPriceProductTradePrice: new M.TradePriceType({
                chargeAmount: new M.AmountType({ value: toAmountNumber(line.unitPriceHT) }),
              }),
            }),
            specifiedLineTradeDelivery: new M.LineTradeDeliveryType({
              billedQuantity: new M.QuantityType({
                value: toAmountNumber(line.quantity),
                unitCode: DEFAULT_UNIT_CODE,
              }),
            }),
            specifiedLineTradeSettlement: new M.LineTradeSettlementType({
              applicableTradeTax: [
                new M.TradeTaxType({
                  typeCode: new M.TaxTypeCodeType({ value: 'VAT' }),
                  categoryCode: new M.TaxCategoryCodeType({ value: VAT_CATEGORY_STANDARD }),
                  rateApplicablePercent: new M.PercentType({
                    value: toAmountNumber(line.vatRatePercent!),
                  }),
                }),
              ],
              specifiedTradeSettlementLineMonetarySummation:
                new M.TradeSettlementLineMonetarySummationType({
                  lineTotalAmount: new M.AmountType({ value: toAmountNumber(line.totalHT) }),
                }),
            }),
          }),
      ),
      applicableHeaderTradeAgreement: new M.HeaderTradeAgreementType({
        sellerTradeParty: buildParty(mentions.seller),
        buyerTradeParty: buildParty(mentions.buyer),
      }),
      // A genuinely empty ApplicableHeaderTradeDelivery is XSD-valid but Schematron-invalid
      // (PEPPOL-EN16931-R008, "Document MUST not contain empty elements" — confirmed live,
      // not assumed). This app has no separate delivery-date field, so the actual delivery/
      // service date defaults to the invoice's own issue date — a defensible business
      // decision for a services invoice (goods/services are typically delivered on or
      // around the invoice date when nothing else is tracked), not a fabrication.
      applicableHeaderTradeDelivery: new M.HeaderTradeDeliveryType({
        actualDeliverySupplyChainEvent: new M.SupplyChainEventType({
          occurrenceDateTime: new M.DateTimeType({
            dateTimeString: formatIssueDate(mentions.invoiceDate),
            format: '102',
          }),
        }),
      }),
      applicableHeaderTradeSettlement: new M.HeaderTradeSettlementType({
        invoiceCurrencyCode: new M.CurrencyCodeType({ value: 'EUR' }),
        applicableTradeTax: mentions.vatByRate.map(
          (bucket) =>
            new M.TradeTaxType({
              calculatedAmount: new M.AmountType({ value: toAmountNumber(bucket.vatAmount) }),
              typeCode: new M.TaxTypeCodeType({ value: 'VAT' }),
              basisAmount: new M.AmountType({ value: toAmountNumber(bucket.baseHT) }),
              categoryCode: new M.TaxCategoryCodeType({ value: VAT_CATEGORY_STANDARD }),
              rateApplicablePercent: new M.PercentType({
                value: toAmountNumber(bucket.ratePercent),
              }),
            }),
        ),
        specifiedTradeSettlementPaymentMeans: mentions.paymentInstructions
          ? [
              new M.TradeSettlementPaymentMeansType({
                typeCode: new M.PaymentMeansCodeType({
                  value: PAYMENT_MEANS_SEPA_CREDIT_TRANSFER,
                }),
                payeePartyCreditorFinancialAccount: new M.CreditorFinancialAccountType({
                  ibanID: new M.IDType({ value: mentions.paymentInstructions.iban }),
                  accountName: new M.TextType({ value: mentions.paymentInstructions.bankName }),
                }),
                payeeSpecifiedCreditorFinancialInstitution: new M.CreditorFinancialInstitutionType({
                  bicID: new M.IDType({ value: mentions.paymentInstructions.bic }),
                }),
              }),
            ]
          : undefined,
        specifiedTradePaymentTerms: [
          new M.TradePaymentTermsType({
            description: new M.TextType({ value: paymentTermsDescription }),
          }),
        ],
        specifiedTradeSettlementHeaderMonetarySummation:
          new M.TradeSettlementHeaderMonetarySummationType({
            lineTotalAmount: new M.AmountType({ value: toAmountNumber(mentions.totalHT) }),
            taxBasisTotalAmount: new M.AmountType({ value: toAmountNumber(mentions.totalHT) }),
            taxTotalAmount: [
              new M.AmountType({ value: toAmountNumber(mentions.totalVAT), currencyID: 'EUR' }),
            ],
            grandTotalAmount: new M.AmountType({ value: toAmountNumber(mentions.totalTTC) }),
            duePayableAmount: new M.AmountType({ value: toAmountNumber(mentions.totalTTC) }),
          }),
      }),
    }),
  });
}
