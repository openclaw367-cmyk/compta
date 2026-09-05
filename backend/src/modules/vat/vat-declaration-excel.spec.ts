import ExcelJS from 'exceljs';
import { renderVatDeclarationExcel } from './vat-declaration-excel';
import { Ca3Declaration } from './ca3-declaration';

const COMPANY_FR = { name: 'Société Démo SARL', jurisdiction: 'FR' } as never;

const CA3: Ca3Declaration = {
  periodStart: '2026-04-01',
  periodEnd: '2026-04-30',
  collecteeByRate: [
    {
      ligne: '08',
      label: 'Taux normal 20 %',
      ratePercent: '20.00',
      baseHT: '1000.00',
      taxe: '200.00',
    },
  ],
  ligne16: '200.00',
  ligne19: '90.00',
  ligne20: '60.00',
  ligne23: '150.00',
  ligne25: null,
  ligneTD: '50.00',
  ligne28: '50.00',
  ligne32: '50.00',
};

describe('renderVatDeclarationExcel', () => {
  it('writes the rate breakdown and the CA3 summary onto two sheets with real numeric cells', async () => {
    const buffer = await renderVatDeclarationExcel(CA3, COMPANY_FR, CA3.periodStart, CA3.periodEnd);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    expect(workbook.worksheets.map((s) => s.name)).toEqual(['TVA par taux', 'CA3']);
    const rateSheet = workbook.worksheets[0];
    expect(rateSheet.getRow(2).getCell(4).value).toBe(1000); // baseHT
    expect(rateSheet.getRow(2).getCell(5).value).toBe(200); // taxe

    const summarySheet = workbook.worksheets[1];
    const values = summarySheet.getSheetValues().flat();
    expect(values).toContain(200); // ligne16
    expect(values).toContain(50); // ligne28/32
  });
});
