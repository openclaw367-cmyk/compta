import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Ecriture } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { assertFiscalYearOpen } from '../../common/ledger/assert-fiscal-year-open';
import { CreateEcritureDto } from './dto/create-ecriture.dto';
import { EntryValidationService } from './entry-validation.service';

/** Response shape for create()/update() — the écriture plus any non-blocking compliance warnings. */
export type EcritureWriteResult = Ecriture & { warnings: string[] };

/**
 * Écritures (journal entries). Implements CLAUDE.md "Ledger integrity":
 * balance-on-write, sequential gapless numbering assigned at validation,
 * and immutability once validated (corrections via a reversing entry).
 * Balance/reference/VAT/orphaned-immob checks live in
 * EntryValidationService (extracted 2026-08-16) — shared verbatim with
 * the AI chatbot's propose_ecriture tool, which runs the identical
 * checks without persisting. See that file's own doc comment.
 */
@Injectable()
export class EntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: EntryValidationService,
  ) {}

  async create(company: CompanyContext, dto: CreateEcritureDto): Promise<EcritureWriteResult> {
    const lignesData = this.validation.buildBalancedLignes(company, dto.lignes);
    await this.validation.assertReferencesBelongToCompany(company, dto.journalId, dto.fiscalYearId);
    await this.validation.assertVatRatesBelongToCompany(company, dto.lignes);
    const warnings = await this.validation.computeOrphanedImmobilisationWarnings(
      company,
      dto.lignes,
    );

    const ecriture = await this.prisma.ecriture.create({
      data: {
        companyId: company.companyId,
        journalId: dto.journalId,
        fiscalYearId: dto.fiscalYearId,
        ecritureDate: new Date(dto.ecritureDate),
        pieceRef: dto.pieceRef,
        pieceDate: dto.pieceDate ? new Date(dto.pieceDate) : undefined,
        libelle: dto.libelle,
        lignes: { create: lignesData },
      },
      include: { lignes: true },
    });
    return { ...ecriture, warnings };
  }

  findAll(company: CompanyContext): Promise<Ecriture[]> {
    return this.prisma.ecriture.findMany({
      where: { companyId: company.companyId },
      include: { lignes: true },
      orderBy: [{ ecritureNum: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOne(company: CompanyContext, id: string): Promise<Ecriture> {
    const ecriture = await this.prisma.ecriture.findFirst({
      where: { id, companyId: company.companyId },
      include: { lignes: true },
    });
    if (!ecriture) {
      throw new NotFoundException(`Écriture ${id} not found`);
    }
    return ecriture;
  }

  /** Full replace of a draft écriture's header and lines. Rejects validated entries. */
  async update(
    company: CompanyContext,
    id: string,
    dto: CreateEcritureDto,
  ): Promise<EcritureWriteResult> {
    const existing = await this.findOne(company, id);
    this.assertDraft(existing);

    const lignesData = this.validation.buildBalancedLignes(company, dto.lignes);
    await this.validation.assertReferencesBelongToCompany(company, dto.journalId, dto.fiscalYearId);
    await this.validation.assertVatRatesBelongToCompany(company, dto.lignes);
    const warnings = await this.validation.computeOrphanedImmobilisationWarnings(
      company,
      dto.lignes,
    );

    const ecriture = await this.prisma.$transaction(async (tx) => {
      await tx.ecritureLigne.deleteMany({ where: { ecritureId: id } });
      return tx.ecriture.update({
        where: { id },
        data: {
          journalId: dto.journalId,
          fiscalYearId: dto.fiscalYearId,
          ecritureDate: new Date(dto.ecritureDate),
          pieceRef: dto.pieceRef,
          pieceDate: dto.pieceDate ? new Date(dto.pieceDate) : undefined,
          libelle: dto.libelle,
          lignes: { create: lignesData },
        },
        include: { lignes: true },
      });
    });
    return { ...ecriture, warnings };
  }

  /**
   * assertDraft() guards against deleting a validated écriture (that's
   * what reverse() is for). Lines are deleted before the écriture itself
   * — there's no cascade in the schema, and every draft has lines by
   * construction (minimum two, to balance), so the parent delete alone
   * would always trip the EcritureLigne_ecritureId_fkey constraint.
   */
  async remove(company: CompanyContext, id: string): Promise<void> {
    const existing = await this.findOne(company, id);
    this.assertDraft(existing);
    await this.prisma.$transaction(async (tx) => {
      await tx.ecritureLigne.deleteMany({ where: { ecritureId: id } });
      await tx.ecriture.delete({ where: { id } });
    });
  }

  /**
   * Assigns the next company-scoped sequential EcritureNum and locks the
   * entry. The number comes from Company.nextEcritureNum, incremented
   * atomically in this transaction — never from sorting existing
   * ecritureNum values, which would be lexically wrong once that column is
   * a String ("10" sorts before "2").
   */
  async validate(company: CompanyContext, id: string): Promise<Ecriture> {
    return this.prisma.$transaction(async (tx) => {
      const ecriture = await tx.ecriture.findFirst({
        where: { id, companyId: company.companyId },
      });
      if (!ecriture) {
        throw new NotFoundException(`Écriture ${id} not found`);
      }
      if (ecriture.validatedAt) {
        throw new ConflictException('Écriture is already validated.');
      }

      const companyRecord = await tx.company.update({
        where: { id: company.companyId },
        data: { nextEcritureNum: { increment: 1 } },
      });
      const assignedEcritureNum = String(companyRecord.nextEcritureNum - 1);

      return tx.ecriture.update({
        where: { id: ecriture.id },
        data: { ecritureNum: assignedEcritureNum, validatedAt: new Date() },
        include: { lignes: true },
      });
    });
  }

  /**
   * Posts a new draft écriture with debit/credit swapped on every line,
   * referencing the original (contre-passation / extourne). This is the
   * only way to "undo" a validated écriture.
   */
  async reverse(company: CompanyContext, id: string): Promise<Ecriture> {
    const original = await this.prisma.ecriture.findFirst({
      where: { id, companyId: company.companyId },
      include: { lignes: true },
    });
    if (!original) {
      throw new NotFoundException(`Écriture ${id} not found`);
    }
    if (!original.validatedAt) {
      throw new BadRequestException('Only a validated écriture can be reversed.');
    }
    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: original.fiscalYearId, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${original.fiscalYearId} not found`);
    }
    assertFiscalYearOpen(fiscalYear);

    return this.prisma.ecriture.create({
      data: {
        companyId: company.companyId,
        journalId: original.journalId,
        fiscalYearId: original.fiscalYearId,
        ecritureDate: new Date(),
        libelle: `Extourne - ${original.libelle}`,
        reversesId: original.id,
        lignes: {
          create: original.lignes.map((ligne) => ({
            companyId: company.companyId,
            compteId: ligne.compteId,
            compteAuxId: ligne.compteAuxId ?? undefined,
            debit: ligne.credit,
            credit: ligne.debit,
            idDevise: ligne.idDevise ?? undefined,
            montantDevise: ligne.montantDevise ?? undefined,
            vatRateId: ligne.vatRateId ?? undefined,
          })),
        },
      },
      include: { lignes: true },
    });
  }

  private assertDraft(ecriture: { validatedAt: Date | null }): void {
    if (ecriture.validatedAt) {
      throw new ConflictException(
        'Validated écritures are immutable. Post a reversing entry instead of editing or deleting.',
      );
    }
  }
}
