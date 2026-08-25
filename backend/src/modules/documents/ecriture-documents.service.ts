import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentAuditAction, EcritureDocument } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const ACCEPTED_MIME_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/** A generous ceiling for a scanned invoice/receipt — sane storage hygiene, not a computation. */
const MAX_SIZE_BYTES = 15 * 1024 * 1024;

export interface EcritureDocumentAuditEntry {
  id: string;
  action: DocumentAuditAction;
  fileName: string;
  occurredAt: Date;
}

/**
 * Attach/replace/remove a justificatif (invoice/receipt, PDF or image) on
 * an écriture, plus the append-only audit log this feature relies on to
 * stay honest about it — see CLAUDE.md "Supporting-document attachments".
 *
 * DELIBERATELY never calls assertDraft() or assertFiscalYearOpen(): a
 * document is metadata ABOUT an entry, never a component of its balance,
 * so a validated/immutable écriture or a closed fiscal year never blocks
 * attach/replace/remove here — the compliance answer to "can you attach
 * to a validated entry" is "yes, always, and it's logged," not "no."
 * Every mutating call below writes exactly one EcritureDocumentAuditLog
 * row in the same transaction as the change itself.
 *
 * The file itself lives on local disk under
 * `${DOCUMENT_STORAGE_DIR}/${companyId}/${a fresh random name}` — never
 * in this table, never in any cloud storage, matching this app's
 * existing local-first stance for chat history and local-model inference.
 * The on-disk name is always server-generated (`randomUUID()`), never
 * derived from the original filename, so there is no path-traversal
 * surface from a hostile upload name; the original name is kept only as
 * the `fileName` column, for display.
 */
@Injectable()
export class EcritureDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async list(company: CompanyContext, ecritureId: string): Promise<EcritureDocument[]> {
    await this.assertEcritureBelongsToCompany(company, ecritureId);
    return this.prisma.ecritureDocument.findMany({
      where: { companyId: company.companyId, ecritureId },
      orderBy: { uploadedAt: 'asc' },
    });
  }

  async getFile(
    company: CompanyContext,
    ecritureId: string,
    documentId: string,
  ): Promise<{ document: EcritureDocument; buffer: Buffer }> {
    const document = await this.findOwnDocument(company, ecritureId, documentId);
    const buffer = await fs.readFile(path.join(this.storageRoot(), document.storagePath));
    return { document, buffer };
  }

  async attach(
    company: CompanyContext,
    ecritureId: string,
    file: Express.Multer.File,
  ): Promise<EcritureDocument> {
    await this.assertEcritureBelongsToCompany(company, ecritureId);
    this.assertSize(file);
    const storagePath = this.buildStoragePath(company.companyId, file.mimetype);
    await this.writeFile(storagePath, file.buffer);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const document = await tx.ecritureDocument.create({
          data: {
            companyId: company.companyId,
            ecritureId,
            fileName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            storagePath,
          },
        });
        await tx.ecritureDocumentAuditLog.create({
          data: {
            companyId: company.companyId,
            ecritureId,
            action: DocumentAuditAction.ATTACHED,
            fileName: file.originalname,
          },
        });
        return document;
      });
    } catch (err) {
      await this.deleteFileQuietly(storagePath);
      throw err;
    }
  }

  async replace(
    company: CompanyContext,
    ecritureId: string,
    documentId: string,
    file: Express.Multer.File,
  ): Promise<EcritureDocument> {
    const existing = await this.findOwnDocument(company, ecritureId, documentId);
    this.assertSize(file);
    const storagePath = this.buildStoragePath(company.companyId, file.mimetype);
    await this.writeFile(storagePath, file.buffer);
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const document = await tx.ecritureDocument.update({
          where: { id: documentId },
          data: {
            fileName: file.originalname,
            mimeType: file.mimetype,
            sizeBytes: file.size,
            storagePath,
            uploadedAt: new Date(),
          },
        });
        await tx.ecritureDocumentAuditLog.create({
          data: {
            companyId: company.companyId,
            ecritureId,
            action: DocumentAuditAction.REPLACED,
            fileName: `${existing.fileName} → ${file.originalname}`,
          },
        });
        return document;
      });
      await this.deleteFileQuietly(existing.storagePath);
      return updated;
    } catch (err) {
      await this.deleteFileQuietly(storagePath);
      throw err;
    }
  }

  async remove(company: CompanyContext, ecritureId: string, documentId: string): Promise<void> {
    const existing = await this.findOwnDocument(company, ecritureId, documentId);
    await this.prisma.$transaction(async (tx) => {
      await tx.ecritureDocument.delete({ where: { id: documentId } });
      await tx.ecritureDocumentAuditLog.create({
        data: {
          companyId: company.companyId,
          ecritureId,
          action: DocumentAuditAction.REMOVED,
          fileName: existing.fileName,
        },
      });
    });
    await this.deleteFileQuietly(existing.storagePath);
  }

  async auditLog(
    company: CompanyContext,
    ecritureId: string,
  ): Promise<EcritureDocumentAuditEntry[]> {
    await this.assertEcritureBelongsToCompany(company, ecritureId);
    return this.prisma.ecritureDocumentAuditLog.findMany({
      where: { companyId: company.companyId, ecritureId },
      orderBy: { occurredAt: 'asc' },
      select: { id: true, action: true, fileName: true, occurredAt: true },
    });
  }

  private async assertEcritureBelongsToCompany(
    company: CompanyContext,
    ecritureId: string,
  ): Promise<void> {
    const ecriture = await this.prisma.ecriture.findFirst({
      where: { id: ecritureId, companyId: company.companyId },
    });
    if (!ecriture) {
      throw new NotFoundException(`Écriture ${ecritureId} not found`);
    }
  }

  private async findOwnDocument(
    company: CompanyContext,
    ecritureId: string,
    documentId: string,
  ): Promise<EcritureDocument> {
    const document = await this.prisma.ecritureDocument.findFirst({
      where: { id: documentId, ecritureId, companyId: company.companyId },
    });
    if (!document) {
      throw new NotFoundException(`Document ${documentId} not found`);
    }
    return document;
  }

  private assertSize(file: Express.Multer.File): void {
    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException(
        `Fichier trop volumineux (${(file.size / 1024 / 1024).toFixed(1)} Mo) — 15 Mo maximum.`,
      );
    }
  }

  private buildStoragePath(companyId: string, mimeType: string): string {
    const ext = ACCEPTED_MIME_TYPES[mimeType];
    if (!ext) {
      throw new BadRequestException(
        `Type de fichier non pris en charge (${mimeType}) — seuls le PDF, le JPEG et le PNG sont acceptés.`,
      );
    }
    return path.posix.join(companyId, `${randomUUID()}${ext}`);
  }

  private storageRoot(): string {
    return this.config.get<string>('DOCUMENT_STORAGE_DIR') ?? './storage/documents';
  }

  private async writeFile(relativePath: string, buffer: Buffer): Promise<void> {
    const absolute = path.join(this.storageRoot(), relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, buffer);
  }

  private async deleteFileQuietly(relativePath: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.storageRoot(), relativePath));
    } catch {
      // Best-effort cleanup (e.g. a DB write failed after the file was
      // written, or a replace's old file was already gone) — an orphaned
      // or already-missing file is not an error worth surfacing.
    }
  }
}
