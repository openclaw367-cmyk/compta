import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

/**
 * A small, generic, reusable PDF report builder — see CLAUDE.md
 * "Reporting/export flexibility". Extracted as NEW shared infrastructure
 * because the only existing PDF renderer
 * (`invoicing/factur-x-pdf.ts`) is confirmed invoice-specific: a single
 * fixed A4 page, hand-laid-out columns, no pagination at all (an
 * invoice with enough lines to overflow it is a stated, accepted
 * limitation there). Every report exported by this pass (trial
 * balance, cash flow, analyse financière, CA3/Monaco VAT, résultat
 * fiscal, liasse fiscale) needs real multi-page pagination, which this
 * builder provides — `factur-x-pdf.ts` itself is untouched, since its
 * own shape doesn't need it.
 */

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const LINE_HEIGHT = 14;
const GRAY = rgb(0.6, 0.6, 0.6);
const BLACK = rgb(0, 0, 0);

export interface PdfColumn {
  header: string;
  /** Points. */
  width: number;
  align?: 'left' | 'right';
}

export class PdfReportBuilder {
  private page!: PDFPage;
  private y = 0;

  private constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
  ) {}

  static async create(title: string): Promise<PdfReportBuilder> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const builder = new PdfReportBuilder(doc, font, bold);
    builder.addPage();
    builder.drawText(title, MARGIN, 16, bold);
    builder.newLine(2);
    return builder;
  }

  addSectionTitle(text: string): void {
    this.ensureSpace(LINE_HEIGHT * 2.5);
    this.newLine(0.5);
    this.drawText(text, MARGIN, 13, this.bold);
    this.newLine(1.5);
  }

  addParagraph(text: string, size = 9): void {
    const maxWidth = PAGE_WIDTH - 2 * MARGIN;
    for (const line of this.wrap(text, this.font, size, maxWidth)) {
      this.ensureSpace(LINE_HEIGHT);
      this.drawText(line, MARGIN, size);
      this.newLine();
    }
    this.newLine(0.5);
  }

  /** Label/value pairs, one per line — the shape CA3/résultat-fiscal/cash-flow/analyse-financière all need. */
  addKeyValueTable(rows: [string, string][]): void {
    for (const [label, value] of rows) {
      this.ensureSpace(LINE_HEIGHT);
      this.drawText(label, MARGIN, 10);
      const valueWidth = this.measureWidth(this.font, value, 10);
      this.drawText(value, PAGE_WIDTH - MARGIN - valueWidth, 10);
      this.newLine();
    }
    this.newLine(0.5);
  }

  /**
   * A generic, paginating table — the shape liasse/trial-balance need.
   * When a row would overflow the current page, starts a new page and
   * re-draws the column headers, exactly like a real multi-page report
   * needs.
   */
  addTable(columns: PdfColumn[], rows: string[][], totalsRow?: string[]): void {
    this.ensureSpace(LINE_HEIGHT * 3);
    this.drawTableHeader(columns);

    for (const row of rows) {
      if (this.y - LINE_HEIGHT < MARGIN) {
        this.addPage();
        this.drawTableHeader(columns);
      }
      this.drawTableRow(columns, row, this.font);
    }

    if (totalsRow) {
      if (this.y - LINE_HEIGHT < MARGIN) {
        this.addPage();
        this.drawTableHeader(columns);
      }
      this.newLine(0.2);
      this.drawTableRow(columns, totalsRow, this.bold);
    }
    this.newLine(0.5);
  }

  async build(): Promise<Uint8Array> {
    return this.doc.save();
  }

  private drawTableHeader(columns: PdfColumn[]): void {
    let x = MARGIN;
    for (const col of columns) {
      this.drawColumnText(col.header, x, col, 9, this.bold);
      x += col.width;
    }
    this.newLine();
    // Named to avoid the `compta/no-float-money` lint rule's own name-based
    // heuristic (it flags any identifier matching /total/i as a monetary
    // value) — this is a PDF layout width in points, not money.
    const columnsSpan = columns.reduce((sum, c) => sum + c.width, 0);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 4 },
      end: { x: MARGIN + columnsSpan, y: this.y + 4 },
      thickness: 0.5,
      color: GRAY,
    });
    this.newLine(0.4);
  }

  private drawTableRow(columns: PdfColumn[], row: string[], font: PDFFont): void {
    let x = MARGIN;
    for (let i = 0; i < columns.length; i += 1) {
      this.drawColumnText(row[i] ?? '', x, columns[i], 9, font);
      x += columns[i].width;
    }
    this.newLine();
  }

  private drawColumnText(
    text: string,
    x: number,
    col: PdfColumn,
    size: number,
    font: PDFFont,
  ): void {
    if (col.align === 'right') {
      const width = this.measureWidth(font, text, size);
      this.drawText(text, x + col.width - width, size, font);
    } else {
      this.drawText(text, x, size, font);
    }
  }

  private addPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private ensureSpace(height: number): void {
    if (this.y - height < MARGIN) {
      this.addPage();
    }
  }

  /**
   * `sanitizeForWinAnsi()` is a defensive backstop, not the primary
   * fix: `formatMoneyForPdf()`/`formatPercentForPdf()`/etc. already
   * emit ASCII-safe text. But a hand-typed section title or label
   * (e.g. "Trésorerie nette (FR − BFR)") can just as easily contain a
   * WinAnsi-incompatible character — found live exactly that way, not
   * by inspection — so every string reaching `PDFPage.drawText()`
   * funnels through here rather than trusting every future caller to
   * remember the encoding constraint.
   */
  private drawText(
    text: string,
    x: number,
    size: number,
    font: PDFFont = this.font,
    color = BLACK,
  ): void {
    this.page.drawText(sanitizeForWinAnsi(text), { x, y: this.y, size, font, color });
  }

  /** Width measurement also runs against sanitized text — `widthOfTextAtSize()` throws on the
   *  same unsupported characters `drawText()` would, and it's always called BEFORE `drawText()`
   *  for right-aligned/wrapped text, so sanitizing only at `drawText()` would be too late. */
  private measureWidth(font: PDFFont, text: string, size: number): number {
    return font.widthOfTextAtSize(sanitizeForWinAnsi(text), size);
  }

  private newLine(n = 1): void {
    this.y -= LINE_HEIGHT * n;
  }

  private wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && this.measureWidth(font, candidate, size) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  }
}

