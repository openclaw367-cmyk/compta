import ExcelJS from 'exceljs';
import { renderTrialBalanceExcel } from './trial-balance-excel';
import { TrialBalanceResponseDto } from './dto/trial-balance-response.dto';

const FISCAL_YEAR = { label: '2026' } as never;

const DATA: TrialBalanceResponseDto = {
  fiscalYearId: 'fy-2026',
  lines: [
    {
      accountId: 'a1',
      accountNumber: '606400',
      accountLabel: 'Fournitures administratives',
      totalDebit: '100.00',
      totalCredit: '0.00',
      balance: '100.00',
    },
  ],
  totals: { debit: '100.00', credit: '0.00', balance: '100.00' },
};

describe('renderTrialBalanceExcel', () => {
  it('round-trips real figures into real numeric cells', async () => {
    const buffer = await renderTrialBalanceExcel(DATA, FISCAL_YEAR);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const sheet = workbook.worksheets[0];

    expect(sheet.getRow(1).getCell(1).value).toBe('Compte');
    expect(sheet.getRow(2).getCell(1).value).toBe('606400');
    expect(sheet.getRow(2).getCell(2).value).toBe('Fournitures administratives');
    expect(sheet.getRow(2).getCell(3).value).toBe(100);
    const totalsRow = sheet.getRow(3);
    expect(totalsRow.getCell(2).value).toBe('Total');
    expect(totalsRow.getCell(3).value).toBe(100);
    expect(totalsRow.font?.bold).toBe(true);
  });
});
