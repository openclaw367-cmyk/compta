import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RecurringEntriesService } from './recurring-entries.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntryValidationService } from '../entries/entry-validation.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };

const JOURNAL_OD = { id: 'journal-od', companyId: 'company-1', code: 'OD' };
const ACCOUNT_613200 = {
  id: 'acc-613200',
  companyId: 'company-1',
  number: '613200',
  isAuxiliary: false,
  parentId: null,
};
const ACCOUNT_512000 = {
  id: 'acc-512000',
  companyId: 'company-1',
  number: '512000',
  isAuxiliary: false,
  parentId: null,
};
const ACCOUNT_401_COLLECTIF = {
  id: 'acc-401000',
  companyId: 'company-1',
  number: '401000',
  isAuxiliary: false,
  parentId: null,
};
const TIERS_401001 = {
  id: 'acc-401001',
  companyId: 'company-1',
  number: '401001',
  isAuxiliary: true,
  parentId: 'acc-401000',
};
const FISCAL_YEAR_2026 = {
  id: 'fy-2026',
  companyId: 'company-1',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-12-31'),
  closedAt: null,
};

const TEMPLATE_ROW = {
  id: 'template-1',
  companyId: 'company-1',
  name: 'Loyer bureau',
  journalId: JOURNAL_OD.id,
  libelle: 'Loyer bureau',
  frequency: 'MONTHLY' as const,
  anchorDay: 5,
  anchorMonth: null,
  lastAppliedAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  lines: [
    {
      id: 'line-1',
      templateId: 'template-1',
      order: 0,
      accountNumber: '613200',
      auxAccountNumber: null,
      vatRateId: null,
      debit: new Prisma.Decimal('500.00'),
      credit: new Prisma.Decimal('0.00'),
    },
    {
      id: 'line-2',
      templateId: 'template-1',
      order: 1,
      accountNumber: '512000',
      auxAccountNumber: null,
      vatRateId: null,
      debit: new Prisma.Decimal('0.00'),
      credit: new Prisma.Decimal('500.00'),
    },
  ],
};

