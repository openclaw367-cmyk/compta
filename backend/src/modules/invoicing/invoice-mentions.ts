import { ConflictException, NotImplementedException } from '@nestjs/common';
import { Money } from '../../common/decimal';
import { computeInvoiceLineAmounts } from './invoice-line-math';

/**
 * Mandatory-mentions data model — see
 * specs/invoicing-phase-a-implementation-spec.md decision 5 and
 * specs/invoicing-plan.md §1.3/§1.6. A DATA MODEL, not a renderer: this
 * produces the structured fields a future PDF/Factur-X layer would
 * consume, not a file — see the spec's own "Deferred, explicitly".
 *
 * France's mentions are confirmed against two primary sources, fetched
 * directly (see specs/invoicing-plan.md §1.3, not recalled from
 * training data):
 *  - CGI Annexe II, art. 242 nonies A (tax mentions — identity, VAT
 *    numbers, sequential numbering, per-line detail, VAT totals by
 *    rate).
 *  - Code de commerce, art. L441-10 (payment-terms mentions — the
 *    late-payment penalty rate, the 40 € forfaitary recovery indemnity,
 *    escompte conditions) — a SEPARATE legal regime from the CGI, not
 *    covered by ca3-declaration.ts or any other VAT module in this app.
 *
 * Monaco's mentions are SEPARATELY confirmed (specs/invoicing-plan.md
 * §1.6, from monentreprise.gouv.mc directly) but deliberately NOT
 * implemented here — see computeInvoiceMentionsMC()'s own doc comment
 * for why mentions-list confirmation is not the same thing as
 * numbering/transmission-regime confirmation.
 */

export type InvoiceJurisdiction = 'FR' | 'MC';

/**
 * Structured, not free-text — needed as of the Factur-X CII renderer
 * (EN16931 Schematron BR-8/BR-9 require at least a country code for
 * both seller and buyer; a free-text address string can't be parsed
 * into that without guessing). Mirrors `Company`'s own
 * addressLine/postalCode/city/country shape.
 */
export interface InvoiceMentionsAddress {
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2 country code (e.g. "FR"), required. */
  countryCode: string;
}

export interface InvoiceMentionsPartyIdentity {
  name: string;
  address: InvoiceMentionsAddress;
  /** Human-readable, comma-joined rendering of `address` — for display only. */
  formattedAddress: string;
  vatNumber: string | null;
  sirenOrRci: string | null;
  /** Shown in the invoice PDF's own header contact block — seller only in
   *  practice today (Account/tiers, the buyer's own identity source, has
   *  no phone/email field), but kept on the shared party shape rather
   *  than a seller-only field so a future business-client contact
   *  capability needs no shape change. Null, never a placeholder, when
   *  the underlying record has none configured. */
  phone: string | null;
  email: string | null;
}

export interface InvoiceMentionsLine {
  description: string;
  quantity: string;
  unitPriceHT: string;
  totalHT: string;
  vatRatePercent: string | null;
}

export interface InvoiceMentionsVatBreakdown {
  ratePercent: string;
  baseHT: string;
  vatAmount: string;
}

/** Payment instructions shown on devis/facture PDFs — see invoicing.controller.ts /
 *  invoice-to-cii.ts. Null (not a placeholder) when the company hasn't configured any of
 *  bankName/iban/bic — "flag, don't fake". */
export interface InvoicePaymentInstructions {
  bankName: string;
  iban: string;
  bic: string;
}

/** FACTURE/AVOIR are real fiscal documents (CGI Annexe II art. 242 nonies A / Code de
 *  commerce art. L441-10 both apply). DEVIS is a quote — no legal sequential numbering, no
 *  L441-10 late-payment notices (that regime governs invoices, not quotes) — see
 *  computeDevisMentions(). renderInvoicePdf() branches its title/footer on this field rather
 *  than overloading isCreditNote, which stays FACTURE/AVOIR-only. */
export type InvoiceDocumentKind = 'FACTURE' | 'AVOIR' | 'DEVIS';

