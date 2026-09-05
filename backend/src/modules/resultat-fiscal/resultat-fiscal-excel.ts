import ExcelJS from 'exceljs';
import { FiscalYear } from '@prisma/client';
import {
  MONEY_NUMBER_FORMAT,
  moneyToExcelNumber,
  styleHeaderRow,
} from '../../common/excel/excel-report-helpers';
import { ResultatFiscalResult } from './resultat-fiscal';

/** Verbatim — see resultat-fiscal-pdf.ts's own doc comment for why this must never be dropped. */
const HONESTY_BANNER =
  'Ce tableau se recoupe arithmétiquement — cela ne garantit pas que tous les retraitements ' +
  'fiscaux applicables ont été déclarés.';

/**
 * Détermination du résultat fiscal Excel export — see CLAUDE.md
 * "Reporting/export flexibility". Same honesty-banner requirement as
 * the PDF export — it's the sheet's own first row, not a footnote.
 * `sheet.columns` is configured with NO `header` field on purpose, so
 * exceljs never auto-writes row 1 — the banner occupies row 1, a blank
 * spacer row 2, and the real column headers are written manually as
 * row 3.
 */
export async function renderResultatFiscalExcel(
  result: ResultatFiscalResult,
  fiscalYear: FiscalYear,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Résultat fiscal ${fiscalYear.label}`.slice(0, 31));
  sheet.columns = [
    { key: 'code', width: 10 },
    { key: 'label', width: 55 },
    { key: 'amount', width: 16, style: { numFmt: MONEY_NUMBER_FORMAT } },
    { key: 'extra', width: 16, style: { numFmt: MONEY_NUMBER_FORMAT } },
  ];

  // Positional (array) form, not the key-based object form: the merge below anchors on
  // column 1, and exceljs keeps only the anchor cell's value once cells are merged.
  const bannerRow = sheet.addRow([HONESTY_BANNER]);
  bannerRow.font = { italic: true };
  sheet.mergeCells(bannerRow.number, 1, bannerRow.number, 4);
  sheet.addRow({});
  const headerRow = sheet.addRow({
    code: 'Code',
    label: 'Libellé',
    amount: 'Montant',
    extra: 'Confirmé',
  });
  styleHeaderRow(sheet, headerRow.number);

  sheet.addRow({
    label: 'Résultat comptable',
    amount: moneyToExcelNumber(result.resultatComptable),
  });
  sheet.addRow({
    code: result.impotSurLesSocietes.code,
    label: result.impotSurLesSocietes.label,
    amount: moneyToExcelNumber(result.impotSurLesSocietes.montant),
  });

  const sectionRow = (title: string) => {
    const row = sheet.addRow({ label: title });
    row.font = { bold: true };
  };

  sectionRow('Réintégrations à confirmer (WJ, WG)');
  for (const line of result.reintegrationsConfirmables) {
    sheet.addRow({
      code: line.code,
      label: line.label,
      amount: moneyToExcelNumber(line.suggested),
      extra: moneyToExcelNumber(line.confirmed),
    });
  }

  sectionRow('Réintégrations déclarées');
  for (const line of result.reintegrationsDeclarees) {
    sheet.addRow({ code: line.code, label: line.label, amount: moneyToExcelNumber(line.montant) });
  }
  const totalReint = sheet.addRow({
    label: 'Total réintégrations',
    amount: moneyToExcelNumber(result.totalReintegrations),
  });
  totalReint.font = { bold: true };

  sectionRow('Déductions déclarées');
  for (const line of result.deductionsDeclarees) {
    sheet.addRow({ code: line.code, label: line.label, amount: moneyToExcelNumber(line.montant) });
  }
  const totalDed = sheet.addRow({
    label: 'Total déductions',
    amount: moneyToExcelNumber(result.totalDeductions),
  });
  totalDed.font = { bold: true };

  const finalRow = sheet.addRow({
    label: 'Résultat fiscal',
    amount: moneyToExcelNumber(result.resultatFiscal),
  });
  finalRow.font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
