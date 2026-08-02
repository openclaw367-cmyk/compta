import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { JournalType, Prisma } from '@prisma/client';
import { ANouveauService } from './a-nouveau.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

const TARGET = {
  id: 'fy-2027',
  label: '2027',
  startDate: new Date('2027-01-01'),
  endDate: new Date('2027-12-31'),
  closedAt: null as Date | null,
};
const PRIOR = {
  id: 'fy-2026',
  label: '2026',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
  closedAt: new Date('2027-01-05') as Date | null,
};
const AN_JOURNAL = { id: 'journal-an', code: 'AN', type: JournalType.A_NOUVEAU };
const ACCOUNT_120 = { id: 'account-120', number: '120000', pcgClass: 1 };
const ACCOUNT_129 = { id: 'account-129', number: '129000', pcgClass: 1 };

function ligne(
  compteId: string,
  compteAuxId: string | null,
  pcgClass: number,
  debit: string,
  credit: string,
) {
  return {
    compteId,
    compteAuxId,
    debit: new Prisma.Decimal(debit),
    credit: new Prisma.Decimal(credit),
    compte: { id: compteId, pcgClass },
  };
}

/** Prior year ledger that balances overall: 130 000 debit == 130 000 credit,
 * with a 10 000 bénéfice (charges 50 000 / produits 60 000). */
function balancedProfitLedger() {
  return [
    ligne('account-101', null, 1, '0.00', '100000.00'), // capital
    ligne('account-512', null, 5, '130000.00', '0.00'), // banque
    ligne('account-401', 'account-401001', 4, '0.00', '20000.00'), // fournisseur (tiers)
    ligne('account-607', null, 6, '50000.00', '0.00'), // charges
    ligne('account-707', null, 7, '0.00', '60000.00'), // produits
  ];
}

