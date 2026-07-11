import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Ecriture } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { CreateEcritureDto } from './dto/create-ecriture.dto';
import { CreateEcritureLigneDto } from './dto/create-ecriture-ligne.dto';

/**
 * Écritures (journal entries). Implements CLAUDE.md "Ledger integrity":
 * balance-on-write, sequential gapless numbering assigned at validation,
 * and immutability once validated (corrections via a reversing entry).
 */
@Injectable()
export class EntriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(company: CompanyContext, dto: CreateEcritureDto): Promise<Ecriture> {
    const lignesData = this.buildBalancedLignes(company, dto.lignes);
    await this.assertReferencesBelongToCompany(company, dto.journalId, dto.fiscalYearId);

    return this.prisma.ecriture.create({
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
  async update(company: CompanyContext, id: string, dto: CreateEcritureDto): Promise<Ecriture> {
    const existing = await this.findOne(company, id);
    this.assertDraft(existing);

    const lignesData = this.buildBalancedLignes(company, dto.lignes);
    await this.assertReferencesBelongToCompany(company, dto.journalId, dto.fiscalYearId);

    return this.prisma.$transaction(async (tx) => {
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
  }

  async remove(company: CompanyContext, id: string): Promise<void> {
    const existing = await this.findOne(company, id);
    this.assertDraft(existing);
    await this.prisma.ecriture.delete({ where: { id } });
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

  private buildBalancedLignes(company: CompanyContext, lignes: CreateEcritureLigneDto[]) {
    let totalDebit = Money.zero();
    let totalCredit = Money.zero();

    const data = lignes.map((ligne) => {
      const debit = Money.fromString(ligne.debit ?? '0.00');
      const credit = Money.fromString(ligne.credit ?? '0.00');

      if (!debit.isZero() && !credit.isZero()) {
        throw new BadRequestException('A line cannot have both a debit and a credit amount.');
      }
      if (debit.isZero() && credit.isZero()) {
        throw new BadRequestException('A line must have either a debit or a credit amount.');
      }

      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);

      return {
        companyId: company.companyId,
        compteId: ligne.compteId,
        compteAuxId: ligne.compteAuxId,
        debit: debit.toDecimal(),
        credit: credit.toDecimal(),
        lettrage: ligne.lettrage,
        montantDevise: ligne.montantDevise
          ? Money.fromString(ligne.montantDevise).toDecimal()
          : undefined,
        idDevise: ligne.idDevise,
      };
    });

    if (!totalDebit.equals(totalCredit)) {
      throw new BadRequestException(
        `Écriture does not balance: debit ${totalDebit.toApiString()} != credit ${totalCredit.toApiString()}.`,
      );
    }

    return data;
  }

  private async assertReferencesBelongToCompany(
    company: CompanyContext,
    journalId: string,
    fiscalYearId: string,
  ): Promise<void> {
    const [journal, fiscalYear] = await Promise.all([
      this.prisma.journal.findFirst({ where: { id: journalId, companyId: company.companyId } }),
      this.prisma.fiscalYear.findFirst({
        where: { id: fiscalYearId, companyId: company.companyId },
      }),
    ]);
    if (!journal) {
      throw new NotFoundException(`Journal ${journalId} not found`);
    }
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${fiscalYearId} not found`);
    }
  }
}