function makePrismaMock() {
  const prisma = {
    journal: { findFirst: jest.fn().mockResolvedValue(JOURNAL_OD) },
    account: { findFirst: jest.fn(), findMany: jest.fn() },
    vatRate: { findMany: jest.fn() },
    fiscalYear: { findFirst: jest.fn().mockResolvedValue(FISCAL_YEAR_2026) },
    recurringEntryTemplate: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    recurringEntryTemplateLine: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

function makeValidationMock() {
  return {
    buildBalancedLignes: jest.fn(),
    assertReferencesBelongToCompany: jest.fn().mockResolvedValue(undefined),
    assertVatRatesBelongToCompany: jest.fn().mockResolvedValue(undefined),
    computeOrphanedImmobilisationWarnings: jest.fn().mockResolvedValue([]),
  };
}

function service(
  prisma: ReturnType<typeof makePrismaMock>,
  validation: ReturnType<typeof makeValidationMock>,
): RecurringEntriesService {
  return new RecurringEntriesService(
    prisma as unknown as PrismaService,
    validation as unknown as EntryValidationService,
  );
}

const validDto = {
  name: 'Loyer bureau',
  journalId: JOURNAL_OD.id,
  libelle: 'Loyer bureau',
  lines: [
    { accountNumber: '613200', debit: '500.00' },
    { accountNumber: '512000', credit: '500.00' },
  ],
};

describe('RecurringEntriesService.create', () => {
  it('creates a template after validating the journal and every line account', async () => {
    const prisma = makePrismaMock();
    prisma.account.findMany.mockResolvedValue([ACCOUNT_613200, ACCOUNT_512000]);
    prisma.recurringEntryTemplate.create.mockResolvedValue(TEMPLATE_ROW);

    const result = await service(prisma, makeValidationMock()).create(company, validDto);

    expect(result.name).toBe('Loyer bureau');
    expect(result.lines[0].debit).toBe('500.00');
    expect(prisma.recurringEntryTemplate.create).toHaveBeenCalled();
  });

  it('rejects an unknown journal', async () => {
    const prisma = makePrismaMock();
    prisma.journal.findFirst.mockResolvedValue(null);
    await expect(service(prisma, makeValidationMock()).create(company, validDto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a line naming an account that does not exist', async () => {
    const prisma = makePrismaMock();
    prisma.account.findMany.mockResolvedValue([ACCOUNT_613200]); // 512000 missing
    await expect(service(prisma, makeValidationMock()).create(company, validDto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a line with both debit and credit set', async () => {
    const prisma = makePrismaMock();
    prisma.account.findMany.mockResolvedValue([ACCOUNT_613200, ACCOUNT_512000]);
    await expect(
      service(prisma, makeValidationMock()).create(company, {
        ...validDto,
        lines: [{ accountNumber: '613200', debit: '500.00', credit: '500.00' }, validDto.lines[1]],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a tiers number that is not a valid sub-account of the line’s own collectif', async () => {
    const prisma = makePrismaMock();
    prisma.account.findMany.mockResolvedValue([
      ACCOUNT_401_COLLECTIF,
      ACCOUNT_512000,
      TIERS_401001,
    ]);
    await expect(
      service(prisma, makeValidationMock()).create(company, {
        ...validDto,
        lines: [
          { accountNumber: '401000', auxAccountNumber: '512000', debit: '500.00' },
          validDto.lines[1],
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a valid tiers sub-account', async () => {
    const prisma = makePrismaMock();
    prisma.account.findMany.mockResolvedValue([
      ACCOUNT_401_COLLECTIF,
      ACCOUNT_512000,
      TIERS_401001,
    ]);
    prisma.recurringEntryTemplate.create.mockResolvedValue(TEMPLATE_ROW);
    await expect(
      service(prisma, makeValidationMock()).create(company, {
        ...validDto,
        lines: [
          { accountNumber: '401000', auxAccountNumber: '401001', credit: '500.00' },
          { accountNumber: '512000', debit: '500.00' },
        ],
      }),
    ).resolves.toBeDefined();
  });
});

describe('RecurringEntriesService.findAll', () => {
  it('includes a computed nextDueDate per template', async () => {
    const prisma = makePrismaMock();
    prisma.recurringEntryTemplate.findMany.mockResolvedValue([TEMPLATE_ROW]);
    const [result] = await service(prisma, makeValidationMock()).findAll(company);
    expect(result.nextDueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('RecurringEntriesService.remove', () => {
  it('hard-deletes a template — pure metadata, never part of the ledger', async () => {
    const prisma = makePrismaMock();
    prisma.recurringEntryTemplate.findFirst.mockResolvedValue(TEMPLATE_ROW);
    await service(prisma, makeValidationMock()).remove(company, 'template-1');
    expect(prisma.recurringEntryTemplate.delete).toHaveBeenCalledWith({
      where: { id: 'template-1' },
    });
  });

  it('throws when the template does not belong to this company', async () => {
    const prisma = makePrismaMock();
    prisma.recurringEntryTemplate.findFirst.mockResolvedValue(null);
    await expect(service(prisma, makeValidationMock()).remove(company, 'nope')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('RecurringEntriesService.markApplied', () => {
  it('stamps lastAppliedAt', async () => {
    const prisma = makePrismaMock();
    prisma.recurringEntryTemplate.findFirst.mockResolvedValue(TEMPLATE_ROW);
    prisma.recurringEntryTemplate.update.mockResolvedValue({
      ...TEMPLATE_ROW,
      lastAppliedAt: new Date('2026-09-05'),
    });
    const result = await service(prisma, makeValidationMock()).markApplied(company, 'template-1');
    expect(prisma.recurringEntryTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'template-1' } }),
    );
    expect(result.lastAppliedAt).toEqual(new Date('2026-09-05'));
  });
});

describe('RecurringEntriesService.previewApplication', () => {
  it('resolves accounts/journal/fiscal year by their stored number/id and runs the shared validation checks — never persists', async () => {
    const prisma = makePrismaMock();
    prisma.recurringEntryTemplate.findFirst.mockResolvedValue(TEMPLATE_ROW);
    prisma.account.findFirst
      .mockResolvedValueOnce(ACCOUNT_613200)
      .mockResolvedValueOnce(ACCOUNT_512000);
    const validation = makeValidationMock();

    const result = await service(prisma, validation).previewApplication(
      company,
      'template-1',
      '2026-09-05',
    );

    expect(result.dto).toEqual({
      journalId: JOURNAL_OD.id,
      fiscalYearId: FISCAL_YEAR_2026.id,
      ecritureDate: '2026-09-05',
      libelle: 'Loyer bureau',
      lignes: [
        {
          compteId: ACCOUNT_613200.id,
          compteAuxId: undefined,
          debit: '500.00',
          credit: undefined,
          vatRateId: undefined,
        },
        {
          compteId: ACCOUNT_512000.id,
          compteAuxId: undefined,
          debit: undefined,
          credit: '500.00',
          vatRateId: undefined,
        },
      ],
    });
    expect(validation.buildBalancedLignes).toHaveBeenCalled();
    expect(validation.assertReferencesBelongToCompany).toHaveBeenCalledWith(
      company,
      JOURNAL_OD.id,
      FISCAL_YEAR_2026.id,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws when no fiscal year covers the application date', async () => {
    const prisma = makePrismaMock();
    prisma.recurringEntryTemplate.findFirst.mockResolvedValue(TEMPLATE_ROW);
    prisma.fiscalYear.findFirst.mockResolvedValue(null);
    await expect(
      service(prisma, makeValidationMock()).previewApplication(company, 'template-1', '2030-01-01'),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws, naming the account, when a stored account number no longer resolves — a stale template fails loud', async () => {
    const prisma = makePrismaMock();
    prisma.recurringEntryTemplate.findFirst.mockResolvedValue(TEMPLATE_ROW);
    prisma.account.findFirst.mockResolvedValueOnce(null); // 613200 was deleted since
    await expect(
      service(prisma, makeValidationMock()).previewApplication(company, 'template-1', '2026-09-05'),
    ).rejects.toThrow(/613200/);
  });

  it('throws when the template’s own journal no longer exists', async () => {
    const prisma = makePrismaMock();
    prisma.recurringEntryTemplate.findFirst.mockResolvedValue(TEMPLATE_ROW);
    prisma.journal.findFirst.mockResolvedValue(null);
    await expect(
      service(prisma, makeValidationMock()).previewApplication(company, 'template-1', '2026-09-05'),
    ).rejects.toThrow(NotFoundException);
  });
});
