import ExcelJS from 'exceljs';
import { FiscalYear } from '@prisma/client';
import {
  MONEY_NUMBER_FORMAT,
  moneyToExcelNumber,
  styleHeaderRow,
} from '../../common/excel/excel-report-helpers';
import { CashFlowStatement } from './cash-flow-statement';

/**
 * Tableau des flux de trésorerie Excel export — see CLAUDE.md
 * "Reporting/export flexibility". One sheet, sectioned rows (a bold
 * section-header row per flux, matching the PDF's own grouping).
 */
export async function renderCashFlowExcel(
  statement: CashFlowStatement,
  fiscalYear: FiscalYear,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Flux ${fiscalYear.label}`.slice(0, 31));
  sheet.columns = [
    { header: 'Ligne', key: 'label', width: 55 },
    { header: 'Montant', key: 'amount', width: 18, style: { numFmt: MONEY_NUMBER_FORMAT } },
  ];
  styleHeaderRow(sheet, 1);

  const addSection = (title: string, rows: [string, string][]) => {
    const sectionRow = sheet.addRow({ label: title });
    sectionRow.font = { bold: true };
    for (const [label, amount] of rows) {
      sheet.addRow({ label, amount: moneyToExcelNumber(amount) });
    }
  };

  addSection("Flux de trésorerie d'exploitation", [
    ['Résultat net', statement.fluxExploitation.resultatNet],
    [
      'Dotations aux amortissements et provisions',
      statement.fluxExploitation.dotationsAmortissementsProvisions,
    ],
    [
      'Reprises sur amortissements et provisions',
      statement.fluxExploitation.reprisesAmortissementsProvisions,
    ],
    [
      "Valeur comptable des éléments d'actifs cédés",
      statement.fluxExploitation.valeurComptableElementsCedes,
    ],
    ["Produits des cessions d'éléments d'actif", statement.fluxExploitation.produitsDesCessions],
    ["Capacité d'autofinancement (CAF)", statement.fluxExploitation.capaciteAutofinancement],
    ['Variation des créances clients', statement.fluxExploitation.variationCreancesClients],
    ['Variation des stocks', statement.fluxExploitation.variationStocks],
    [
      'Variation TVA déductible sur autres biens et services',
      statement.fluxExploitation.variationTvaDeductibleAutres,
    ],
    ["Variation des dettes d'exploitation", statement.fluxExploitation.variationDettesExploitation],
    ["Total flux de trésorerie d'exploitation", statement.fluxExploitation.total],
  ]);

  addSection("Flux de trésorerie d'investissement", [
    ["Acquisitions d'immobilisations", statement.fluxInvestissement.acquisitionsImmobilisations],
    [
      'Variation TVA déductible sur immobilisations',
      statement.fluxInvestissement.variationTvaDeductibleImmobilisations,
    ],
    [
      'Variation des dettes sur immobilisations',
      statement.fluxInvestissement.variationDettesSurImmobilisations,
    ],
    ["Cessions d'immobilisations", statement.fluxInvestissement.cessionsImmobilisations],
    [
      'Variation des créances sur cessions',
      statement.fluxInvestissement.variationCreancesSurCessions,
    ],
    ["Total flux de trésorerie d'investissement", statement.fluxInvestissement.total],
  ]);

  addSection('Flux de trésorerie de financement', [
    ['Variation des emprunts', statement.fluxFinancement.variationEmprunts],
    ['Variation de capital', statement.fluxFinancement.variationCapital],
    [
      "Variation des comptes courants d'associés",
      statement.fluxFinancement.variationComptesCourantsAssocies,
    ],
    ['Distributions', statement.fluxFinancement.distributions],
    ['Total flux de trésorerie de financement', statement.fluxFinancement.total],
  ]);

  addSection('Réconciliation', [
    ['Variation de trésorerie', statement.variationTresorerie],
    ['Trésorerie à l’ouverture', statement.tresorerieOuverture],
    ['Trésorerie à la clôture', statement.tresorerieCloture],
  ]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
