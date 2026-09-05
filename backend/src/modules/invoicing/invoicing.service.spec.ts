import { BadRequestException, ConflictException, NotImplementedException } from '@nestjs/common';
import { InvoiceType, Prisma } from '@prisma/client';
import { InvoicingService } from './invoicing.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EntriesService } from '../entries/entries.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };

const CLIENT_ACCOUNT = {
  id: 'acc-411001',
  companyId: 'company-1',
  number: '411001',
  isAuxiliary: true,
  pcgClass: 4,
};
const REVENUE_ACCOUNT = {
  id: 'acc-707000',
  companyId: 'company-1',
  number: '707000',
  isAuxiliary: false,
  pcgClass: 7,
};
const TVA_ACCOUNT = {
  id: 'acc-445710',
  companyId: 'company-1',
  number: '445710',
  isAuxiliary: false,
  pcgClass: 4,
};
const TVA_ENCAISSEMENTS_ACCOUNT = {
  id: 'acc-445800',
  companyId: 'company-1',
  number: '445800',
  isAuxiliary: false,
  pcgClass: 4,
};
const REVENUE_ACCOUNT_706 = {
  id: 'acc-706000',
  companyId: 'company-1',
  number: '706000',
  isAuxiliary: false,
  pcgClass: 7,
};
const JOURNAL_OD = {
  id: 'journal-od',
  companyId: 'company-1',
  code: 'OD',
  type: 'OPERATIONS_DIVERSES',
};
const VAT_RATE_20 = {
  id: 'rate-20',
  companyId: 'company-1',
  ratePercent: new Prisma.Decimal('20.00'),
};
const JOURNAL_VE = { id: 'journal-ve', companyId: 'company-1', code: 'VE', type: 'VENTES' };
const COMPANY_FR = {
  id: 'company-1',
  jurisdiction: 'FR',
  name: 'Société Démo SARL',
  addressLine: '1 rue de la Paix',
  postalCode: '75002',
  city: 'Paris',
  country: 'France',
  siren: '123456789',
  rci: null,
  vatNumber: 'FR12123456789',
  nextInvoiceNum: 1,
  regimeTvaServices: 'ENCAISSEMENTS',
};
const COMPANY_MC = { ...COMPANY_FR, jurisdiction: 'MC' };
const COMPANY_FR_DEBITS = { ...COMPANY_FR, regimeTvaServices: 'DEBITS' };

const DRAFT_INVOICE = {
  id: 'invoice-1',
  companyId: 'company-1',
  fiscalYearId: 'fy-2026',
  type: InvoiceType.SALE,
  status: 'DRAFT',
  invoiceNumber: null,
  invoiceDate: null,
  clientAccountId: CLIENT_ACCOUNT.id,
  correctsInvoiceId: null,
  postedEcritureId: null,
  lines: [
    {
      id: 'line-1',
      invoiceId: 'invoice-1',
      description: 'Prestation A',
      quantity: new Prisma.Decimal('3.00'),
      unitPriceHT: new Prisma.Decimal('500.00'),
      revenueAccountId: REVENUE_ACCOUNT.id,
      vatRateId: VAT_RATE_20.id,
    },
  ],
};