export interface InvoiceMentions {
  jurisdiction: 'FR';
  documentKind: InvoiceDocumentKind;
  /** Empty string for a DEVIS — a quote has no legal sequential-numbering requirement. */
  invoiceNumber: string;
  invoiceDate: string;
  isCreditNote: boolean;
  correctsInvoiceNumber: string | null;
  seller: InvoiceMentionsPartyIdentity;
  buyer: InvoiceMentionsPartyIdentity;
  lines: InvoiceMentionsLine[];
  vatByRate: InvoiceMentionsVatBreakdown[];
  totalHT: string;
  totalVAT: string;
  totalTTC: string;
  /** Code de commerce art. L441-10 — static, sourced wording, not user-editable. Present even
   *  on a DEVIS's own data (it's still accurate FACTURE-only text); renderInvoicePdf() is what
   *  decides whether to print it, based on documentKind. */
  latePaymentPenaltyNotice: string;
  forfeitIndemnityNotice: string;
  escompteNotice: string;
  paymentInstructions: InvoicePaymentInstructions | null;
}

export interface InvoiceMentionsCompanyInput {
  name: string;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2 country code, derived from Company.jurisdiction ('FR'|'MC') by the
   *  caller — NOT parsed from Company.country (a free-text display name), see schema doc comment. */
  countryCode: string;
  siren: string | null;
  rci: string | null;
  vatNumber: string | null;
  /** Null when bankName/iban/bic aren't all configured — see InvoicePaymentInstructions. */
  paymentInstructions: InvoicePaymentInstructions | null;
  phone: string | null;
  email: string | null;
}

export interface InvoiceMentionsClientInput {
  name: string;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO 3166-1 alpha-2 country code (e.g. "FR"), required — see InvoiceMentionsAddress. */
  countryCode: string;
  sirenOrRci: string | null;
  vatNumber: string | null;
}

export interface InvoiceMentionsLineInput {
  description: string;
  quantity: string;
  unitPriceHT: string;
  vatRatePercent: string | null;
}

export interface InvoiceMentionsInvoiceInput {
  invoiceNumber: string;
  invoiceDate: string;
  isCreditNote: boolean;
  correctsInvoiceNumber: string | null;
  lines: InvoiceMentionsLineInput[];
}

function formatAddress(address: InvoiceMentionsAddress): string {
  const parts = [
    address.addressLine,
    [address.postalCode, address.city].filter(Boolean).join(' '),
    address.countryCode,
  ];
  return parts.filter((p) => p && p.length > 0).join(', ');
}

// Code de commerce, art. L441-10 / D441-5 — see specs/invoicing-plan.md §1.3.
const LATE_PAYMENT_PENALTY_NOTICE =
  "Taux des pénalités de retard applicable en cas de non-paiement à la date d'échéance figurant " +
  'sur la facture : conforme au taux légal en vigueur (art. L441-10 du Code de commerce).';
const FORFEIT_INDEMNITY_NOTICE =
  'Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40,00 € ' +
  '(art. D441-5 du Code de commerce), due de plein droit dès le premier jour de retard.';
const ESCOMPTE_NOTICE = "Pas d'escompte pour paiement anticipé.";

/** Pure. Throws NotImplementedException for a jurisdiction whose mentions aren't built yet (MC). */
export function computeInvoiceMentions(
  jurisdiction: InvoiceJurisdiction,
  company: InvoiceMentionsCompanyInput,
  client: InvoiceMentionsClientInput,
  invoice: InvoiceMentionsInvoiceInput,
): InvoiceMentions {
  if (jurisdiction === 'FR') {
    return computeInvoiceMentionsFR(company, client, invoice);
  }
  if (jurisdiction === 'MC') {
    return computeInvoiceMentionsMC();
  }
  throw new NotImplementedException(
    `Invoicing is not implemented for jurisdiction "${String(jurisdiction)}".`,
  );
}

/**
 * The line-items/VAT-by-rate/totals computation shared by
 * computeInvoiceMentionsFR() and computeDevisMentionsFR() — a devis and
 * a facture price identically, they only differ in numbering/L441-10
 * applicability (see documentKind). Extracted so that arithmetic is
 * never duplicated between the two.
 */
