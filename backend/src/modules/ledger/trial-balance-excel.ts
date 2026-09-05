import ExcelJS from 'exceljs';
import { FiscalYear } from '@prisma/client';
import {
  MONEY_NUMBER_FORMAT,
  moneyToExcelNumber,
  styleHeaderRow,
} from '../../common/excel/excel-report-helpers';
import { TrialBalanceResponseDto } from './dto/trial-balance-response.dto';

/**
 * Trial balance (balance générale) Excel export — see CLAUDE.md
 * "Reporting/export flexibility". A pure function over the
 * already-computed `LedgerService.trialBalance()` result.
 */
export async function renderTrialBalanceExcel(
  data: TrialBalanceResponseDto,
  fiscalYear: FiscalYear,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Balance ${fiscalYear.label}`.slice(0, 31));
  sheet.columns = [
    { header: 'Compte', key: 'accountNumber', width: 12 },
    { header: 'Libellé', key: 'accountLabel', width: 40 },
    { header: 'Débit', key: 'debit', width: 16, style: { numFmt: MONEY_NUMBER_FORMAT } },
    { header: 'Crédit', key: 'credit', width: 16, style: { numFmt: MONEY_NUMBER_FORMAT } },
    { header: 'Solde', key: 'balance', width: 16, style: { numFmt: MONEY_NUMBER_FORMAT } },
  ];
  styleHeaderRow(sheet, 1);

  for (const line of data.lines) {
    sheet.addRow({
      accountNumber: line.accountNumber,
      accountLabel: line.accountLabel,
      debit: moneyToExcelNumber(line.totalDebit),
      credit: moneyToExcelNumber(line.totalCredit),
      balance: moneyToExcelNumber(line.balance),
    });
  }

  const totalsRow = sheet.addRow({
    accountLabel: 'Total',
    debit: moneyToExcelNumber(data.totals.debit),
    credit: moneyToExcelNumber(data.totals.credit),
    balance: moneyToExcelNumber(data.totals.balance),
  });
  totalsRow.font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
