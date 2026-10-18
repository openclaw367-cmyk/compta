import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ArchivedExport, FiscalYear, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateFiscalYearDto } from './dto/create-fiscal-year.dto';
import { FecExportService } from '../fec/fec-export.service';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

@Injectable()
export class FiscalYearsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fecExportService: FecExportService,
  ) {}

  async create(company: CompanyContext, dto: CreateFiscalYearDto): Promise<FiscalYear> {
    try {
      return await this.prisma.fiscalYear.create({
        data: {
          companyId: company.companyId,
          label: dto.label,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR) {
          throw new ConflictException(`Fiscal year "${dto.label}" already exists.`);
        }
      }
      throw error;
    }
  }

  findAll(company: CompanyContext): Promise<FiscalYear[]> {
    return this.prisma.fiscalYear.findMany({
      where: { companyId: company.companyId },
      orderBy: { startDate: 'desc' },
    });
  }

  async findOne(company: CompanyContext, id: string): Promise<FiscalYear> {
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${id} not found`);
    }
    return fiscalYear;
  }

  /**
   * The tamper-evident archival record for this fiscal year's FEC, if
   * one exists yet — null for an open year, or a closed year never
   * exported since closing (see FecExportService.generate()'s own
   * backfill path, which closes that gap the next time someone exports
   * it). See CLAUDE.md "Operational readiness — clôture d'exercice
   * archival".
   */
  async getArchive(company: CompanyContext, id: string): Promise<ArchivedExport | null> {
    await this.findOne(company, id);
    return this.prisma.archivedExport.findUnique({
      where: {
        companyId_fiscalYearId_kind: {
          companyId: company.companyId,
          fiscalYearId: id,
          kind: 'FEC',
        },
      },
    });
  }

  /**
   * Locks the fiscal year. Refuses while any écriture in it is still a
   * draft (unvalidated) — once closed, EntriesService/ImportExcelService
   * reject new or mutated écritures for it (see assertFiscalYearOpen), so
   * a draft left behind at close time would become permanently stuck.
   *
   * Also generates and permanently archives this year's own FEC as part
   * of the SAME action — "closed" and "archived" become one atomic
   * moment, never two independent steps someone could forget between.
   * This is a real, deliberate precondition, not a best-effort side
   * effect: if the FEC can't be generated (e.g. the company is missing
   * its SIREN/RCI — see FecExportService.resolveExportContext), close()
   * fails with that exact error and the year stays open. A company
   * whose own mandatory audit file can't be produced shouldn't be able
   * to lock its books either — closing without the ability to archive
   * would silently recreate the exact gap this feature exists to close.
   */
  async close(company: CompanyContext, id: string): Promise<FiscalYear> {
    const fiscalYear = await this.findOne(company, id);
    if (fiscalYear.closedAt) {
      throw new ConflictException(`Fiscal year "${fiscalYear.label}" is already closed.`);
    }

    const draftCount = await this.prisma.ecriture.count({
      where: { companyId: company.companyId, fiscalYearId: id, validatedAt: null },
    });
    if (draftCount > 0) {
      throw new ConflictException(
        `Cannot close fiscal year "${fiscalYear.label}": ${draftCount} écriture(s) are still ` +
          'unvalidated (draft). Validate or delete them first.',
      );
    }

    // Generated OUTSIDE the transaction below — this is a pure read over
    // already-validated, immutable écritures (nothing can add a new one
    // to this year mid-close, since every posting path shares the same
    // assertFiscalYearOpen() check), so there's no correctness reason to
    // hold a transaction open for it. Not yet closed at this point, so
    // generate()'s own backfill-archival branch (gated on closedAt being
    // already set) does not fire here — only the transaction below ever
    // writes this year's archive row.
    const { fileName, content } = await this.fecExportService.generate(company, id);
    const sha256Hash = createHash('sha256').update(content, 'utf8').digest('hex');

    return this.prisma.$transaction(async (tx) => {
      // Re-check under the transaction — guards the rare race where a
      // draft was created/validated between the check above and here.
      const stillDraftCount = await tx.ecriture.count({
        where: { companyId: company.companyId, fiscalYearId: id, validatedAt: null },
      });
      if (stillDraftCount > 0) {
        throw new ConflictException(
          `Cannot close fiscal year "${fiscalYear.label}": ${stillDraftCount} écriture(s) are ` +
            'still unvalidated (draft). Validate or delete them first.',
        );
      }

      await tx.archivedExport.upsert({
        where: {
          companyId_fiscalYearId_kind: {
            companyId: company.companyId,
            fiscalYearId: id,
            kind: 'FEC',
          },
        },
        create: {
          companyId: company.companyId,
          fiscalYearId: id,
          kind: 'FEC',
          fileName,
          sha256Hash,
        },
        update: {},
      });

      return tx.fiscalYear.update({
        where: { id: fiscalYear.id },
        data: { closedAt: new Date() },
      });
    });
  }
}
