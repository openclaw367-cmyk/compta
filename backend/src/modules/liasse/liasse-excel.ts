import ExcelJS from 'exceljs';
import {
  MONEY_NUMBER_FORMAT,
  moneyToExcelNumber,
  styleHeaderRow,
} from '../../common/excel/excel-report-helpers';
import { LiasseResult, LiasseSimplifieResult } from './liasse.service';

/**
 * Every liasse tableau's own ligne shape is `{ code, label, ...money
 * fields }` — one small generic sheet-builder covers all of them,
 * mirroring `liasse-pdf.ts`'s own `ligneColumns()`/`ligneRows()`
 * helpers (kept file-local rather than shared, since the PDF and
 * Excel column configs differ enough — width/align vs. key/numFmt —
 * that a shared abstraction would need its own indirection either
 * way).
 */
function addLigneSheet<T extends { code: string; label: string }>(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  lignes: T[],
  moneyFields: { key: keyof T; header: string }[],
  totalsRow?: [string, ...string[]],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.columns = [
    { header: 'Code', key: 'code', width: 10 },
    { header: 'Libellé', key: 'label', width: 45 },
    ...moneyFields.map((f) => ({
      header: f.header,
      key: String(f.key),
      width: 16,
      style: { numFmt: MONEY_NUMBER_FORMAT },
    })),
  ];
  styleHeaderRow(sheet, 1);

  for (const ligne of lignes) {
    const row: Record<string, unknown> = { code: ligne.code, label: ligne.label };
    for (const f of moneyFields) {
      row[String(f.key)] = moneyToExcelNumber((ligne[f.key] as string | null) ?? '0.00');
    }
    sheet.addRow(row);
  }

  if (totalsRow) {
    const [label, ...amounts] = totalsRow;
    const row: Record<string, unknown> = { label };
    moneyFields.forEach((f, i) => {
      if (amounts[i] !== undefined && amounts[i] !== '') {
        row[String(f.key)] = moneyToExcelNumber(amounts[i]);
      }
    });
    const excelRow = sheet.addRow(row);
    excelRow.font = { bold: true };
  }

  return sheet;
}

