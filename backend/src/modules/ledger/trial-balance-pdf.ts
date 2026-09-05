import { Company, FiscalYear } from '@prisma/client';
import { PdfReportBuilder, formatMoneyForPdf } from '../../common/pdf/pdf-report-renderer';
import { TrialBalanceResponseDto } from './dto/trial-balance-response.dto';

/**
 * Trial balance (balance générale) PDF — see CLAUDE.md "Reporting/export
 * flexibility". A pure function over the already-computed
 * `LedgerService.trialBalance()` result; no Prisma access of its own.
 */
export async function renderTrialBalancePdf(
  data: TrialBalanceResponseDto,
  company: Company,
  fiscalYear: FiscalYear,
): Promise<Uint8Array> {
  const builder = await PdfReportBuilder.create(`Balance générale — ${company.name}`);
  const periodLabel =
    data.periodStart && data.periodEnd
      ? `Du ${data.periodStart} au ${data.periodEnd}`
      : `Exercice ${fiscalYear.label}`;
  builder.addParagraph(periodLabel);

  builder.addTable(
    [
      { header: 'Compte', width: 65 },
      { header: 'Libellé', width: 225 },
      { header: 'Débit', width: 85, align: 'right' },
      { header: 'Crédit', width: 85, align: 'right' },
      { header: 'Solde', width: 85, align: 'right' },
    ],
    data.lines.map((line) => [
      line.accountNumber,
      line.accountLabel,
      formatMoneyForPdf(line.totalDebit),
      formatMoneyForPdf(line.totalCredit),
      formatMoneyForPdf(line.balance),
    ]),
    [
      '',
      'Total',
      formatMoneyForPdf(data.totals.debit),
      formatMoneyForPdf(data.totals.credit),
      formatMoneyForPdf(data.totals.balance),
    ],
  );

  return builder.build();
}
