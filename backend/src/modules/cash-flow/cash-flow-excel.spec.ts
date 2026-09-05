import ExcelJS from 'exceljs';
import { renderCashFlowExcel } from './cash-flow-excel';
import { CashFlowStatement } from './cash-flow-statement';

const FISCAL_YEAR = { label: '2026' } as never;

const STATEMENT: CashFlowStatement = {
  fluxExploitation: {
    resultatNet: '5405.00',
    dotationsAmortissementsProvisions: '0.00',
    reprisesAmortissementsProvisions: '0.00',
    valeurComptableElementsCedes: '0.00',
    produitsDesCessions: '0.00',
    capaciteAutofinancement: '5405.00',
    variationCreancesClients: '-1000.00',
    variationStocks: '0.00',
    variationTvaDeductibleAutres: '0.00',
    variationDettesExploitation: '-2050.00',
    total: '2355.00',
  },
  fluxInvestissement: {
    acquisitionsImmobilisations: '0.00',
    variationTvaDeductibleImmobilisations: '0.00',
    variationDettesSurImmobilisations: '0.00',
    cessionsImmobilisations: '6000.00',
    variationCreancesSurCessions: '0.00',
    total: '6000.00',
  },
  fluxFinancement: {
    variationEmprunts: '9000.00',
    variationCapital: '0.00',
    variationComptesCourantsAssocies: '0.00',
    distributions: '0.00',
    total: '9000.00',
  },
  variationTresorerie: '17355.00',
  tresorerieOuverture: '15000.00',
  tresorerieCloture: '32355.00',
};

describe('renderCashFlowExcel', () => {
  it('round-trips real figures, including a negative amount, into real numeric cells', async () => {
    const buffer = await renderCashFlowExcel(STATEMENT, FISCAL_YEAR);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];

    // Row 1 = header, row 2 = "Flux d'exploitation" section title, row 3 = "Résultat net".
    expect(sheet.getRow(2).getCell(1).value).toBe("Flux de trésorerie d'exploitation");
    expect(sheet.getRow(2).font?.bold).toBe(true);
    expect(sheet.getRow(3).getCell(1).value).toBe('Résultat net');
    expect(sheet.getRow(3).getCell(2).value).toBe(5405);

    const values = sheet
      .getSheetValues()
      .flat()
      .filter((v) => typeof v === 'number');
    expect(values).toContain(-1000);
  });
});
