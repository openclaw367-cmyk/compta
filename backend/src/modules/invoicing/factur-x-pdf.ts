import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { InvoiceMentions } from './invoice-mentions';

/**
 * The human-readable PDF layer — what `generate()` (@stafyniaksacha/
 * facturx) embeds the CII XML into on its way to becoming a PDF/A-3
 * Factur-X file. This is deliberately a plain, legible layout, not a
 * design pass — see specs/invoicing-factur-x-implementation-spec.md
 * for the stated scope (a single A4 page; an invoice with enough lines
 * to overflow it is a known, undocumented-here limitation, not
 * addressed this pass since this app's own data has never produced
 * one).
 */

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;

export async function renderInvoicePdf(mentions: InvoiceMentions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_HEIGHT - MARGIN;
  const lineHeight = 14;

  const draw = (
    text: string,
    x: number,
    size = 10,
    useFont: PDFFont = font,
    color = rgb(0, 0, 0),
  ) => {
    page.drawText(text, { x, y, size, font: useFont, color });
  };
  const newLine = (n = 1) => {
    y -= lineHeight * n;
  };

  const titleLine =
    mentions.documentKind === 'DEVIS'
      ? 'DEVIS'
      : `${mentions.documentKind} n° ${mentions.invoiceNumber}`;
  draw(titleLine, MARGIN, 18, bold);
  newLine(1.5);
  draw(`Date d'émission : ${mentions.invoiceDate}`, MARGIN, 10);
  if (mentions.isCreditNote && mentions.correctsInvoiceNumber) {
    newLine();
    draw(`Rectifie la facture n° ${mentions.correctsInvoiceNumber}`, MARGIN, 10);
  }
  newLine(2);

  // Seller / buyer, side by side.
  const colWidth = (PAGE_WIDTH - 2 * MARGIN) / 2;
  const topY = y;
  draw('Émetteur', MARGIN, 11, bold);
  draw('Client', MARGIN + colWidth, 11, bold);
  newLine(1.3);
  const partyLines = (party: InvoiceMentions['seller']) => {
    const lines = [party.name, party.formattedAddress];
    if (party.sirenOrRci) lines.push(`SIREN/RCI : ${party.sirenOrRci}`);
    if (party.vatNumber) lines.push(`N° TVA : ${party.vatNumber}`);
    return lines;
  };
  const sellerLines = partyLines(mentions.seller);
  const buyerLines = partyLines(mentions.buyer);
  const maxPartyLines = Math.max(sellerLines.length, buyerLines.length);
  for (let i = 0; i < maxPartyLines; i++) {
    if (sellerLines[i]) draw(sellerLines[i], MARGIN, 9);
    if (buyerLines[i]) draw(buyerLines[i], MARGIN + colWidth, 9);
    newLine();
  }
  y = Math.min(y, topY - lineHeight * (maxPartyLines + 2));
  newLine(1);

  // Line items table.
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
    draw(`${line.unitPriceHT} €`, colX.unitPrice, 9);
    draw(line.vatRatePercent ? `${line.vatRatePercent} %` : 'exonéré', colX.rate, 9);
    draw(`${line.totalHT} €`, colX.totalHT, 9);
    newLine();
  }
  newLine();

  // VAT breakdown + totals.
  const summaryColX = 400;
  draw('Base HT', colX.description, 9, bold);
  draw('Taux', 200, 9, bold);
  draw('TVA', 280, 9, bold);
  newLine();
  for (const bucket of mentions.vatByRate) {
    draw(`${bucket.baseHT} €`, colX.description, 9);
    draw(`${bucket.ratePercent} %`, 200, 9);
    draw(`${bucket.vatAmount} €`, 280, 9);
    newLine();
  }
  newLine();
  draw('Total HT', summaryColX, 10);
  draw(`${mentions.totalHT} €`, summaryColX + 90, 10);
  newLine();
  draw('Total TVA', summaryColX, 10);
  draw(`${mentions.totalVAT} €`, summaryColX + 90, 10);
  newLine();
  draw('Total TTC', summaryColX, 12, bold);
  draw(`${mentions.totalTTC} €`, summaryColX + 90, 12, bold);
  newLine(2.5);

  // Payment instructions — shown on FACTURE/AVOIR/DEVIS alike, whenever the company has
  // configured them ("flag, don't fake" — see Company.bankName/iban/bic's own doc comment).
  if (mentions.paymentInstructions) {
    draw('Coordonnées bancaires', MARGIN, 10, bold);
    newLine(1.3);
    draw(mentions.paymentInstructions.bankName, MARGIN, 9);
    newLine();
    draw(`IBAN : ${mentions.paymentInstructions.iban}`, MARGIN, 9);
    newLine();
    draw(`BIC : ${mentions.paymentInstructions.bic}`, MARGIN, 9);
    newLine(1.5);
  }

  // Mandatory L441-10 notices footer — FACTURE/AVOIR only (Code de commerce art. L441-10
  // governs invoices, not devis/quotes — see invoice-mentions.ts's own doc comment).
  if (mentions.documentKind !== 'DEVIS') {
    const footerLines = [
      mentions.latePaymentPenaltyNotice,
      mentions.forfeitIndemnityNotice,
      mentions.escompteNotice,
    ];
    y = MARGIN + lineHeight * footerLines.length;
    for (const notice of footerLines) {
      drawWrapped(page, notice, MARGIN, y, PAGE_WIDTH - 2 * MARGIN, font, 7, rgb(0.35, 0.35, 0.35));
      y -= lineHeight * 0.9;
    }
  }

  return doc.save();
}

/** Naive word-wrap at a fixed character budget — the footer notices are short, fixed strings, not user content. */
function drawWrapped(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font: PDFFont,
  size: number,
  color: ReturnType<typeof rgb>,
): void {
  const approxCharsPerLine = Math.floor(maxWidth / (size * 0.5));
  const words = text.split(' ');
  let current = '';
  let lineY = y;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > approxCharsPerLine && current) {
      page.drawText(current, { x, y: lineY, size, font, color });
      lineY -= size + 2;
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) {
    page.drawText(current, { x, y: lineY, size, font, color });
  }
}