function makePrismaMock() {
  const prisma = {
    company: { findFirst: jest.fn(), update: jest.fn() },
    fiscalYear: {
      findFirst: jest.fn().mockResolvedValue({ id: 'fy-2026', companyId: 'company-1' }),
    },
    account: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([REVENUE_ACCOUNT]),
    },
    vatRate: { findMany: jest.fn(), count: jest.fn() },
    journal: { findFirst: jest.fn().mockResolvedValue(JOURNAL_VE) },
    invoice: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    invoiceLine: { deleteMany: jest.fn() },
    ecriture: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

function makeEntriesServiceMock() {
  return {
    create: jest.fn().mockResolvedValue({ id: 'draft-ecriture-1', lignes: [], warnings: [] }),
    validate: jest.fn().mockResolvedValue({ id: 'ecriture-1', ecritureNum: '1' }),
  };
}

function service(
  prisma: ReturnType<typeof makePrismaMock>,
  entries: ReturnType<typeof makeEntriesServiceMock>,
): InvoicingService {
  return new InvoicingService(
    prisma as unknown as PrismaService,
    entries as unknown as EntriesService,
  );
}

describe('InvoicingService.create', () => {
  it('creates a DRAFT SALE invoice after validating client/revenue accounts belong to the company', async () => {
    const prisma = makePrismaMock();
    prisma.account.findFirst.mockResolvedValue(CLIENT_ACCOUNT);
    prisma.account.findMany.mockResolvedValue([REVENUE_ACCOUNT]);
    prisma.vatRate.count.mockResolvedValue(1);
    prisma.invoice.create.mockResolvedValue(DRAFT_INVOICE);

    const result = await service(prisma, makeEntriesServiceMock()).create(company, {
      fiscalYearId: 'fy-2026',
      clientAccountId: CLIENT_ACCOUNT.id,
      lines: [
        {
          description: 'Prestation A',
          quantity: '3.00',
          unitPriceHT: '500.00',
          revenueAccountId: REVENUE_ACCOUNT.id,
          vatRateId: VAT_RATE_20.id,
        },
      ],
    });
    expect(result.status).toBe('DRAFT');
    expect(prisma.invoice.create).toHaveBeenCalled();
  });

  it('rejects a CREDIT_NOTE with no correctsInvoiceId', async () => {
    const prisma = makePrismaMock();
    await expect(
      service(prisma, makeEntriesServiceMock()).create(company, {
        fiscalYearId: 'fy-2026',
        type: InvoiceType.CREDIT_NOTE,
        clientAccountId: CLIENT_ACCOUNT.id,
        lines: [
          {
            description: 'x',
            quantity: '1.00',
            unitPriceHT: '1.00',
            revenueAccountId: REVENUE_ACCOUNT.id,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects correctsInvoiceId referencing a non-finalized or non-SALE invoice', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findFirst.mockResolvedValue({
      ...DRAFT_INVOICE,
      type: InvoiceType.SALE,
      status: 'DRAFT',
    });
    await expect(
      service(prisma, makeEntriesServiceMock()).create(company, {
        fiscalYearId: 'fy-2026',
        type: InvoiceType.CREDIT_NOTE,
        correctsInvoiceId: 'invoice-1',
        clientAccountId: CLIENT_ACCOUNT.id,
        lines: [
          {
            description: 'x',
            quantity: '1.00',
            unitPriceHT: '1.00',
            revenueAccountId: REVENUE_ACCOUNT.id,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a client account that is not a 411-family auxiliary account', async () => {
    const prisma = makePrismaMock();
    prisma.account.findFirst.mockResolvedValue({
      ...CLIENT_ACCOUNT,
      number: '512000',
      isAuxiliary: false,
    });
    await expect(
      service(prisma, makeEntriesServiceMock()).create(company, {
        fiscalYearId: 'fy-2026',
        clientAccountId: 'acc-512000',
        lines: [
          {
            description: 'x',
            quantity: '1.00',
            unitPriceHT: '1.00',
            revenueAccountId: REVENUE_ACCOUNT.id,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a revenue account that is not class 7', async () => {
    const prisma = makePrismaMock();
    prisma.account.findFirst.mockResolvedValue(CLIENT_ACCOUNT);
    prisma.account.findMany.mockResolvedValue([
      { ...REVENUE_ACCOUNT, pcgClass: 6, number: '607000' },
    ]);
    await expect(
      service(prisma, makeEntriesServiceMock()).create(company, {
        fiscalYearId: 'fy-2026',
        clientAccountId: CLIENT_ACCOUNT.id,
        lines: [
          {
            description: 'x',
            quantity: '1.00',
            unitPriceHT: '1.00',
            revenueAccountId: REVENUE_ACCOUNT.id,
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('InvoicingService.finalize', () => {
  const finalizeDto = {
    invoiceDate: '2026-08-30',
    clientName: 'Client Petit SARL',
    clientAddressLine: '12 rue de la Paix',
    clientPostalCode: '75002',
    clientCity: 'Paris',
    clientCountryCode: 'FR',
  };

  it('FR: posts a real balanced écriture via EntriesService and assigns invoiceNumber/postedEcritureId — the gated core', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findFirst.mockResolvedValue(DRAFT_INVOICE);
    prisma.company.findFirst.mockResolvedValue(COMPANY_FR);
    prisma.vatRate.findMany.mockResolvedValue([VAT_RATE_20]);
    prisma.account.findFirst.mockImplementation(
      ({ where }: { where: { id?: string; number?: string } }) => {
        if (where.number === '445710') return Promise.resolve(TVA_ACCOUNT);
        return Promise.resolve(CLIENT_ACCOUNT);
      },
    );
    prisma.invoice.update.mockResolvedValue({
      ...DRAFT_INVOICE,
      status: 'FINALIZED',
      invoiceNumber: '1',
    });
    const entries = makeEntriesServiceMock();

    const result = await service(prisma, entries).finalize(company, 'invoice-1', finalizeDto);

    expect(entries.create).toHaveBeenCalledTimes(1);
    const posted = entries.create.mock.calls[0][1];
    expect(posted.lignes).toEqual([
      { compteId: CLIENT_ACCOUNT.id, debit: '1800.00' },
      { compteId: REVENUE_ACCOUNT.id, credit: '1500.00' },
      { compteId: TVA_ACCOUNT.id, credit: '300.00', vatRateId: VAT_RATE_20.id },
    ]);
    expect(entries.validate).toHaveBeenCalledTimes(1);
    expect(prisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { nextInvoiceNum: { increment: 1 } } }),
    );
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FINALIZED',
          invoiceNumber: '1',
          postedEcritureId: 'ecriture-1',
        }),
      }),
    );
    expect(result.mentions.totalTTC).toBe('1800.00');
  });

  it('MC: refuses with zero side effects — no écriture posted, no invoiceNumber consumed', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findFirst.mockResolvedValue(DRAFT_INVOICE);
    prisma.company.findFirst.mockResolvedValue(COMPANY_MC);
    prisma.vatRate.findMany.mockResolvedValue([VAT_RATE_20]);
    const entries = makeEntriesServiceMock();

    await expect(
      service(prisma, entries).finalize(company, 'invoice-1', finalizeDto),
    ).rejects.toThrow(NotImplementedException);
    expect(entries.create).not.toHaveBeenCalled();
    expect(prisma.company.update).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it('refuses to re-finalize an already-FINALIZED invoice', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findFirst.mockResolvedValue({ ...DRAFT_INVOICE, status: 'FINALIZED' });
    await expect(
      service(prisma, makeEntriesServiceMock()).finalize(company, 'invoice-1', finalizeDto),
    ).rejects.toThrow(ConflictException);
  });
});

// TVA sur les encaissements (CGI art. 269) — see CLAUDE.md "Invoicing — cash-basis VAT".
describe('InvoicingService.finalize — cash-basis VAT (TVA sur les encaissements)', () => {
  const finalizeDto = {
    invoiceDate: '2026-08-30',
    clientName: 'Client Petit SARL',
    clientCountryCode: 'FR',
  };
  const INVOICE_706 = {
    ...DRAFT_INVOICE,
    lines: [{ ...DRAFT_INVOICE.lines[0], revenueAccountId: REVENUE_ACCOUNT_706.id }],
  };

  it('a 706 line under ENCAISSEMENTS credits 445800, not 445710', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findFirst.mockResolvedValue(INVOICE_706);
    prisma.company.findFirst.mockResolvedValue(COMPANY_FR);
    prisma.vatRate.findMany.mockResolvedValue([VAT_RATE_20]);
    prisma.account.findMany.mockResolvedValue([REVENUE_ACCOUNT_706]);
    prisma.account.findFirst.mockImplementation(
      ({ where }: { where: { id?: string; number?: string } }) => {
        if (where.number === '445710') return Promise.resolve(TVA_ACCOUNT);
        if (where.number === '445800') return Promise.resolve(TVA_ENCAISSEMENTS_ACCOUNT);
        return Promise.resolve(CLIENT_ACCOUNT);
      },
    );
    prisma.invoice.update.mockResolvedValue({
      ...INVOICE_706,
      status: 'FINALIZED',
      invoiceNumber: '1',
    });
    const entries = makeEntriesServiceMock();

    await service(prisma, entries).finalize(company, 'invoice-1', finalizeDto);

    const posted = entries.create.mock.calls[0][1];
    expect(posted.lignes).toEqual([
      { compteId: CLIENT_ACCOUNT.id, debit: '1800.00' },
      { compteId: REVENUE_ACCOUNT_706.id, credit: '1500.00' },
      { compteId: TVA_ENCAISSEMENTS_ACCOUNT.id, credit: '300.00', vatRateId: VAT_RATE_20.id },
    ]);
  });

  it('a 706 line under DEBITS credits 445710 directly (no 445800 lookup)', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findFirst.mockResolvedValue(INVOICE_706);
    prisma.company.findFirst.mockResolvedValue(COMPANY_FR_DEBITS);
    prisma.vatRate.findMany.mockResolvedValue([VAT_RATE_20]);
    prisma.account.findMany.mockResolvedValue([REVENUE_ACCOUNT_706]);
    prisma.account.findFirst.mockImplementation(
      ({ where }: { where: { id?: string; number?: string } }) => {
        if (where.number === '445710') return Promise.resolve(TVA_ACCOUNT);
        if (where.number === '445800') {
          throw new Error('445800 should never be looked up under DEBITS regime');
        }
        return Promise.resolve(CLIENT_ACCOUNT);
      },
    );
    prisma.invoice.update.mockResolvedValue({
      ...INVOICE_706,
      status: 'FINALIZED',
      invoiceNumber: '1',
    });
    const entries = makeEntriesServiceMock();

    await service(prisma, entries).finalize(company, 'invoice-1', finalizeDto);

    const posted = entries.create.mock.calls[0][1];
    expect(posted.lignes).toEqual([
      { compteId: CLIENT_ACCOUNT.id, debit: '1800.00' },
      { compteId: REVENUE_ACCOUNT_706.id, credit: '1500.00' },
      { compteId: TVA_ACCOUNT.id, credit: '300.00', vatRateId: VAT_RATE_20.id },
    ]);
  });
});

describe('InvoicingService.markAsEncaisse', () => {
  const FINALIZED_706_INVOICE = {
    ...DRAFT_INVOICE,
    status: 'FINALIZED',
    invoiceNumber: '1',
    postedEcritureId: 'ecriture-1',
    encaissementConfirmedAt: null,
    lines: [{ ...DRAFT_INVOICE.lines[0], revenueAccountId: REVENUE_ACCOUNT_706.id }],
  };

  function mockAccountFindFirst(prisma: ReturnType<typeof makePrismaMock>) {
    prisma.account.findFirst.mockImplementation(({ where }: { where: { number?: string } }) => {
      if (where.number === '445710') return Promise.resolve(TVA_ACCOUNT);
      if (where.number === '445800') return Promise.resolve(TVA_ENCAISSEMENTS_ACCOUNT);
      return Promise.resolve(null);
    });
  }

  it('posts a débit-445800/crédit-445710 reclassification for the exact posted amount, preserving vatRateId', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findFirst.mockResolvedValue(FINALIZED_706_INVOICE);
    mockAccountFindFirst(prisma);
    prisma.journal.findFirst.mockResolvedValue(JOURNAL_OD);
    prisma.ecriture.findFirst.mockResolvedValue({
      id: 'ecriture-1',
      lignes: [
        {
          compteId: TVA_ENCAISSEMENTS_ACCOUNT.id,
          debit: new Prisma.Decimal('0.00'),
          credit: new Prisma.Decimal('300.00'),
          vatRateId: VAT_RATE_20.id,
        },
      ],
    });
    prisma.invoice.update.mockResolvedValue({
      ...FINALIZED_706_INVOICE,
      encaissementConfirmedAt: new Date(),
      encaissementEcritureId: 'ecriture-1',
    });
    const entries = makeEntriesServiceMock();

    await service(prisma, entries).markAsEncaisse(company, 'invoice-1');

    expect(entries.create).toHaveBeenCalledTimes(1);
    const posted = entries.create.mock.calls[0][1];
    expect(posted.lignes).toEqual([
      { compteId: TVA_ENCAISSEMENTS_ACCOUNT.id, debit: '300.00', vatRateId: VAT_RATE_20.id },
      { compteId: TVA_ACCOUNT.id, credit: '300.00', vatRateId: VAT_RATE_20.id },
    ]);
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          encaissementEcritureId: 'ecriture-1',
        }),
      }),
    );
  });

  it('refuses a DRAFT invoice', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findFirst.mockResolvedValue(DRAFT_INVOICE);
    await expect(
      service(prisma, makeEntriesServiceMock()).markAsEncaisse(company, 'invoice-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses a CREDIT_NOTE', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findFirst.mockResolvedValue({
      ...FINALIZED_706_INVOICE,
      type: InvoiceType.CREDIT_NOTE,
    });
    await expect(
      service(prisma, makeEntriesServiceMock()).markAsEncaisse(company, 'invoice-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses an already-encaissée invoice', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findFirst.mockResolvedValue({
      ...FINALIZED_706_INVOICE,
      encaissementConfirmedAt: new Date('2026-08-30'),
    });
    await expect(
      service(prisma, makeEntriesServiceMock()).markAsEncaisse(company, 'invoice-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses an invoice with no TVA sur encaissements to reclassify', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findFirst.mockResolvedValue(FINALIZED_706_INVOICE);
    mockAccountFindFirst(prisma);
    prisma.ecriture.findFirst.mockResolvedValue({
      id: 'ecriture-1',
      lignes: [
        {
          compteId: TVA_ACCOUNT.id,
          debit: new Prisma.Decimal('0.00'),
          credit: new Prisma.Decimal('300.00'),
          vatRateId: VAT_RATE_20.id,
        },
      ],
    });
    await expect(
      service(prisma, makeEntriesServiceMock()).markAsEncaisse(company, 'invoice-1'),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('InvoicingService.getMentions', () => {
  it('re-derives mentions and ties them to the ACTUAL posted écriture lines, not just the invoice rows', async () => {
    const prisma = makePrismaMock();
    const finalizedInvoice = {
      ...DRAFT_INVOICE,
      status: 'FINALIZED',
      invoiceNumber: '1',
      invoiceDate: new Date('2026-08-30'),
      clientNameSnapshot: 'Client Petit SARL',
      clientAddressLineSnapshot: '12 rue de la Paix',
      clientPostalCodeSnapshot: '75002',
      clientCitySnapshot: 'Paris',
      clientCountrySnapshot: 'FR',
      clientSirenOrRci: null,
      clientVatNumber: null,
      postedEcritureId: 'ecriture-1',
    };
    prisma.invoice.findFirst.mockResolvedValue(finalizedInvoice);
    prisma.company.findFirst.mockResolvedValue(COMPANY_FR);
    prisma.vatRate.findMany.mockResolvedValue([VAT_RATE_20]);
    prisma.ecriture.findFirst.mockResolvedValue({
      id: 'ecriture-1',
      lignes: [
        {
          compteId: CLIENT_ACCOUNT.id,
          debit: new Prisma.Decimal('1800.00'),
          credit: new Prisma.Decimal('0.00'),
        },
        {
          compteId: REVENUE_ACCOUNT.id,
          debit: new Prisma.Decimal('0.00'),
          credit: new Prisma.Decimal('1500.00'),
        },
      ],
    });

    const mentions = await service(prisma, makeEntriesServiceMock()).getMentions(
      company,
      'invoice-1',
    );
    expect(mentions.totalTTC).toBe('1800.00');
  });

  it('throws if the mentions total no longer ties to the actual posted écriture (e.g. it was tampered with)', async () => {
    const prisma = makePrismaMock();
    prisma.invoice.findFirst.mockResolvedValue({
      ...DRAFT_INVOICE,
      status: 'FINALIZED',
      invoiceNumber: '1',
      invoiceDate: new Date('2026-08-30'),
      clientNameSnapshot: 'Client Petit SARL',
      clientAddressLineSnapshot: 'x',
      clientCountrySnapshot: 'FR',
      postedEcritureId: 'ecriture-1',
    });
    prisma.company.findFirst.mockResolvedValue(COMPANY_FR);
    prisma.vatRate.findMany.mockResolvedValue([VAT_RATE_20]);
    prisma.ecriture.findFirst.mockResolvedValue({
      id: 'ecriture-1',
      lignes: [
        {
          compteId: CLIENT_ACCOUNT.id,
          debit: new Prisma.Decimal('999.00'),
          credit: new Prisma.Decimal('0.00'),
        },
      ],
    });

    await expect(
      service(prisma, makeEntriesServiceMock()).getMentions(company, 'invoice-1'),
    ).rejects.toThrow(ConflictException);
  });
});