function computeLinesAndTotals(lines: InvoiceMentionsLineInput[]): {
  lines: InvoiceMentionsLine[];
  vatByRate: InvoiceMentionsVatBreakdown[];
  totalHT: string;
  totalVAT: string;
  totalTTC: string;
} {
  const outLines: InvoiceMentionsLine[] = [];
  const vatGroups = new Map<string, { ratePercent: string; baseHT: Money; vatAmount: Money }>();
  let totalHT = Money.zero();
  let totalVAT = Money.zero();

  for (const line of lines) {
    const amounts = computeInvoiceLineAmounts(line.quantity, line.unitPriceHT, line.vatRatePercent);
    totalHT = totalHT.plus(amounts.totalHT);
    totalVAT = totalVAT.plus(amounts.vatAmount);
    outLines.push({
      description: line.description,
      quantity: line.quantity,
      unitPriceHT: line.unitPriceHT,
      totalHT: amounts.totalHT.toApiString(),
      vatRatePercent: line.vatRatePercent,
    });

    if (line.vatRatePercent) {
      const key = line.vatRatePercent;
      const group = vatGroups.get(key) ?? {
        ratePercent: line.vatRatePercent,
        baseHT: Money.zero(),
        vatAmount: Money.zero(),
      };
      group.baseHT = group.baseHT.plus(amounts.totalHT);
      group.vatAmount = group.vatAmount.plus(amounts.vatAmount);
      vatGroups.set(key, group);
    }
  }

  return {
    lines: outLines,
    vatByRate: [...vatGroups.values()].map((g) => ({
      ratePercent: g.ratePercent,
      baseHT: g.baseHT.toApiString(),
      vatAmount: g.vatAmount.toApiString(),
    })),
    totalHT: totalHT.toApiString(),
    totalVAT: totalVAT.toApiString(),
    totalTTC: totalHT.plus(totalVAT).toApiString(),
  };
}

function buildParty(
  input:
    | InvoiceMentionsCompanyInput
    | InvoiceMentionsClientInput
    | {
        name: string;
        addressLine: string | null;
        postalCode: string | null;
        city: string | null;
        countryCode: string;
        siren?: string | null;
        rci?: string | null;
        sirenOrRci?: string | null;
        vatNumber: string | null;
        phone?: string | null;
        email?: string | null;
      },
): InvoiceMentionsPartyIdentity {
  const address = {
    addressLine: input.addressLine,
    postalCode: input.postalCode,
    city: input.city,
    countryCode: input.countryCode,
  };
  return {
    name: input.name,
    address,
    formattedAddress: formatAddress(address),
    vatNumber: input.vatNumber,
    sirenOrRci: 'sirenOrRci' in input ? (input.sirenOrRci ?? null) : (input.siren ?? null),
    // Only InvoiceMentionsCompanyInput carries these today — see
    // InvoiceMentionsPartyIdentity's own doc comment for why the shape
    // stays shared regardless.
    phone: 'phone' in input ? (input.phone ?? null) : null,
    email: 'email' in input ? (input.email ?? null) : null,
  };
}

function computeInvoiceMentionsFR(
  company: InvoiceMentionsCompanyInput,
  client: InvoiceMentionsClientInput,
  invoice: InvoiceMentionsInvoiceInput,
): InvoiceMentions {
  const { lines, vatByRate, totalHT, totalVAT, totalTTC } = computeLinesAndTotals(invoice.lines);

  return {
    jurisdiction: 'FR',
    documentKind: invoice.isCreditNote ? 'AVOIR' : 'FACTURE',
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    isCreditNote: invoice.isCreditNote,
    correctsInvoiceNumber: invoice.correctsInvoiceNumber,
    seller: buildParty(company),
    buyer: buildParty(client),
    lines,
    vatByRate,
    totalHT,
    totalVAT,
    totalTTC,
    latePaymentPenaltyNotice: LATE_PAYMENT_PENALTY_NOTICE,
    forfeitIndemnityNotice: FORFEIT_INDEMNITY_NOTICE,
    escompteNotice: ESCOMPTE_NOTICE,
    paymentInstructions: company.paymentInstructions,
  };
}

/**
 * Monaco's mandatory-MENTIONS LIST is separately confirmed (from
 * monentreprise.gouv.mc directly — see specs/invoicing-plan.md §1.6)
 * but is deliberately NOT implemented here. Confirming what fields must
 * appear is not the same as confirming the numbering/transmission
 * regime those fields would need to be assembled and issued under — the
 * official Monaco government portal, current as of one month before
 * this was written, describes only the pre-reform e-signature-based
 * regime with no mandatory-platform requirement, in direct tension with
 * secondary sources that (uncited) assume French-calendar symmetry.
 * Implementing this now would mean guessing which regime applies —
 * exactly what this app's own "Monaco compliance" discipline forbids.
 * Re-check the primary sources in specs/invoicing-plan.md §1.6 before
 * ever filling this in; this is a CONTAINED addition once confirmed —
 * a new rule table here, nothing else in this module changes.
 */
