import { PDFDocument } from 'pdf-lib';
import { renderTrialBalancePdf } from './trial-balance-pdf';
import { TrialBalanceResponseDto } from './dto/trial-balance-response.dto';

const COMPANY = { name: 'Société Démo SARL' } as never;
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
    {
      accountId: 'a2',
      accountNumber: '512000',
      accountLabel: 'Banques',
      totalDebit: '0.00',
      totalCredit: '100.00',
      balance: '-100.00',
    },
  ],
  totals: { debit: '100.00', credit: '100.00', balance: '0.00' },
};

describe('renderTrialBalancePdf', () => {
  it('produces a valid, loadable single-page PDF for a small trial balance', async () => {
    const bytes = await renderTrialBalancePdf(DATA, COMPANY, FISCAL_YEAR);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBe(1);
  });

  it('paginates a large trial balance across multiple pages', async () => {
    const manyLines = Array.from({ length: 150 }, (_, i) => ({
      accountId: `a${i}`,
      accountNumber: `6${String(i).padStart(5, '0')}`,
      accountLabel: `Compte ${i}`,
      totalDebit: '10.00',
      totalCredit: '0.00',
      balance: '10.00',
    }));
    const bytes = await renderTrialBalancePdf({ ...DATA, lines: manyLines }, COMPANY, FISCAL_YEAR);
    const loaded = await PDFDocument.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThan(1);
  });
});
