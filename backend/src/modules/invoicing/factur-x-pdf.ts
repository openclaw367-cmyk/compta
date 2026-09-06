import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import { InvoiceMentions } from './invoice-mentions';
import {
  formatMoneyForPdf,
  formatPercentForPdf,
  sanitizeForWinAnsi,
} from '../../common/pdf/pdf-report-renderer';

/**
 * The human-readable PDF layer — what `generate()` (@stafyniaksacha/
 * facturx) embeds the CII XML into on its way to becoming a PDF/A-3
 * Factur-X file. Restyled (2026-09-06) to follow the layout of a real
 * reference invoice the user supplied — `specs/Facture ACS.pdf` (a
 * Monaco translator's "note d'honoraires"): sender top-left, recipient
 * in its own right-aligned block lower down (the classic French
 * letter/"fenêtre" placement, not side-by-side columns), a right-aligned
 * "Fait à <ville>, le <date>" line, a centered bold underlined title,
 * a right-aligned totals block with a rule before the grand total, a
 * courteous "Valeur en votre aimable règlement." closing line, and a
 * small centered footer carrying the bank details. Every mandatory
 * mention this app already computes (`InvoiceMentions`) is still
 * present — this pass only REPOSITIONS/RESTYLES content, nothing was
 * dropped. See CLAUDE.md "Invoicing — Factur-X rendering" for the
 * original design and specs/invoicing-factur-x-implementation-spec.md
 * for the stated single-A4-page scope (still true here — an invoice
 * with enough lines to overflow the page remains a known,
 * undocumented-further limitation, unchanged by this pass).
 */

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const LINE_HEIGHT = 14;
/** Fixed vertical offset for the recipient block — an envelope-window
 *  address placement is conventionally fixed, not "wherever the sender
 *  block happens to end", and it also guarantees the recipient block
 *  never collides with a short sender block. */
const BUYER_BLOCK_OFFSET = 140;

const FRENCH_MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** "2026-09-01" -> "01 septembre 2026", matching the reference template's date style. Falls back to the raw ISO string rather than guessing at a malformed input. */
function formatFrenchDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, yearStr, monthStr, dayStr] = match;
  const monthIndex = Number(monthStr) - 1;
  if (monthIndex < 0 || monthIndex > 11) return iso;
  return `${dayStr} ${FRENCH_MONTHS[monthIndex]} ${yearStr}`;
}

