import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentAuditAction } from '@prisma/client';
import { EcritureDocumentsService } from './ecriture-documents.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
  unlink: jest.fn().mockResolvedValue(undefined),
}));
import * as fs from 'fs/promises';

const company: CompanyContext = { companyId: 'company-1' };

function pdfFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'facture.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('pdf-bytes'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as unknown as Express.Multer.File['stream'],
    ...overrides,
  };
}

function makePrismaMock() {
  const prisma = {
    ecriture: { findFirst: jest.fn() },
    ecritureDocument: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn((args: { data: unknown }) => ({ id: 'doc-1', ...(args.data as object) })),
      update: jest.fn((args: { where: { id: string }; data: unknown }) => ({
        id: args.where.id,
        ...(args.data as object),
      })),
      delete: jest.fn(),
    },
    ecritureDocumentAuditLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(prisma));
  return prisma;
}

function makeConfigMock(dir = './storage-test') {
  return { get: jest.fn().mockReturnValue(dir) };
}

describe('EcritureDocumentsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let config: ReturnType<typeof makeConfigMock>;
  let service: EcritureDocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = makePrismaMock();
    config = makeConfigMock();
    service = new EcritureDocumentsService(
      prisma as unknown as PrismaService,
      config as unknown as import('@nestjs/config').ConfigService,
    );
  });

  describe('attach', () => {
    it('rejects an écriture that does not belong to this company', async () => {
      prisma.ecriture.findFirst.mockResolvedValueOnce(null);
      await expect(service.attach(company, 'ecriture-x', pdfFile())).rejects.toThrow(
        NotFoundException,
      );
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('rejects an unsupported file type before writing anything to disk', async () => {
      prisma.ecriture.findFirst.mockResolvedValueOnce({ id: 'ecriture-1' });
      const file = pdfFile({ mimetype: 'application/zip' });
      await expect(service.attach(company, 'ecriture-1', file)).rejects.toThrow(
        BadRequestException,
      );
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('rejects an oversized file before writing anything to disk', async () => {
      prisma.ecriture.findFirst.mockResolvedValueOnce({ id: 'ecriture-1' });
      const file = pdfFile({ size: 20 * 1024 * 1024 });
      await expect(service.attach(company, 'ecriture-1', file)).rejects.toThrow(
        BadRequestException,
      );
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('allows attaching to an already-validated entry — no assertDraft/assertFiscalYearOpen call', async () => {
      prisma.ecriture.findFirst.mockResolvedValueOnce({
        id: 'ecriture-1',
        validatedAt: new Date(),
      });
      const document = await service.attach(company, 'ecriture-1', pdfFile());
      expect(document.fileName).toBe('facture.pdf');
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('writes exactly one ATTACHED audit log row in the same transaction as the create', async () => {
      prisma.ecriture.findFirst.mockResolvedValueOnce({ id: 'ecriture-1' });
      await service.attach(company, 'ecriture-1', pdfFile());
      expect(prisma.ecritureDocumentAuditLog.create).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1',
          ecritureId: 'ecriture-1',
          action: DocumentAuditAction.ATTACHED,
          fileName: 'facture.pdf',
        },
      });
    });

    it('cleans up the just-written file if the DB transaction fails', async () => {
      prisma.ecriture.findFirst.mockResolvedValueOnce({ id: 'ecriture-1' });
      prisma.$transaction.mockRejectedValueOnce(new Error('db exploded'));
      await expect(service.attach(company, 'ecriture-1', pdfFile())).rejects.toThrow('db exploded');
      expect(fs.unlink).toHaveBeenCalledTimes(1);
    });
  });

  describe('replace', () => {
    it('logs REPLACED and deletes the old file, keeps the new one', async () => {
      prisma.ecritureDocument.findFirst.mockResolvedValueOnce({
        id: 'doc-1',
        fileName: 'ancienne.pdf',
        storagePath: 'company-1/old-name.pdf',
      });
      await service.replace(
        company,
        'ecriture-1',
        'doc-1',
        pdfFile({ originalname: 'nouvelle.pdf' }),
      );
      expect(prisma.ecritureDocumentAuditLog.create).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1',
          ecritureId: 'ecriture-1',
          action: DocumentAuditAction.REPLACED,
          fileName: 'ancienne.pdf → nouvelle.pdf',
        },
      });
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('old-name.pdf'));
    });

    it('rejects replacing a document that does not belong to this ecriture/company', async () => {
      prisma.ecritureDocument.findFirst.mockResolvedValueOnce(null);
      await expect(service.replace(company, 'ecriture-1', 'doc-x', pdfFile())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('deletes the row, logs REMOVED, and deletes the file', async () => {
      prisma.ecritureDocument.findFirst.mockResolvedValueOnce({
        id: 'doc-1',
        fileName: 'facture.pdf',
        storagePath: 'company-1/some-name.pdf',
      });
      await service.remove(company, 'ecriture-1', 'doc-1');
      expect(prisma.ecritureDocument.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
      expect(prisma.ecritureDocumentAuditLog.create).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1',
          ecritureId: 'ecriture-1',
          action: DocumentAuditAction.REMOVED,
          fileName: 'facture.pdf',
        },
      });
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('some-name.pdf'));
    });

    it('allows removing a document from an already-validated entry — freely, only logged', async () => {
      prisma.ecritureDocument.findFirst.mockResolvedValueOnce({
        id: 'doc-1',
        fileName: 'facture.pdf',
        storagePath: 'company-1/some-name.pdf',
      });
      await expect(service.remove(company, 'ecriture-1', 'doc-1')).resolves.toBeUndefined();
    });
  });

  describe('auditLog', () => {
    it("lists this ecriture's log rows, scoped to the company", async () => {
      prisma.ecriture.findFirst.mockResolvedValueOnce({ id: 'ecriture-1' });
      prisma.ecritureDocumentAuditLog.findMany.mockResolvedValueOnce([
        {
          id: 'log-1',
          action: DocumentAuditAction.ATTACHED,
          fileName: 'facture.pdf',
          occurredAt: new Date(),
        },
      ]);
      const log = await service.auditLog(company, 'ecriture-1');
      expect(log).toHaveLength(1);
      expect(prisma.ecritureDocumentAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'company-1', ecritureId: 'ecriture-1' } }),
      );
    });
  });
});