function computeInvoiceMentionsMC(): never {
  throw new NotImplementedException(
    'Monaco invoicing rules pending official confirmation — see specs/invoicing-plan.md §1.6. ' +
      'The official Monaco government portal (monentreprise.gouv.mc) does not yet confirm the ' +
      'numbering/transmission regime for Monaco invoices; re-check it (and/or the Direction des ' +
      'Services Fiscaux de Monaco) against a cited Monaco legal source before implementing ' +
      'computeInvoiceMentionsMC().',
  );
}

export interface DevisMentionsInvoiceInput {
  invoiceDate: string;
  lines: InvoiceMentionsLineInput[];
}

/**
 * A devis (quote) — a DRAFT invoice's content, priced identically to a
 * real facture (computeLinesAndTotals()), but with NO legal
 * sequential-numbering requirement (CGI Annexe II art. 242 nonies A
 * governs invoices, not quotes) and NO L441-10 late-payment/indemnity/
 * escompte applicability (that regime is specific to invoices too) —
 * documentKind: 'DEVIS' is what tells renderInvoicePdf() to omit both.
 * `invoiceNumber` is deliberately an empty string, not a fabricated
 * reference. Gated to FR the same way computeInvoiceMentions() is —
 * Monaco's own devis/quote conventions are just as unconfirmed as its
 * invoice numbering regime, so this throws the identical
 * NotImplementedException for MC rather than guessing a lighter-weight
 * document needs no such gate.
 */
export function computeDevisMentions(
  jurisdiction: InvoiceJurisdiction,
  company: InvoiceMentionsCompanyInput,
  client: InvoiceMentionsClientInput,
  invoice: DevisMentionsInvoiceInput,
): InvoiceMentions {
  if (jurisdiction === 'MC') {
    return computeInvoiceMentionsMC();
  }
  if (jurisdiction !== 'FR') {
    throw new NotImplementedException(
      `Invoicing is not implemented for jurisdiction "${String(jurisdiction)}".`,
    );
  }
  const { lines, vatByRate, totalHT, totalVAT, totalTTC } = computeLinesAndTotals(invoice.lines);
  return {
    jurisdiction: 'FR',
    documentKind: 'DEVIS',
    invoiceNumber: '',
    invoiceDate: invoice.invoiceDate,
    isCreditNote: false,
    correctsInvoiceNumber: null,
    seller: buildParty(company),
    buyer: buildParty(client),
    lines,
    vatByRate,
    totalHT,
    totalVAT,
    totalTTC,
    latePaymentPenaltyNotice: LATE_PAYMENT_PENALTY_NOTICE,
    forfeitIndemnityNotice: FORFEIT_INDEMNITY_NOTICE,
    escompteNotice: ESCOMPTE_NOTICE,
    paymentInstructions: company.paymentInstructions,
  };
}

/**
 * The oracle for this module — same "two independently-derived figures
 * must tie out" discipline as assertVncTiesToLedger/
 * assertCashFlowReconciles elsewhere in this app. Mentions computes its
 * own totalTTC by grouping lines by VAT RATE; invoice-posting.ts
 * computes its own totalTTC by grouping lines by (revenue account, VAT
 * rate) — genuinely different groupings, sharing only
 * computeInvoiceLineAmounts()'s per-line arithmetic. If they ever
 * disagree, the mentions shown to a client would not match what was
 * actually posted to the ledger — exactly the failure this assertion
 * exists to catch before an invoice is ever finalized.
 */
export function assertInvoiceMentionsTieToPosting(
  mentions: InvoiceMentions,
  postedTotalTTC: string,
): void {
  if (!Money.fromString(mentions.totalTTC).equals(Money.fromString(postedTotalTTC))) {
    throw new ConflictException(
      `Invoice mentions total (${mentions.totalTTC}) does not match the amount posted to the ` +
        `ledger (${postedTotalTTC}). This is a calculation bug — the invoice was not finalized.`,
    );
  }
}
