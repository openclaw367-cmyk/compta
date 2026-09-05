import ExcelJS from 'exceljs';
import { Company } from '@prisma/client';
import {
  MONEY_NUMBER_FORMAT,
  moneyToExcelNumber,
  styleHeaderRow,
} from '../../common/excel/excel-report-helpers';
import { Ca3Declaration } from './ca3-declaration';
import { MonacoDeclaration } from './monaco-declaration';

function moneyOrZero(value: string | null): string {
  return value ?? '0.00';
}

/**
 * CA3 (FR) / DSF (Monaco) VAT declaration Excel export — see CLAUDE.md
 * "Reporting/export flexibility". Same jurisdiction dispatch as
 * `vat-declaration-pdf.ts`. Two sheets: the rate breakdown and the
 * declaration's own named lines.
 */
export async function renderVatDeclarationExcel(
  declaration: Ca3Declaration | MonacoDeclaration,
  company: Company,
  periodStart: string,
  periodEnd: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  const rateSheet = workbook.addWorksheet('TVA par taux');
  rateSheet.columns = [
    { header: 'Ligne', key: 'ligne', width: 10 },
    { header: 'Libellé', key: 'label', width: 40 },
    { header: 'Taux (%)', key: 'rate', width: 12 },
    { header: 'Base HT', key: 'baseHT', width: 16, style: { numFmt: MONEY_NUMBER_FORMAT } },
    { header: 'Taxe', key: 'taxe', width: 16, style: { numFmt: MONEY_NUMBER_FORMAT } },
  ];
  styleHeaderRow(rateSheet, 1);
  for (const line of declaration.collecteeByRate) {
    rateSheet.addRow({
      ligne: line.ligne,
      label: line.label,
      rate: Number(line.ratePercent),
      baseHT: moneyToExcelNumber(line.baseHT),
      taxe: moneyToExcelNumber(line.taxe),
    });
  }

  const summarySheet = workbook.addWorksheet(company.jurisdiction === 'FR' ? 'CA3' : 'DSF');
  summarySheet.columns = [
    { header: `Période du ${periodStart} au ${periodEnd}`, key: 'label', width: 55 },
    { header: 'Montant', key: 'amount', width: 16, style: { numFmt: MONEY_NUMBER_FORMAT } },
  ];
  styleHeaderRow(summarySheet, 1);

  const rows: [string, string][] =
    company.jurisdiction === 'FR'
      ? (() => {
          const d = declaration as Ca3Declaration;
          return [
            ['Ligne 16 — TVA brute due', d.ligne16],
            ['Ligne 19 — Biens constituant des immobilisations', d.ligne19],
            ['Ligne 20 — Autres biens et services', d.ligne20],
            ['Ligne 23 — Total TVA déductible', d.ligne23],
            ['Ligne 25 — Crédit de TVA', moneyOrZero(d.ligne25)],
            ['Ligne TD — TVA due', moneyOrZero(d.ligneTD)],
            ['Ligne 28 — TVA nette due', d.ligne28],
            ['Ligne 32 — Total à payer', d.ligne32],
          ];
        })()
      : (() => {
          const d = declaration as MonacoDeclaration;
          return [
            ['Ligne B1 — Total TVA collectée', d.ligneB1],
            ['Ligne 44 — Biens constituant des immobilisations', d.ligne44],
            ['Ligne 45 — Autres biens et services', d.ligne45],
            ['Ligne B2 — Total TVA déductible', d.ligneB2],
            ['Ligne B3 — Crédit de TVA', moneyOrZero(d.ligneB3)],
            ['Ligne 48 — TVA nette due', moneyOrZero(d.ligne48)],
            ['Ligne 60 — Total à payer', d.ligne60],
          ];
        })();

  for (const [label, amount] of rows) {
    summarySheet.addRow({ label, amount: moneyToExcelNumber(amount) });
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
