import { PDFDocument } from 'pdf-lib';
import { PdfReportBuilder } from './pdf-report-renderer';

/**
 * pdf-lib itself has no text-extraction API (it's a writer, not a
 * reader) — verifying rendered TEXT content would need pdf-parse
 * (pdfjs-dist), which is confirmed elsewhere in this codebase
 * (invoice-extraction.service.spec.ts's own doc comment) to be
 * incompatible with Jest's CommonJS transform without
 * --experimental-vm-modules. So these tests verify STRUCTURE
 * (page count, that building never throws) by round-tripping the
 * built PDF through `PDFDocument.load()` — real content verification
 * for a couple of reports is done via a one-off ts-node smoke test,
 * same discipline as the Factur-X pass.
 */
describe('PdfReportBuilder', () => {
  it('produces a single page for a short report', async () => {
    const builder = await PdfReportBuilder.create('Test report');
    builder.addSectionTitle('Section');
    builder.addKeyValueTable([
      ['Ligne 1', '100,00 €'],
      ['Ligne 2', '200,00 €'],
    ]);
    builder.addTable(
      [
        { header: 'Compte', width: 200 },
        { header: 'Montant', width: 100, align: 'right' },
      ],
      [
        ['606400', '100,00 €'],
        ['707000', '200,00 €'],
      ],
      ['Total', '300,00 €'],
    );
    builder.addParagraph('Une note explicative de longueur raisonnable.');

    const bytes = await builder.build();
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it('paginates a table whose rows overflow a single page, re-drawing headers on each new page', async () => {
    const builder = await PdfReportBuilder.create('Test report');
    const rows = Array.from({ length: 200 }, (_, i) => [`60640${i}`, `${i}.00 €`]);
    builder.addTable(
      [
        { header: 'Compte', width: 200 },
        { header: 'Montant', width: 100, align: 'right' },
      ],
      rows,
    );

    const bytes = await builder.build();
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
  });

  it('wraps a long paragraph across multiple lines without throwing', async () => {
    const builder = await PdfReportBuilder.create('Test report');
    const longText =
      'Ce tableau se recoupe arithmétiquement — cela ne garantit pas que tous les ' +
      'retraitements fiscaux applicables ont été déclarés. '.repeat(10);
    expect(() => builder.addParagraph(longText)).not.toThrow();

    const bytes = await builder.build();
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it('produces a valid, loadable PDF even with an empty table', async () => {
    const builder = await PdfReportBuilder.create('Empty report');
    builder.addSectionTitle('Rien à afficher');
    builder.addTable([{ header: 'Compte', width: 200 }], []);
    const bytes = await builder.build();
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });

  /**
   * Found live, not by inspection: exporting the FR demo company's real
   * trial balance 500'd because a real account's own free-text label had
   * genuinely lost data at some earlier point and now literally contains
   * U+FFFD (the Unicode replacement character) — WinAnsi cannot encode
   * it, and `addTable()`/`addKeyValueTable()`/`addParagraph()` must all
   * survive this, not just `drawText()` in isolation.
   */
  it('never throws on a string containing the Unicode replacement character (U+FFFD)', async () => {
    const corrupted = 'TVA collect�e sur encaissements';
    const builder = await PdfReportBuilder.create('Test report');
    expect(() => builder.addSectionTitle(corrupted)).not.toThrow();
    expect(() => builder.addParagraph(corrupted)).not.toThrow();
    expect(() => builder.addKeyValueTable([[corrupted, '100,00 €']])).not.toThrow();
    expect(() => builder.addTable([{ header: 'Compte', width: 300 }], [[corrupted]])).not.toThrow();

    const bytes = await builder.build();
    await expect(PDFDocument.load(bytes)).resolves.toBeDefined();
  });
});
