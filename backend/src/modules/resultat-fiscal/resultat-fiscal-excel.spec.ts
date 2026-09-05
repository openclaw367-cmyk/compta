import ExcelJS from 'exceljs';
import { renderResultatFiscalExcel } from './resultat-fiscal-excel';
import { ResultatFiscalResult } from './resultat-fiscal';

const FISCAL_YEAR = { label: '2026' } as never;

const RESULT: ResultatFiscalResult = {
  resultatComptable: '5405.00',
  impotSurLesSocietes: { code: 'I7', label: 'Impôt sur les sociétés', montant: '0.00' },
  reintegrationsConfirmables: [
    { code: 'WJ', label: 'Amendes et pénalités', suggested: '0.00', confirmed: '150.00' },
  ],
  reintegrationsDeclarees: [{ code: 'WD', label: 'Avantages personnels', montant: '200.00' }],
  totalReintegrations: '350.00',
  deductionsDeclarees: [{ code: 'XA', label: 'Déduction diverse', montant: '75.00' }],
  totalDeductions: '75.00',
  resultatFiscal: '5680.00',
};

describe('renderResultatFiscalExcel', () => {
  it("writes the honesty banner as the sheet's own first row, verbatim", async () => {
    const buffer = await renderResultatFiscalExcel(RESULT, FISCAL_YEAR);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];

    expect(sheet.getRow(1).getCell(1).value).toBe(
      'Ce tableau se recoupe arithmétiquement — cela ne garantit pas que tous les retraitements ' +
        'fiscaux applicables ont été déclarés.',
    );
    expect(sheet.getRow(3).getCell(1).value).toBe('Code');

    const values = sheet.getSheetValues().flat();
    expect(values).toContain(5680); // résultat fiscal
    expect(values).toContain(150); // WJ confirmed
  });
});
