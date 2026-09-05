import { findFiscalYearContaining } from './find-fiscal-year-containing';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyContext } from '../tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

describe('findFiscalYearContaining', () => {
  it('queries by companyId and a date range covering the given date', async () => {
    const fiscalYear = { id: 'fy-2026' };
    const prisma = { fiscalYear: { findFirst: jest.fn().mockResolvedValue(fiscalYear) } };
    const date = new Date('2026-06-15');

    const result = await findFiscalYearContaining(prisma as unknown as PrismaService, company, date);

    expect(result).toBe(fiscalYear);
    expect(prisma.fiscalYear.findFirst).toHaveBeenCalledWith({
      where: { companyId: 'company-1', startDate: { lte: date }, endDate: { gte: date } },
    });
  });

  it('returns null when no fiscal year covers the date', async () => {
    const prisma = { fiscalYear: { findFirst: jest.fn().mockResolvedValue(null) } };
    const result = await findFiscalYearContaining(
      prisma as unknown as PrismaService,
      company,
      new Date('2030-01-01'),
    );
    expect(result).toBeNull();
  });
});