function makePrismaMock() {
  const prisma = {
    fiscalYear: {
      findFirst: jest.fn(
        (args: { where: Record<string, unknown> }): Promise<typeof TARGET | typeof PRIOR | null> =>
          Promise.resolve(args.where.endDate ? PRIOR : TARGET),
      ),
    },
    journal: { findFirst: jest.fn().mockResolvedValue(AN_JOURNAL) },
    ecriture: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn((args: { data: Record<string, unknown> }) => ({
        id: 'ecriture-an-1',
        ...args.data,
      })),
    },
    ecritureLigne: { findMany: jest.fn().mockResolvedValue([]) },
    account: { findFirst: jest.fn().mockResolvedValue(ACCOUNT_120) },
    company: { update: jest.fn().mockResolvedValue({ nextEcritureNum: 43 }) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

function createdLignes(prisma: ReturnType<typeof makePrismaMock>) {
  const call = prisma.ecriture.create.mock.calls[0][0] as {
    data: { lignes: { create: { compteId: string; compteAuxId?: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[] } };
  };
  return call.data.lignes.create
    .map((l) => ({
      compteId: l.compteId,
      compteAuxId: l.compteAuxId ?? null,
      debit: l.debit.toFixed(2),
      credit: l.credit.toFixed(2),
    }))
    .sort((a, b) => (a.compteId + a.compteAuxId).localeCompare(b.compteId + b.compteAuxId));
}

describe('ANouveauService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: ANouveauService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new ANouveauService(prisma as unknown as PrismaService);
  });

  it('carries class 1-5 balances exactly and folds a bénéfice into 120', async () => {
    prisma.ecritureLigne.findMany.mockResolvedValue(balancedProfitLedger());

    const ecriture = await service.generate(company, TARGET.id);

    expect(createdLignes(prisma)).toEqual(
      [
        { compteId: 'account-101', compteAuxId: null, debit: '0.00', credit: '100000.00' },
        { compteId: 'account-512', compteAuxId: null, debit: '130000.00', credit: '0.00' },
        { compteId: 'account-401', compteAuxId: 'account-401001', debit: '0.00', credit: '20000.00' },
        { compteId: 'account-120', compteAuxId: null, debit: '0.00', credit: '10000.00' },
      ].sort((a, b) => (a.compteId + a.compteAuxId).localeCompare(b.compteId + b.compteAuxId)),
    );
    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: company.companyId },
      data: { nextEcritureNum: { increment: 1 } },
    });
    expect((ecriture as unknown as { ecritureNum: string }).ecritureNum).toBe('42');
    expect((ecriture as unknown as { validatedAt: Date }).validatedAt).toBeInstanceOf(Date);
    expect((ecriture as unknown as { journalId: string }).journalId).toBe(AN_JOURNAL.id);
    expect((ecriture as unknown as { ecritureDate: Date }).ecritureDate).toEqual(TARGET.startDate);
  });

  it('folds a perte into 129 instead of 120', async () => {
    prisma.ecritureLigne.findMany.mockResolvedValue([
      ligne('account-512', null, 5, '80000.00', '0.00'),
      ligne('account-101', null, 1, '0.00', '100000.00'),
      ligne('account-607', null, 6, '20000.00', '0.00'), // charges 20 000, no produits -> perte 20 000
    ]);
    prisma.account.findFirst.mockResolvedValue(ACCOUNT_129);

    await service.generate(company, TARGET.id);

    expect(prisma.account.findFirst).toHaveBeenCalledWith({
      where: { companyId: company.companyId, number: '129000' },
    });
    expect(createdLignes(prisma)).toContainEqual({
      compteId: 'account-129',
      compteAuxId: null,
      debit: '20000.00',
      credit: '0.00',
    });
  });

  it('rejects when the prior fiscal year is not closed', async () => {
    prisma.fiscalYear.findFirst.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(args.where.endDate ? { ...PRIOR, closedAt: null } : TARGET),
    );
    await expect(service.generate(company, TARGET.id)).rejects.toThrow(ConflictException);
    expect(prisma.ecriture.create).not.toHaveBeenCalled();
  });

  it('rejects when there is no prior fiscal year at all', async () => {
    prisma.fiscalYear.findFirst.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(args.where.endDate ? null : TARGET),
    );
    await expect(service.generate(company, TARGET.id)).rejects.toThrow(BadRequestException);
    expect(prisma.ecriture.create).not.toHaveBeenCalled();
  });

  it('rejects when à-nouveau entries already exist for the target year', async () => {
    prisma.ecriture.findFirst.mockResolvedValue({ id: 'existing-an' });
    await expect(service.generate(company, TARGET.id)).rejects.toThrow(ConflictException);
    expect(prisma.ecriture.create).not.toHaveBeenCalled();
  });

  it('rejects when the target fiscal year is itself closed', async () => {
    prisma.fiscalYear.findFirst.mockImplementation((args: { where: Record<string, unknown> }) =>
      Promise.resolve(args.where.endDate ? PRIOR : { ...TARGET, closedAt: new Date() }),
    );
    await expect(service.generate(company, TARGET.id)).rejects.toThrow(BadRequestException);
    expect(prisma.ecriture.create).not.toHaveBeenCalled();
  });

  it('rejects a prior year with non-zero class 8 balances rather than silently dropping them', async () => {
    prisma.ecritureLigne.findMany.mockResolvedValue([
      ligne('account-801', null, 8, '500.00', '0.00'),
    ]);
    await expect(service.generate(company, TARGET.id)).rejects.toThrow(ConflictException);
    await expect(service.generate(company, TARGET.id)).rejects.toThrow(/class 8/);
    expect(prisma.ecriture.create).not.toHaveBeenCalled();
  });

  it('rejects when the required 120/129 result account does not exist', async () => {
    prisma.ecritureLigne.findMany.mockResolvedValue(balancedProfitLedger());
    prisma.account.findFirst.mockResolvedValue(null);
    await expect(service.generate(company, TARGET.id)).rejects.toThrow(NotFoundException);
    expect(prisma.ecriture.create).not.toHaveBeenCalled();
  });

  it('rejects when the prior fiscal year has nothing to carry forward', async () => {
    prisma.ecritureLigne.findMany.mockResolvedValue([]);
    await expect(service.generate(company, TARGET.id)).rejects.toThrow(BadRequestException);
    expect(prisma.ecriture.create).not.toHaveBeenCalled();
  });

  it('surfaces loudly, as an internal error, if the carried block would not balance', async () => {
    // A single unbalanced line simulates a corrupted prior-year ledger —
    // the à-nouveau block must never be silently posted unbalanced.
    prisma.ecritureLigne.findMany.mockResolvedValue([ligne('account-512', null, 5, '100.00', '0.00')]);
    await expect(service.generate(company, TARGET.id)).rejects.toThrow(InternalServerErrorException);
    expect(prisma.ecriture.create).not.toHaveBeenCalled();
  });
});