function renderReelNormal(workbook: ExcelJS.Workbook, result: LiasseResult): void {
  addLigneSheet(
    workbook,
    'Bilan actif',
    result.bilan.actif,
    [
      { key: 'brut', header: 'Brut' },
      { key: 'amortissements', header: 'Amort.' },
      { key: 'net', header: 'Net' },
    ],
    [
      'Total actif',
      result.bilan.totalActifBrut,
      result.bilan.totalActifAmortissements,
      result.bilan.totalActifNet,
    ],
  );

  addLigneSheet(
    workbook,
    'Bilan passif',
    [
      ...result.bilan.passif,
      { code: 'DI', label: "Résultat de l'exercice", montant: result.bilan.resultatDeLExercice },
    ],
    [{ key: 'montant', header: 'Montant' }],
    ['Total passif', result.bilan.totalPassif],
  );

  addLigneSheet(
    workbook,
    'Compte de résultat',
    result.compteResultat.lignes,
    [{ key: 'montant', header: 'Montant' }],
    ['Résultat net', result.compteResultat.beneficeOuPerte],
  );

  addLigneSheet(
    workbook,
    'Tableau 2054',
    result.tableau2054.lignes,
    [
      { key: 'valeurBruteDebut', header: 'Début' },
      { key: 'acquisitions', header: 'Acquisitions' },
      { key: 'cessions', header: 'Cessions' },
      { key: 'valeurBruteFin', header: 'Fin' },
    ],
    ['Total général', '', '', '', result.tableau2054.totalGeneral],
  );

  addLigneSheet(
    workbook,
    'Tableau 2055',
    result.tableau2055.lignes,
    [
      { key: 'montantDebut', header: 'Début' },
      { key: 'dotations', header: 'Dotations' },
      { key: 'diminutions', header: 'Diminutions' },
      { key: 'montantFin', header: 'Fin' },
    ],
    ['Total général', '', '', '', result.tableau2055.totalGeneral],
  );

  addLigneSheet(
    workbook,
    'Tableau 2056',
    result.tableau2056.lignes,
    [
      { key: 'montantDebut', header: 'Début' },
      { key: 'dotations', header: 'Dotations' },
      { key: 'reprises', header: 'Reprises' },
      { key: 'montantFin', header: 'Fin' },
    ],
    ['Total général', '', '', '', result.tableau2056.totalGeneral],
  );

  const sheet2057 = addLigneSheet(
    workbook,
    'Tableau 2057',
    result.tableau2057.cadreA,
    [
      { key: 'montantBrut', header: 'Montant brut' },
      { key: 'aUnAnAuPlus', header: 'À 1 an au plus' },
      { key: 'aPlusDUnAn', header: "À plus d'un an" },
    ],
    ['Total créances', result.tableau2057.totalCreances],
  );
  sheet2057.addRow({});
  sheet2057.addRow({ label: 'Cadre B (dettes)' }).font = { bold: true };
  for (const line of result.tableau2057.cadreB) {
    sheet2057.addRow({
      code: line.code,
      label: line.label,
      montantBrut: moneyToExcelNumber(line.montantBrut),
      aUnAnAuPlus: moneyToExcelNumber(line.aUnAnAuPlus),
    });
  }
  sheet2057.addRow({
    label: 'Total dettes',
    montantBrut: moneyToExcelNumber(result.tableau2057.totalDettes),
  }).font = {
    bold: true,
  };

  const sheet2059 = workbook.addWorksheet('Tableau 2059-A');
  sheet2059.columns = [
    { header: 'Compte', key: 'accountNumber', width: 12 },
    { header: 'Valeur origine', key: 'a', width: 16, style: { numFmt: MONEY_NUMBER_FORMAT } },
    { header: 'Amortissements', key: 'b', width: 16, style: { numFmt: MONEY_NUMBER_FORMAT } },
    {
      header: 'Valeur résiduelle / Prix de vente',
      key: 'c',
      width: 20,
      style: { numFmt: MONEY_NUMBER_FORMAT },
    },
    { header: 'Plus/moins-value', key: 'd', width: 16, style: { numFmt: MONEY_NUMBER_FORMAT } },
  ];
  styleHeaderRow(sheet2059, 1);
  for (const cadreA of result.tableau2059.cadreA) {
    const cadreB = result.tableau2059.cadreB.find((b) => b.assetId === cadreA.assetId);
    sheet2059.addRow({
      accountNumber: cadreA.accountNumber,
      a: moneyToExcelNumber(cadreA.valeurOrigine),
      b: moneyToExcelNumber(cadreA.amortissements),
      c: moneyToExcelNumber(cadreB?.prixDeVente ?? '0.00'),
      d: moneyToExcelNumber(cadreB?.plusOuMoinsValue ?? '0.00'),
    });
  }
  if (result.tableau2059.cadreA.length === 0) {
    sheet2059.addRow({ accountNumber: result.tableau2059.note });
  } else {
    sheet2059.addRow({
      accountNumber: 'Total (non qualifié)',
      d: moneyToExcelNumber(result.tableau2059.totalNonQualifie),
    }).font = {
      bold: true,
    };
  }
}

function renderReelSimplifie(workbook: ExcelJS.Workbook, result: LiasseSimplifieResult): void {
  addLigneSheet(
    workbook,
    'Bilan actif (2033-A)',
    result.bilan.actif,
    [
      { key: 'brut', header: 'Brut' },
      { key: 'amortissements', header: 'Amort.' },
      { key: 'net', header: 'Net' },
    ],
    [
      'Total actif',
      result.bilan.totalActifBrut,
      result.bilan.totalActifAmortissements,
      result.bilan.totalActifNet,
    ],
  );

  addLigneSheet(
    workbook,
    'Bilan passif (2033-A)',
    [
      ...result.bilan.passif,
      { code: '', label: "Résultat de l'exercice", montant: result.bilan.resultatDeLExercice },
    ],
    [{ key: 'montant', header: 'Montant' }],
    ['Total passif', result.bilan.totalPassif],
  );

  addLigneSheet(
    workbook,
    'Compte de résultat (2033-B)',
    result.compteResultat.lignes,
    [{ key: 'montant', header: 'Montant' }],
    ['Résultat net', result.compteResultat.beneficeOuPerte],
  );
}

/**
 * Liasse fiscale Excel export — see CLAUDE.md "Reporting/export
 * flexibility". One sheet per tableau (up to 7 for RÉEL_NORMAL, 3 for
 * RÉEL_SIMPLIFIE), matching the PDF export's own section grouping.
 */
export async function renderLiasseExcel(
  result: LiasseResult | LiasseSimplifieResult,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  if (result.regime === 'REEL_NORMAL') {
    renderReelNormal(workbook, result);
  } else {
    renderReelSimplifie(workbook, result);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
