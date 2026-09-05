import ExcelJS from 'exceljs';
import { FiscalYear } from '@prisma/client';
import {
  MONEY_NUMBER_FORMAT,
  moneyToExcelNumber,
  numericStringOrNullToExcelValue,
  styleHeaderRow,
} from '../../common/excel/excel-report-helpers';
import { FinancialAnalysisResult } from './financial-analysis';

/**
 * Analyse financière Excel export — see CLAUDE.md "Reporting/export
 * flexibility". Same section grouping and simplified label set as
 * `financial-analysis-pdf.ts`. Money fields are real numeric cells;
 * percent/ratio/day-count fields are also real numbers (the raw
 * backend value, e.g. 40.00 for "40%") so they stay usable in a
 * spreadsheet — a null ("n/a", a genuine zero-denominator guard)
 * writes the literal text "n/a".
 */
export async function renderFinancialAnalysisExcel(
  result: FinancialAnalysisResult,
  fiscalYear: FiscalYear,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Analyse ${fiscalYear.label}`.slice(0, 31));
  sheet.columns = [
    { header: 'Indicateur', key: 'label', width: 45 },
    { header: 'Valeur', key: 'value', width: 16 },
  ];
  styleHeaderRow(sheet, 1);

  const addSection = (title: string, entries: [string, string | null, boolean][]) => {
    const sectionRow = sheet.addRow({ label: title });
    sectionRow.font = { bold: true };
    for (const [label, value, isMoney] of entries) {
      const row = sheet.addRow({
        label,
        value: isMoney
          ? moneyToExcelNumber(value as string)
          : numericStringOrNullToExcelValue(value),
      });
      if (isMoney) row.getCell('value').numFmt = MONEY_NUMBER_FORMAT;
    }
  };

  const {
    sig,
    margins,
    bfr,
    fondsDeRoulement,
    tresorerieNette,
    freeCashFlow,
    endettementEtCapitaux,
    coutDeLaDette,
    ratios,
  } = result;

  addSection('Soldes intermédiaires de gestion', [
    ['Marge commerciale', sig.margeCommerciale, true],
    ["Production de l'exercice", sig.productionDeLExercice, true],
    ['Consommations en provenance des tiers', sig.consommationsEnProvenanceDesTiers, true],
    ['Valeur ajoutée', sig.valeurAjoutee, true],
    ["Excédent brut d'exploitation (EBE)", sig.ebe, true],
    ["Résultat d'exploitation", sig.resultatExploitation, true],
    ['Résultat financier', sig.resultatFinancier, true],
    ['Résultat courant avant impôts', sig.resultatCourantAvantImpots, true],
    ['Résultat exceptionnel', sig.resultatExceptionnel, true],
    ['Résultat net', sig.resultatNet, true],
  ]);

  addSection('Marges', [
    ["Chiffre d'affaires", margins.chiffreDAffaires, true],
    ['Marge brute (%)', margins.margeBrute, false],
    ['Marge EBE (%)', margins.margeEbe, false],
    ["Marge d'exploitation (%)", margins.margeExploitation, false],
    ['Marge nette (%)', margins.margeNette, false],
  ]);

  addSection('Besoin en fonds de roulement (BFR)', [
    ["BFR d'exploitation", bfr.bfrExploitation, true],
    ['BFR hors exploitation', bfr.bfrHorsExploitation, true],
    ['BFR total', bfr.bfrTotal, true],
  ]);

  addSection('Fonds de roulement (FR)', [
    ['Ressources stables', fondsDeRoulement.ressourcesStables, true],
    ['Emplois stables', fondsDeRoulement.emploisStables, true],
    ['Fonds de roulement', fondsDeRoulement.fondsDeRoulement, true],
  ]);

  addSection('Trésorerie nette', [
    ['Trésorerie nette (FR − BFR)', tresorerieNette.parFrMoinsBfr, true],
    ['Provisions sur actif circulant', tresorerieNette.provisionsSurActifCirculant, true],
    ['Disponibilités (bilan)', tresorerieNette.disponibilites, true],
  ]);

  addSection('Free cash flow', [
    ["Flux de trésorerie d'exploitation", freeCashFlow.fluxExploitation, true],
    ['Décaissé pour les acquisitions', freeCashFlow.cashPaidForAcquisitions, true],
    ['Free cash flow', freeCashFlow.freeCashFlow, true],
  ]);

  addSection('Endettement et capitaux propres', [
    ['Dettes financières', endettementEtCapitaux.dettesFinancieres, true],
    ['Trésorerie et équivalents', endettementEtCapitaux.tresorerieEtEquivalents, true],
    ['Endettement net', endettementEtCapitaux.endettementNet, true],
    ['Capitaux propres', endettementEtCapitaux.capitauxPropres, true],
    ['Book enterprise value', endettementEtCapitaux.bookEnterpriseValue, true],
  ]);

  addSection('Coût de la dette', [
    ["Charges d'intérêts", coutDeLaDette.chargesDInteret, true],
    ['Dettes financières', coutDeLaDette.dettesFinancieres, true],
    ['Taux (%)', coutDeLaDette.taux, false],
  ]);

  addSection('Ratios', [
    ['Liquidité générale', ratios.liquiditeGenerale, false],
    ['Liquidité réduite', ratios.liquiditeReduite, false],
    ['Gearing (%)', ratios.gearing, false],
    ['Autonomie financière (%)', ratios.autonomieFinanciere, false],
    ['ROE (%)', ratios.roe, false],
    ['ROA (%)', ratios.roa, false],
    ['ROCE (%)', ratios.roce, false],
    ["Rentabilité d'exploitation (%)", ratios.rentabiliteExploitation, false],
    ['DSO clients (jours)', ratios.dsoClients, false],
    ['DPO fournisseurs (jours)', ratios.dpoFournisseurs, false],
    ['Rotation des stocks (jours)', ratios.rotationStocks, false],
  ]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
