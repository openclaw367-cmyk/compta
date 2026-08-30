import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ResultatFiscalService } from './resultat-fiscal.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };
const FY_2026 = { id: 'fy-2026', companyId: company.companyId, label: '2026' };

function makePrismaMock() {
  return {
    company: { findFirst: jest.fn().mockResolvedValue({ id: company.companyId }) },
    fiscalYear: { findFirst: jest.fn().mockResolvedValue(FY_2026) },
    ecriture: { count: jest.fn().mockResolvedValue(0) },
    ecritureLigne: { findMany: jest.fn().mockResolvedValue([]) },
    account: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function service(prisma: ReturnType<typeof makePrismaMock>): ResultatFiscalService {
  return new ResultatFiscalService(prisma as unknown as PrismaService);
}

/**
 * No service-level (mocked-Prisma) test existed for this service at all before this pass — not
 * even for the pre-existing generate() — since only the pure resultat-fiscal.ts/
 * resultat-fiscal-trace.ts functions were previously covered. Added here alongside
 * traceConfirmableLine() (Tier 3) for real safety on the new Prisma wiring — the fetchClosingContext()
 * extraction, the double-derivation oracle, and the account-id resolution pass.
 */
describe('ResultatFiscalService.traceConfirmableLine', () => {
  it('traces WJ to the real account 6712, resolving its id/label, ties to 150.00', async () => {
    const prisma = makePrismaMock();
    prisma.ecritureLigne.findMany.mockResolvedValue([
      {
        compte: { number: '6712', pcgClass: 6 },
        debit: new Prisma.Decimal('150.00'),
        credit: new Prisma.Decimal('0.00'),
      },
      {
        // A DIFFERENT class-6 account, must never leak into WJ's own détail.
        compte: { number: '6788', pcgClass: 6 },
        debit: new Prisma.Decimal('500.00'),
        credit: new Prisma.Decimal('0.00'),
      },
    ]);
    prisma.account.findMany.mockResolvedValue([
      { id: 'acc-6712', number: '6712', label: 'Pénalités, amendes fiscales et pénales' },
    ]);

    const result = await service(prisma).traceConfirmableLine(company, {
      fiscalYearId: FY_2026.id,
      code: 'WJ',
    });

    expect(result.columnValue).toBe('150.00');
    expect(result.accounts).toEqual([
      {
        accountId: 'acc-6712',
        accountNumber: '6712',
        accountLabel: 'Pénalités, amendes fiscales et pénales',
        contribution: '150.00',
      },
    ]);
  });

  it('ties to 0,00 with an empty account list when nothing matches, not an error', async () => {
    const prisma = makePrismaMock();
    const result = await service(prisma).traceConfirmableLine(company, {
      fiscalYearId: FY_2026.id,
      code: 'WG',
    });
    expect(result.columnValue).toBe('0.00');
    expect(result.accounts).toEqual([]);
  });

  it('refuses to trace while a draft écriture exists in the fiscal year, same guard as generate()', async () => {
    const prisma = makePrismaMock();
    prisma.ecriture.count.mockResolvedValue(1);
    await expect(
      service(prisma).traceConfirmableLine(company, { fiscalYearId: FY_2026.id, code: 'WJ' }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws if a traced account number no longer resolves to a real Account row on this company', async () => {
    const prisma = makePrismaMock();
    prisma.ecritureLigne.findMany.mockResolvedValue([
      {
        compte: { number: '6712', pcgClass: 6 },
        debit: new Prisma.Decimal('150.00'),
        credit: new Prisma.Decimal('0.00'),
      },
    ]);
    prisma.account.findMany.mockResolvedValue([]); // account row vanished
    await expect(
      service(prisma).traceConfirmableLine(company, { fiscalYearId: FY_2026.id, code: 'WJ' }),
    ).rejects.toThrow(NotFoundException);
  });
});