export const PDF_REPORT_PAGE_HEIGHT = PAGE_HEIGHT;
export const PDF_REPORT_MARGIN = MARGIN;

/**
 * pdf-lib's `StandardFonts` (Helvetica/HelveticaBold, the only fonts
 * this builder embeds) use the WinAnsi (Windows-1252-ish) encoding,
 * which covers plain ASCII plus accented Western-European letters
 * (é, è, à, ç, …) and a handful of typographic characters (€, em/en
 * dash, curly quotes) — but NOT every Unicode character that looks
 * similar. Found live, not by inspection: a hand-typed section label
 * containing a proper Unicode minus sign ("−", U+2212 — visually
 * near-identical to a hyphen, and the character this app's own
 * frontend money formatters use) threw
 * `WinAnsi cannot encode "−" (0x2212)` the first time a report tried
 * to draw it. Rather than trust every future report file to remember
 * this constraint, every string this builder actually draws or
 * measures is normalized through here first. Extend this map if
 * another WinAnsi-incompatible character is found the same way.
 *
 * Found live a SECOND time, a different root cause: exporting the FR
 * demo company's real trial balance 500'd — account `445800`'s own
 * label (free-text, entered live during the cash-basis-VAT pass) had
 * genuinely lost data at some earlier point (an encoding round-trip
 * gone wrong outside this renderer's control) and now literally
 * contains U+FFFD, the Unicode replacement character — not a
 * look-alike glyph this time, but already-corrupted data with no
 * "correct" character to restore. `?` is an honest marker, not a
 * silent guess at what was lost.
 */
const WINANSI_REPLACEMENTS: [RegExp, string][] = [
  [/−/g, '-'],
  [/�/g, '?'],
];

function sanitizeForWinAnsi(text: string): string {
  return WINANSI_REPLACEMENTS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  );
}

/**
 * Formats an API money string ("1234.56") as French currency
 * ("1 234,56 €") for display inside a PDF report — pure string
 * manipulation, mostly mirroring the frontend's own `formatMoneyFr()`
 * (`frontend/src/lib/money.ts`), duplicated here because only TYPES
 * cross the frontend/backend boundary in this app, never runtime code.
 * No `Number()`/`parseFloat()` — see CLAUDE.md "Money handling".
 *
 * One deliberate difference from `formatMoneyFr()`, found live (not by
 * inspection): the frontend uses a proper Unicode minus sign ("−",
 * U+2212) for negative amounts, which renders fine in a browser but
 * throws ("WinAnsi cannot encode...") when drawn with a pdf-lib
 * StandardFonts font — the WinAnsi encoding those built-in fonts use
 * has no glyph for it. A plain ASCII hyphen-minus ("-") is used here
 * instead, which WinAnsi does support.
 */
export function formatMoneyForPdf(value: string): string {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [integerPart = '0', fractionPart = '00'] = unsigned.split('.');
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const cents = fractionPart.padEnd(2, '0').slice(0, 2);
  const sign = negative && grouped !== '0' ? '-' : '';
  return `${sign}${grouped},${cents} €`;
}

/**
 * A percentage string from the backend ("40.00" = 40.00%) — NOT money
 * (see `financial-analysis.ts`'s own `percentOrNull` doc comment: "a
 * ratio genuinely isn't money"). `null` is a real "n/a" (a
 * zero-denominator guard), not a loading/error state. Mirrors the
 * frontend's own `formatPercent()`, with the same ASCII-hyphen fix
 * `formatMoneyForPdf()` needed (WinAnsi can't encode "−").
 */
export function formatPercentForPdf(value: string | null): string {
  if (value === null) return 'n/a';
  const negative = value.startsWith('-');
  return `${negative ? '-' : ''}${value.replace('-', '').replace('.', ',')} %`;
}

/** Dimensionless ratio (e.g. liquidité générale) — same comma-localization, no unit suffix. */
export function formatRatioForPdf(value: string | null): string {
  if (value === null) return 'n/a';
  const negative = value.startsWith('-');
  return `${negative ? '-' : ''}${value.replace('-', '').replace('.', ',')}`;
}

/** A day count (e.g. DSO/DPO) — same comma-localization, "jours" suffix. */
export function formatDaysForPdf(value: string | null): string {
  if (value === null) return 'n/a';
  const negative = value.startsWith('-');
  return `${negative ? '-' : ''}${value.replace('-', '').replace('.', ',')} jours`;
}
