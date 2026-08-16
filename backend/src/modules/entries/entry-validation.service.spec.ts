import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntryValidationService } from './entry-validation.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateEcritureLigneDto } from './dto/create-ecriture-ligne.dto';

const company: CompanyContext = { companyId: 'company-1' };

function makePrismaMock() {
  return {
    journal: { findFirst: jest.fn().mockResolvedValue({ id: 'journal-1' }) },
    fiscalYear: {
      findFirst: jest.fn().mockResolvedValue({ id: 'fy-1', closedAt: null }),
    },
    vatRate: { findMany: jest.fn().mockResolvedValue([]) },
    account: { findMany: jest.fn().mockResolvedValue([]) },
    fixedAsset: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

/**
 * This is the module propose_ecriture (see ../ai-chat/tools/propose-tools.service.ts)
 * runs directly, standalone, without going through EntriesService — these
 * tests exist specifically to prove it works correctly in isolation, not
 * just as a passthrough exercised indirectly by entries.service.spec.ts.
 */
describe('EntryValidationService (standalone)', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: EntryValidationService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new EntryValidationService(prisma as unknown as PrismaService);
  });

  const lignes: CreateEcritureLigneDto[] = [
    { compteId: 'account-607', debit: '100.00' },
    { compteId: 'account-401', credit: '100.00' },
  ];

  it('accepts balanced lignes', () => {
    expect(() => service.buildBalancedLignes(company, lignes)).not.toThrow();
  });

  it('rejects an unbalanced écriture', () => {
    const unbalanced: CreateEcritureLigneDto[] = [
      { compteId: 'account-607', debit: '100.00' },
      { compteId: 'account-401', credit: '90.00' },
    ];
    expect(() => service.buildBalancedLignes(company, unbalanced)).toThrow(BadRequestException);
  });

  it('rejects a line with both debit and credit', () => {
    const bad: CreateEcritureLigneDto[] = [
      { compteId: 'account-607', debit: '10.00', credit: '10.00' },
    ];
    expect(() => service.buildBalancedLignes(company, bad)).toThrow(BadRequestException);
  });

  it('throws NotFoundException for a journal not belonging to this company', async () => {
    prisma.journal.findFirst.mockResolvedValue(null);
    await expect(
      service.assertReferencesBelongToCompany(company, 'journal-x', 'fy-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException for a fiscal year not belonging to this company', async () => {
    prisma.fiscalYear.findFirst.mockResolvedValue(null);
    await expect(
      service.assertReferencesBelongToCompany(company, 'journal-1', 'fy-x'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a VAT rate not belonging to this company', async () => {
    prisma.vatRate.findMany.mockResolvedValue([]);
    const withVat: CreateEcritureLigneDto[] = [
      { compteId: 'account-445660', debit: '20.00', vatRateId: 'rate-other-company' },
    ];
    await expect(service.assertVatRatesBelongToCompany(company, withVat)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('warns (does not throw) on a debited immobilisation account with no linked FixedAsset', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 'account-218300', number: '218300', label: 'Matériel', pcgClass: 2 },
    ]);
    prisma.fixedAsset.findMany.mockResolvedValue([]);
    const warnings = await service.computeOrphanedImmobilisationWarnings(company, [
      { compteId: 'account-218300', debit: '450.00' },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('218300');
  });
});
