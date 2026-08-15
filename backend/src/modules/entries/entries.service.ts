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
import { assertFiscalYearOpen } from '../../common/ledger/assert-fiscal-year-open';
import { CreateEcritureDto } from './dto/create-ecriture.dto';
import { CreateEcritureLigneDto } from './dto/create-ecriture-ligne.dto';
import { isImmobilisationAccount } from './orphaned-immobilisation';

/** Response shape for create()/update() — the écriture plus any non-blocking compliance warnings. */
export type EcritureWriteResult = Ecriture & { warnings: string[] };

/**
 * Écritures (journal entries). Implements CLAUDE.md "Ledger integrity":
 * balance-on-write, sequential gapless numbering assigned at validation,
 * and immutability once validated (corrections via a reversing entry).
 */
@Injectable()
export class EntriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(company: CompanyContext, dto: CreateEcritureDto): Promise<EcritureWriteResult> {
    const lignesData = this.buildBalancedLignes(company, dto.lignes);
    await this.assertReferencesBelongToCompany(company, dto.journalId, dto.fiscalYearId);
    await this.assertVatRatesBelongToCompany(company, dto.lignes);
    const warnings = await this.computeOrphanedImmobilisationWarnings(company, dto.lignes);

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

    const lignesData = this.buildBalancedLignes(company, dto.lignes);
    await this.assertReferencesBelongToCompany(company, dto.journalId, dto.fiscalYearId);
    await this.assertVatRatesBelongToCompany(company, dto.lignes);
    const warnings = await this.computeOrphanedImmobilisationWarnings(company, dto.lignes);

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
        vatRateId: ligne.vatRateId,
        dateEcheance: ligne.dateEcheance ? new Date(ligne.dateEcheance) : undefined,
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
    assertFiscalYearOpen(fiscalYear);
  }

  /**
   * "Orphaned immobilisation" guard (see CLAUDE.md "Known scope
   * boundaries" / "Immobilisations / cession") — a debit to a class-2
   * immobilisation account with no FixedAsset behind it silently misses
   * the 2054/2055/2059-A liasse annexes and dépreciation posting, and
   * was previously only ever caught (if at all) by the liasse's own
   * tie-out at generation time, months later. Non-blocking by design:
   * there are legitimate reasons an account might not have a fiche yet
   * (e.g. registering it separately right after), so this returns a
   * warning for the caller to surface, never throws. Scoped to DEBIT
   * lines only — that's the acquisition-posting shape the known bug
   * matched; a credit to an already-tracked asset's account (disposal,
   * correction) isn't a new orphan.
   */
  private async computeOrphanedImmobilisationWarnings(
    company: CompanyContext,
    lignes: CreateEcritureLigneDto[],
  ): Promise<string[]> {
    const debitCompteIds = [
      ...new Set(
        lignes.filter((l) => !Money.fromString(l.debit ?? '0.00').isZero()).map((l) => l.compteId),
      ),
    ];
    if (debitCompteIds.length === 0) {
      return [];
    }
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: debitCompteIds }, companyId: company.companyId },
    });
    const immobilisationAccounts = accounts.filter(isImmobilisationAccount);
    if (immobilisationAccounts.length === 0) {
      return [];
    }
    const linkedAssets = await this.prisma.fixedAsset.findMany({
      where: {
        companyId: company.companyId,
        accountId: { in: immobilisationAccounts.map((a) => a.id) },
      },
      select: { accountId: true },
    });
    const linkedAccountIds = new Set(linkedAssets.map((fa) => fa.accountId));
    return immobilisationAccounts
      .filter((a) => !linkedAccountIds.has(a.id))
      .map(
        (a) =>
          `Le compte ${a.number} (« ${a.label} ») est un compte d'immobilisation débité sans ` +
          "fiche immobilisation associée — elle n'apparaîtra pas dans les tableaux 2054/2055/" +
          "2059 de la liasse ni dans le plan d'amortissement. Créez la fiche depuis l'écran " +
          "Immobilisations si ce n'est pas volontaire.",
      );
  }

  /**
   * A tagged vatRateId must belong to this company — same multi-tenant
   * scoping rule as every other reference, see CLAUDE.md. Cheap to check
   * since most lines won't carry one.
   */
  private async assertVatRatesBelongToCompany(
    company: CompanyContext,
    lignes: CreateEcritureLigneDto[],
  ): Promise<void> {
    const vatRateIds = [
      ...new Set(lignes.map((l) => l.vatRateId).filter((id): id is string => Boolean(id))),
    ];
    if (vatRateIds.length === 0) {
      return;
    }
    const rates = await this.prisma.vatRate.findMany({
      where: { id: { in: vatRateIds }, companyId: company.companyId },
    });
    if (rates.length !== vatRateIds.length) {
      throw new BadRequestException(
        'One or more VAT rate references do not belong to this company.',
      );
    }
  }
}
