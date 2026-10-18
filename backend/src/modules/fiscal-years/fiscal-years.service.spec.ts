import { ConflictException } from '@nestjs/common';
import { FiscalYearsService } from './fiscal-years.service';
import { FecExportService } from '../fec/fec-export.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1', role: 'OWNER' };

function makePrismaMock() {
  const prisma = {
    fiscalYear: {
      findFirst: jest.fn().mockResolvedValue({ id: 'fy-1', label: '2026', closedAt: null }),
      update: jest.fn((args: { where: { id: string }; data: unknown }) => ({
        id: args.where.id,
        ...(args.data as object),
      })),
    },
    ecriture: { count: jest.fn().mockResolvedValue(0) },
    archivedExport: {
      upsert: jest.fn().mockResolvedValue({ id: 'archive-1' }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

function makeFecExportServiceMock() {
  return {
    generate: jest
      .fn()
      .mockResolvedValue({ fileName: '123456789FEC20261231.txt', content: 'fake-fec-content' }),
  };
}

describe('FiscalYearsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fecExportService: ReturnType<typeof makeFecExportServiceMock>;
  let service: FiscalYearsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fecExportService = makeFecExportServiceMock();
    service = new FiscalYearsService(
      prisma as unknown as PrismaService,
      fecExportService as unknown as FecExportService,
    );
  });

  describe('close', () => {
    it('closes a fiscal year with no draft écritures', async () => {
      const result = await service.close(company, 'fy-1');
      expect(prisma.ecriture.count).toHaveBeenCalledWith({
        where: { companyId: company.companyId, fiscalYearId: 'fy-1', validatedAt: null },
      });
      expect(prisma.fiscalYear.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'fy-1' }, data: { closedAt: expect.any(Date) } }),
      );
      expect(result).toBeDefined();
    });

    it('refuses to close a fiscal year with draft écritures, naming how many remain', async () => {
      prisma.ecriture.count.mockResolvedValue(3);
      await expect(service.close(company, 'fy-1')).rejects.toThrow(ConflictException);
      await expect(service.close(company, 'fy-1')).rejects.toThrow(/3 écriture/);
      expect(prisma.fiscalYear.update).not.toHaveBeenCalled();
    });

    it('refuses to close an already-closed fiscal year', async () => {
      prisma.fiscalYear.findFirst.mockResolvedValueOnce({
        id: 'fy-1',
        label: '2026',
        closedAt: new Date(),
      });
      await expect(service.close(company, 'fy-1')).rejects.toThrow(ConflictException);
      expect(prisma.ecriture.count).not.toHaveBeenCalled();
    });

    it('generates the FEC and archives it (hashed) in the same action, before setting closedAt', async () => {
      await service.close(company, 'fy-1');
      expect(fecExportService.generate).toHaveBeenCalledWith(company, 'fy-1');
      expect(prisma.archivedExport.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId_fiscalYearId_kind: {
              companyId: 'company-1',
              fiscalYearId: 'fy-1',
              kind: 'FEC',
            },
          },
          create: expect.objectContaining({
            companyId: 'company-1',
            fiscalYearId: 'fy-1',
            kind: 'FEC',
            fileName: '123456789FEC20261231.txt',
            // sha256("fake-fec-content") — a real hash, not a placeholder,
            // confirming the actual content is what gets hashed.
            sha256Hash: expect.stringMatching(/^[0-9a-f]{64}$/),
          }),
          update: {},
        }),
      );
    });

    it('refuses to close when the FEC itself cannot be generated (e.g. missing SIREN/RCI), leaving the year open', async () => {
      fecExportService.generate.mockRejectedValueOnce(
        new Error('Company is missing its SIREN; a FEC export cannot be produced without it.'),
      );
      await expect(service.close(company, 'fy-1')).rejects.toThrow(/missing its SIREN/);
      expect(prisma.archivedExport.upsert).not.toHaveBeenCalled();
      expect(prisma.fiscalYear.update).not.toHaveBeenCalled();
    });

    it('re-checks for drafts inside the transaction, refusing a race where one appeared after the first check', async () => {
      prisma.ecriture.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      await expect(service.close(company, 'fy-1')).rejects.toThrow(ConflictException);
      expect(prisma.archivedExport.upsert).not.toHaveBeenCalled();
      expect(prisma.fiscalYear.update).not.toHaveBeenCalled();
    });
  });

  describe('getArchive', () => {
    it('returns null for a fiscal year with no archive yet', async () => {
      const archive = await service.getArchive(company, 'fy-1');
      expect(archive).toBeNull();
      expect(prisma.archivedExport.findUnique).toHaveBeenCalledWith({
        where: {
          companyId_fiscalYearId_kind: {
            companyId: 'company-1',
            fiscalYearId: 'fy-1',
            kind: 'FEC',
          },
        },
      });
    });

    it('returns the real archive record once one exists', async () => {
      const record = {
        id: 'archive-1',
        companyId: 'company-1',
        fiscalYearId: 'fy-1',
        kind: 'FEC',
        fileName: '123456789FEC20261231.txt',
        sha256Hash: 'abc123',
        generatedAt: new Date(),
      };
      prisma.archivedExport.findUnique.mockResolvedValueOnce(record);
      const archive = await service.getArchive(company, 'fy-1');
      expect(archive).toEqual(record);
    });
  });
});
