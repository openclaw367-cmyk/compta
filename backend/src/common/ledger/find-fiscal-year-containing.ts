import { FiscalYear } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyContext } from '../tenant/company-context';

/**
 * Resolves the fiscal year covering a given date — extracted (2026-09-05)
 * from DepreciationService's own private helper of the same name/shape so
 * a second caller (RecurringEntriesService, applying a template on a
 * chosen date) can reuse it instead of duplicating the query. Behavior is
 * unchanged: `depreciation.service.spec.ts`'s existing tests pass without
 * modification after the extraction.
 */
export async function findFiscalYearContaining(
  prisma: PrismaService,
  company: CompanyContext,
  date: Date,
): Promise<FiscalYear | null> {
  return prisma.fiscalYear.findFirst({
    where: { companyId: company.companyId, startDate: { lte: date }, endDate: { gte: date } },
  });
}