export async function renderInvoicePdf(mentions: InvoiceMentions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_HEIGHT - MARGIN;

  const draw = (
    text: string,
    x: number,
    size = 10,
    useFont: PDFFont = font,
    color = rgb(0, 0, 0),
  ) => {
    page.drawText(sanitizeForWinAnsi(text), { x, y, size, font: useFont, color });
  };
  const drawRight = (
    text: string,
    rightEdgeX: number,
    size = 10,
    useFont: PDFFont = font,
    color = rgb(0, 0, 0),
  ) => {
    const sanitized = sanitizeForWinAnsi(text);
    const width = useFont.widthOfTextAtSize(sanitized, size);
    page.drawText(sanitized, { x: rightEdgeX - width, y, size, font: useFont, color });
  };
  const drawCentered = (
    text: string,
    centerX: number,
    size = 10,
    useFont: PDFFont = font,
    color = rgb(0, 0, 0),
  ) => {
    const sanitized = sanitizeForWinAnsi(text);
    const width = useFont.widthOfTextAtSize(sanitized, size);
    page.drawText(sanitized, { x: centerX - width / 2, y, size, font: useFont, color });
  };
  const newLine = (n = 1) => {
    y -= LINE_HEIGHT * n;
  };
  const pageCenterX = PAGE_WIDTH / 2;
  const rightEdgeX = PAGE_WIDTH - MARGIN;

  // ---------------------------------------------------------------------
  // Seller — top-left, unchanged position from before this pass.
  // ---------------------------------------------------------------------
  const partyLines = (party: InvoiceMentions['seller']) => {
    const lines = [party.name, party.formattedAddress];
    if (party.sirenOrRci) lines.push(`SIREN/RCI : ${party.sirenOrRci}`);
    if (party.vatNumber) lines.push(`N° TVA : ${party.vatNumber}`);
    return lines;
  };
  const sellerTopY = y;
  draw(mentions.seller.name, MARGIN, 11, bold);
  newLine(1.3);
  for (const line of partyLines(mentions.seller).slice(1)) {
    draw(line, MARGIN, 9);
    newLine();
  }
  const sellerBottomY = y;

  // ---------------------------------------------------------------------
  // Seller contact block — top-right, same starting row as the seller's
  // own name (they occupy the left/right halves of the same header rows,
  // drawn independently of each other's vertical flow), matching the
  // reference template's "Tél. / Fax : ... / E-mail : ..." placement.
  // Omitted entirely when neither is configured — never a placeholder
  // ("flag, don't fake" — Company.phone/email are both optional).
  // ---------------------------------------------------------------------
  const contactLines: string[] = [];
  if (mentions.seller.phone) contactLines.push(`Tél. : ${mentions.seller.phone}`);
  if (mentions.seller.email) contactLines.push(`E-mail : ${mentions.seller.email}`);
  if (contactLines.length > 0) {
    y = sellerTopY;
    for (const line of contactLines) {
      drawRight(line, rightEdgeX, 9);
      newLine();
    }
  }
  y = sellerBottomY;

  // ---------------------------------------------------------------------
  // Buyer — its own right-aligned block, fixed distance below the top
  // (the "fenêtre" placement from the reference template), not a
  // side-by-side column next to the seller.
  // ---------------------------------------------------------------------
  y = sellerTopY - BUYER_BLOCK_OFFSET;
  const buyerLines = partyLines(mentions.buyer);
  drawRight(buyerLines[0], rightEdgeX, 10, bold);
  newLine(1.3);
  for (const line of buyerLines.slice(1)) {
    drawRight(line, rightEdgeX, 9);
    newLine();
  }
  newLine(1.5);

  // ---------------------------------------------------------------------
  // "Fait à <ville>, le <date>" — right-aligned, two lines, matching the
  // template's "Monaco, / le 01 septembre 2026". The city is honestly
  // omitted (never guessed) when the seller has none on file.
  // ---------------------------------------------------------------------
  if (mentions.seller.address.city) {
    drawRight(`${mentions.seller.address.city},`, rightEdgeX, 10);
    newLine();
  }
  drawRight(`Le ${formatFrenchDate(mentions.invoiceDate)}.`, rightEdgeX, 10);
  newLine(2.5);

  y = Math.min(y, sellerBottomY - LINE_HEIGHT * 1.5);

  // ---------------------------------------------------------------------
  // Title — centered, bold, underlined, matching the template's own
  // "NOTE D'HONORAIRES N° ..." treatment. documentKind/invoiceNumber
  // stay this app's own established terms (FACTURE/AVOIR/DEVIS) — the
  // template is a layout model, not a reason to rename a legally
  // distinct document type.
  // ---------------------------------------------------------------------
  newLine(0.5);
  const titleText =
    mentions.documentKind === 'DEVIS'
      ? 'DEVIS'
      : `${mentions.documentKind} N° ${mentions.invoiceNumber}`;
  const titleSize = 14;
  const sanitizedTitle = sanitizeForWinAnsi(titleText);
  const titleWidth = bold.widthOfTextAtSize(sanitizedTitle, titleSize);
  drawCentered(titleText, pageCenterX, titleSize, bold);
  page.drawLine({
    start: { x: pageCenterX - titleWidth / 2, y: y - 3 },
    end: { x: pageCenterX + titleWidth / 2, y: y - 3 },
    thickness: 1,
    color: rgb(0, 0, 0),
  });
  newLine(1.6);
  if (mentions.isCreditNote && mentions.correctsInvoiceNumber) {
    drawCentered(`(Rectifie la facture n° ${mentions.correctsInvoiceNumber})`, pageCenterX, 9);
    newLine(1.6);
  }
  newLine(1);

  // ---------------------------------------------------------------------
  // Line items table.
  // ---------------------------------------------------------------------
  const colX = { description: MARGIN, qty: 300, unitPrice: 360, rate: 430, totalHT: 480 };
  draw('Désignation', colX.description, 9, bold);
  draw('Qté', colX.qty, 9, bold);
  draw('PU HT', colX.unitPrice, 9, bold);
  draw('TVA', colX.rate, 9, bold);
  draw('Total HT', colX.totalHT, 9, bold);
  newLine();
  page.drawLine({
    start: { x: MARGIN, y: y + 4 },
    end: { x: PAGE_WIDTH - MARGIN, y: y + 4 },
    thickness: 0.5,
    color: rgb(0.6, 0.6, 0.6),
  });
  newLine(0.3);

  for (const line of mentions.lines) {
    draw(line.description.slice(0, 45), colX.description, 9);
    draw(line.quantity, colX.qty, 9);
    draw(formatMoneyForPdf(line.unitPriceHT), colX.unitPrice, 9);
    draw(line.vatRatePercent ? formatPercentForPdf(line.vatRatePercent) : 'exonéré', colX.rate, 9);
    draw(formatMoneyForPdf(line.totalHT), colX.totalHT, 9);
    newLine();
  }
  newLine(1.5);

  // ---------------------------------------------------------------------
  // Totals — right-aligned label/amount rows, a rule before the grand
  // total, and the grand total itself double-underlined, matching the
  // reference template's "Montant / T.V.A. 20% / Montant T.T.C."
  // treatment (generalized here to however many distinct VAT rates this
  // invoice actually has, rather than the template's single-rate case).
  // ---------------------------------------------------------------------
  const totalsLabelX = 350;
  draw('Total HT', totalsLabelX, 10);
  drawRight(formatMoneyForPdf(mentions.totalHT), rightEdgeX, 10);
  newLine();
  for (const bucket of mentions.vatByRate) {
    draw(`Dont TVA ${formatPercentForPdf(bucket.ratePercent)}`, totalsLabelX, 9);
    drawRight(formatMoneyForPdf(bucket.vatAmount), rightEdgeX, 9);
    newLine();
  }
  newLine(0.3);
  page.drawLine({
    start: { x: totalsLabelX, y: y + 8 },
    end: { x: rightEdgeX, y: y + 8 },
    thickness: 0.5,
    color: rgb(0.4, 0.4, 0.4),
  });
  newLine(0.3);
  draw('Montant T.T.C.', totalsLabelX, 11, bold);
  const ttcText = formatMoneyForPdf(mentions.totalTTC);
  drawRight(ttcText, rightEdgeX, 11, bold);
  const underlineWidth = bold.widthOfTextAtSize(sanitizeForWinAnsi(ttcText), 11);
  for (const offset of [-2, -4]) {
    page.drawLine({
      start: { x: rightEdgeX - underlineWidth, y: y + offset },
      end: { x: rightEdgeX, y: y + offset },
      thickness: 0.6,
      color: rgb(0, 0, 0),
    });
  }
  newLine(2.5);

  // ---------------------------------------------------------------------
  // Closing courtesy line — FACTURE/AVOIR only (a devis isn't a payment
  // request), matching the template's "Valeur en votre aimable règlement."
  // ---------------------------------------------------------------------
  if (mentions.documentKind !== 'DEVIS') {
    drawCentered('Valeur en votre aimable règlement.', pageCenterX, 10);
    newLine(2);
  }

  // ---------------------------------------------------------------------
  // Footer — centered, small text near the bottom margin: mandatory
  // L441-10 notices (FACTURE/AVOIR only), then bank details + the
  // seller's own VAT number on one line, matching the template's own
  // "Banque : ... / IBAN : ... BIC : ... - N°TVA intracommunautaire : ..."
  // convention. The VAT number itself is ALREADY a mandatory mention
  // shown in the seller block above — repeating it here (only when bank
  // details exist to repeat it alongside) mirrors the template rather
  // than being load-bearing on its own.
  // ---------------------------------------------------------------------
  const footerLines: string[] = [];
  if (mentions.documentKind !== 'DEVIS') {
    footerLines.push(
      mentions.latePaymentPenaltyNotice,
      mentions.forfeitIndemnityNotice,
      mentions.escompteNotice,
    );
  }
  if (mentions.paymentInstructions) {
    const vatSuffix = mentions.seller.vatNumber
      ? ` - N° TVA intracommunautaire : ${mentions.seller.vatNumber}`
      : '';
    footerLines.push(
      `Banque : ${mentions.paymentInstructions.bankName}`,
      `IBAN : ${mentions.paymentInstructions.iban}  BIC : ${mentions.paymentInstructions.bic}${vatSuffix}`,
    );
  }

  if (footerLines.length > 0) {
    let footerY = MARGIN + LINE_HEIGHT * 0.5;
    const wrappedBlocks = footerLines.map((line) =>
      wrapCentered(sanitizeForWinAnsi(line), font, 7, PAGE_WIDTH - 2 * MARGIN),
    );
    const footerLineCount = wrappedBlocks.reduce((sum, block) => sum + block.length, 0);
    footerY += LINE_HEIGHT * 0.75 * (footerLineCount - 1);
    for (const block of wrappedBlocks) {
      for (const wrappedLine of block) {
        const width = font.widthOfTextAtSize(wrappedLine, 7);
        page.drawText(wrappedLine, {
          x: pageCenterX - width / 2,
          y: footerY,
          size: 7,
          font,
          color: rgb(0.35, 0.35, 0.35),
        });
        footerY -= LINE_HEIGHT * 0.75;
      }
    }
  }

  return doc.save();
}

/** Naive word-wrap at a fixed character budget, returning lines ready to be centered individually — the footer notices are short, fixed strings, not user content. */
function wrapCentered(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const approxCharsPerLine = Math.floor(maxWidth / (size * 0.5));
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > approxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
