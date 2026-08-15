import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EntriesService } from './entries.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateEcritureDto } from './dto/create-ecriture.dto';

const company: CompanyContext = { companyId: 'company-1' };

function baseDto(overrides: Partial<CreateEcritureDto> = {}): CreateEcritureDto {
  return {
    journalId: 'journal-1',
    fiscalYearId: 'fiscal-year-1',
    ecritureDate: '2026-01-15',
    libelle: 'Achat fournitures',
    lignes: [
      { compteId: 'account-607', debit: '100.00' },
      { compteId: 'account-401', credit: '100.00' },
    ],
    ...overrides,
  };
}

function makePrismaMock() {
  const prisma = {
    company: { update: jest.fn() },
    journal: { findFirst: jest.fn().mockResolvedValue({ id: 'journal-1' }) },
    fiscalYear: { findFirst: jest.fn().mockResolvedValue({ id: 'fiscal-year-1' }) },
    ecriture: {
      create: jest.fn((args: { data: unknown; include?: unknown }) => ({
        id: 'ecriture-1',
        validatedAt: null,
        ...(args.data as object),
      })),
      findFirst: jest.fn(),
      update: jest.fn((args: { where: { id: string }; data: unknown }) => ({
        id: args.where.id,
        ...(args.data as object),
      })),
      delete: jest.fn(),
    },
    ecritureLigne: { deleteMany: jest.fn() },
    vatRate: { findMany: jest.fn().mockResolvedValue([]) },
    account: { findMany: jest.fn().mockResolvedValue([]) },
    fixedAsset: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

describe('EntriesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: EntriesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new EntriesService(prisma as unknown as PrismaService);
  });

  it('creates a balanced écriture', async () => {
    const ecriture = await service.create(company, baseDto());
    expect(prisma.ecriture.create).toHaveBeenCalled();
    expect(ecriture).toBeDefined();
    expect(ecriture.warnings).toEqual([]);
  });

  it('rejects an écriture where debit != credit', async () => {
    const dto = baseDto({
      lignes: [
        { compteId: 'account-607', debit: '100.00' },
        { compteId: 'account-401', credit: '99.00' },
      ],
    });
    await expect(service.create(company, dto)).rejects.toThrow(BadRequestException);
    expect(prisma.ecriture.create).not.toHaveBeenCalled();
  });

  it('rejects a line with both a debit and a credit amount', async () => {
    const dto = baseDto({
      lignes: [
        { compteId: 'account-607', debit: '100.00', credit: '100.00' },
        { compteId: 'account-401', credit: '100.00' },
      ],
    });
    await expect(service.create(company, dto)).rejects.toThrow(BadRequestException);
  });

  it('rejects a line with neither a debit nor a credit amount', async () => {
    const dto = baseDto({
      lignes: [{ compteId: 'account-607' }, { compteId: 'account-401', credit: '100.00' }],
    });
    await expect(service.create(company, dto)).rejects.toThrow(BadRequestException);
  });

  it('rejects referencing a journal from another company', async () => {
    prisma.journal.findFirst.mockResolvedValueOnce(null);
    await expect(service.create(company, baseDto())).rejects.toThrow(NotFoundException);
  });

  it('rejects creating an écriture in a closed fiscal year', async () => {
    prisma.fiscalYear.findFirst.mockResolvedValueOnce({
      id: 'fiscal-year-1',
      label: '2026',
      closedAt: new Date(),
    });
    await expect(service.create(company, baseDto())).rejects.toThrow(BadRequestException);
    expect(prisma.ecriture.create).not.toHaveBeenCalled();
  });

  it('rejects updating a draft into a closed fiscal year', async () => {
    prisma.ecriture.findFirst.mockResolvedValueOnce({
      id: 'ecriture-1',
      validatedAt: null,
      lignes: [],
    });
    prisma.fiscalYear.findFirst.mockResolvedValueOnce({
      id: 'fiscal-year-1',
      label: '2026',
      closedAt: new Date(),
    });
    await expect(service.update(company, 'ecriture-1', baseDto())).rejects.toThrow(
      BadRequestException,
    );
  });

  it('assigns sequential EcritureNum (as a string) on validation, starting from 1', async () => {
    prisma.ecriture.findFirst.mockResolvedValueOnce({ id: 'ecriture-1', validatedAt: null });
    // Company.nextEcritureNum starts at 1 (schema default); after the
    // atomic increment inside validate(), the update returns 2.
    prisma.company.update.mockResolvedValueOnce({ nextEcritureNum: 2 });
    const result = await service.validate(company, 'ecriture-1');
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: company.companyId },
        data: { nextEcritureNum: { increment: 1 } },
      }),
    );
    expect(prisma.ecriture.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ecritureNum: '1' }) }),
    );
    expect(result).toBeDefined();
  });

  it('assigns the next sequential EcritureNum after existing validated entries', async () => {
    prisma.ecriture.findFirst.mockResolvedValueOnce({ id: 'ecriture-2', validatedAt: null });
    // Counter was already at 8 (7 previously assigned); increment returns 9.
    prisma.company.update.mockResolvedValueOnce({ nextEcritureNum: 9 });
    await service.validate(company, 'ecriture-2');
    expect(prisma.ecriture.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ecritureNum: '8' }) }),
    );
  });

  it('never derives EcritureNum by sorting existing string values (lexical-sort trap)', async () => {
    // Regression guard: if validate() ever went back to "find max
    // ecritureNum" instead of the Company counter, string sorting would
    // put "10" before "2". Assert the counter path is what's used by
    // checking ecriture.findFirst is only called once (for the entry
    // itself), never a second time to search for a "last" ecritureNum.
    prisma.ecriture.findFirst.mockResolvedValueOnce({ id: 'ecriture-3', validatedAt: null });
    prisma.company.update.mockResolvedValueOnce({ nextEcritureNum: 11 });
    await service.validate(company, 'ecriture-3');
    expect(prisma.ecriture.findFirst).toHaveBeenCalledTimes(1);
  });

  it('refuses to validate an already-validated écriture', async () => {
    prisma.ecriture.findFirst.mockResolvedValueOnce({
      id: 'ecriture-1',
      validatedAt: new Date(),
    });
    await expect(service.validate(company, 'ecriture-1')).rejects.toThrow(ConflictException);
  });

  it('refuses to delete a validated écriture', async () => {
    prisma.ecriture.findFirst.mockResolvedValueOnce({
      id: 'ecriture-1',
      validatedAt: new Date(),
      lignes: [],
    });
    await expect(service.remove(company, 'ecriture-1')).rejects.toThrow(ConflictException);
    expect(prisma.ecriture.delete).not.toHaveBeenCalled();
  });

  it('deletes a draft écriture and its lines', async () => {
    prisma.ecriture.findFirst.mockResolvedValueOnce({
      id: 'ecriture-1',
      validatedAt: null,
      lignes: [
        { compteId: 'account-607', debit: '100.00', credit: '0.00' },
        { compteId: 'account-401', debit: '0.00', credit: '100.00' },
      ],
    });

    await service.remove(company, 'ecriture-1');

    expect(prisma.ecritureLigne.deleteMany).toHaveBeenCalledWith({
      where: { ecritureId: 'ecriture-1' },
    });
    expect(prisma.ecriture.delete).toHaveBeenCalledWith({ where: { id: 'ecriture-1' } });
  });

  it('refuses to edit a validated écriture', async () => {
    prisma.ecriture.findFirst.mockResolvedValueOnce({
      id: 'ecriture-1',
      validatedAt: new Date(),
      lignes: [],
    });
    await expect(service.update(company, 'ecriture-1', baseDto())).rejects.toThrow(
      ConflictException,
    );
  });

  it('reversal swaps debit and credit on every line', async () => {
    prisma.ecriture.findFirst.mockResolvedValueOnce({
      id: 'ecriture-1',
      journalId: 'journal-1',
      fiscalYearId: 'fiscal-year-1',
      libelle: 'Achat fournitures',
      validatedAt: new Date(),
      lignes: [
        { compteId: 'account-607', compteAuxId: null, debit: '100.00', credit: '0.00' },
        { compteId: 'account-401', compteAuxId: null, debit: '0.00', credit: '100.00' },
      ],
    });

    await service.reverse(company, 'ecriture-1');

    expect(prisma.ecriture.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reversesId: 'ecriture-1',
          lignes: {
            create: [
              expect.objectContaining({ compteId: 'account-607', debit: '0.00', credit: '100.00' }),
              expect.objectContaining({ compteId: 'account-401', debit: '100.00', credit: '0.00' }),
            ],
          },
        }),
      }),
    );
  });

  it('refuses to reverse a draft (unvalidated) écriture', async () => {
    prisma.ecriture.findFirst.mockResolvedValueOnce({
      id: 'ecriture-1',
      validatedAt: null,
      lignes: [],
    });
    await expect(service.reverse(company, 'ecriture-1')).rejects.toThrow(BadRequestException);
  });

  it('refuses to reverse into a closed fiscal year', async () => {
    prisma.ecriture.findFirst.mockResolvedValueOnce({
      id: 'ecriture-1',
      journalId: 'journal-1',
      fiscalYearId: 'fiscal-year-1',
      libelle: 'Achat fournitures',
      validatedAt: new Date(),
      lignes: [],
    });
    prisma.fiscalYear.findFirst.mockResolvedValueOnce({
      id: 'fiscal-year-1',
      label: '2026',
      closedAt: new Date(),
    });
    await expect(service.reverse(company, 'ecriture-1')).rejects.toThrow(BadRequestException);
    expect(prisma.ecriture.create).not.toHaveBeenCalled();
  });

  it('creates an écriture with a vatRateId tag that belongs to the company', async () => {
    prisma.vatRate.findMany.mockResolvedValue([
      { id: 'vat-rate-20', companyId: company.companyId },
    ]);
    const dto = baseDto({
      lignes: [
        { compteId: 'account-707', credit: '100.00', vatRateId: 'vat-rate-20' },
        { compteId: 'account-44571', credit: '20.00', vatRateId: 'vat-rate-20' },
        { compteId: 'account-411', debit: '120.00' },
      ],
    });
    await service.create(company, dto);
    expect(prisma.vatRate.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['vat-rate-20'] }, companyId: company.companyId },
    });
    expect(prisma.ecriture.create).toHaveBeenCalled();
  });

  it('rejects a vatRateId that does not belong to the company', async () => {
    prisma.vatRate.findMany.mockResolvedValue([]); // lookup scoped to this company finds nothing
    const dto = baseDto({
      lignes: [
        { compteId: 'account-707', credit: '100.00', vatRateId: 'someone-elses-rate' },
        { compteId: 'account-411', debit: '100.00' },
      ],
    });
    await expect(service.create(company, dto)).rejects.toThrow(BadRequestException);
    expect(prisma.ecriture.create).not.toHaveBeenCalled();
  });

  it('does not query vatRate at all when no line carries a vatRateId', async () => {
    await service.create(company, baseDto());
    expect(prisma.vatRate.findMany).not.toHaveBeenCalled();
  });

  describe('orphaned-immobilisation warning', () => {
    const account218300 = {
      id: 'account-218300',
      number: '218300',
      label: 'Matériel de bureau',
      pcgClass: 2,
    };

    it('warns when a debited class-2 account has no linked FixedAsset', async () => {
      prisma.account.findMany.mockResolvedValueOnce([account218300]);
      prisma.fixedAsset.findMany.mockResolvedValueOnce([]);
      const dto = baseDto({
        lignes: [
          { compteId: 'account-218300', debit: '450.00' },
          { compteId: 'account-401', credit: '450.00' },
        ],
      });
      const ecriture = await service.create(company, dto);
      expect(ecriture.warnings).toHaveLength(1);
      expect(ecriture.warnings[0]).toContain('218300');
      expect(prisma.ecriture.create).toHaveBeenCalled(); // non-blocking — the write still happens
    });

    it('does not warn when the debited class-2 account already has a linked FixedAsset', async () => {
      prisma.account.findMany.mockResolvedValueOnce([account218300]);
      prisma.fixedAsset.findMany.mockResolvedValueOnce([{ accountId: 'account-218300' }]);
      const dto = baseDto({
        lignes: [
          { compteId: 'account-218300', debit: '450.00' },
          { compteId: 'account-401', credit: '450.00' },
        ],
      });
      const ecriture = await service.create(company, dto);
      expect(ecriture.warnings).toEqual([]);
    });

    it('does not warn when the class-2 account is only credited, not debited', async () => {
      // account.findMany is still queried (for the debited account-401), but scoped to
      // debitCompteIds only — account-218300 (credited, not debited) is never looked up,
      // so it can never surface a warning regardless of whether it has a FixedAsset.
      const dto = baseDto({
        lignes: [
          { compteId: 'account-401', debit: '450.00' },
          { compteId: 'account-218300', credit: '450.00' },
        ],
      });
      const ecriture = await service.create(company, dto);
      expect(prisma.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['account-401'] } }),
        }),
      );
      expect(ecriture.warnings).toEqual([]);
    });

    it('excludes 28x/29x amortissements contra-accounts from the check', async () => {
      const contraAccount = {
        id: 'account-281300',
        number: '281300',
        label: 'Amortissements',
        pcgClass: 2,
      };
      prisma.account.findMany.mockResolvedValueOnce([contraAccount]);
      const dto = baseDto({
        lignes: [
          { compteId: 'account-281300', debit: '100.00' },
          { compteId: 'account-401', credit: '100.00' },
        ],
      });
      const ecriture = await service.create(company, dto);
      expect(prisma.fixedAsset.findMany).not.toHaveBeenCalled();
      expect(ecriture.warnings).toEqual([]);
    });

    it('carries through on update() too', async () => {
      prisma.ecriture.findFirst.mockResolvedValueOnce({
        id: 'ecriture-1',
        validatedAt: null,
        lignes: [],
      });
      prisma.account.findMany.mockResolvedValueOnce([account218300]);
      prisma.fixedAsset.findMany.mockResolvedValueOnce([]);
      const dto = baseDto({
        lignes: [
          { compteId: 'account-218300', debit: '450.00' },
          { compteId: 'account-401', credit: '450.00' },
        ],
      });
      const ecriture = await service.update(company, 'ecriture-1', dto);
      expect(ecriture.warnings).toHaveLength(1);
    });
  });
});
