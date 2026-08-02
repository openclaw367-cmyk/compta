import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { Account, DepreciationEntry, FixedAsset, JournalType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { EntriesService } from '../entries/entries.service';
import { CreateEcritureDto } from '../entries/dto/create-ecriture.dto';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { FixedAssetListItemDto } from './dto/fixed-asset-list-item.dto';
import { DepreciationEntryDto } from './dto/depreciation-entry.dto';
import { computeLinearSchedule } from './depreciation-schedule';
import {
  assertValidAccountTriplet,
  assertWithinDepreciableBase,
  computeFixedAssetSummary,
} from './fixed-asset-invariants';

@Injectable()
export class DepreciationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entriesService: EntriesService,
  ) {}

  async create(company: CompanyContext, dto: CreateFixedAssetDto): Promise<FixedAsset> {
    const accounts = await this.loadAccountTriplet(company, dto);
    assertValidAccountTriplet(accounts);

    return this.prisma.fixedAsset.create({
      data: {
        companyId: company.companyId,
        label: dto.label,
        accountId: dto.accountId,
        depreciationAccountId: dto.depreciationAccountId,
        expenseAccountId: dto.expenseAccountId,
        acquisitionDate: new Date(dto.acquisitionDate),
        serviceStartDate: new Date(dto.serviceStartDate),
        acquisitionValue: Money.fromString(dto.acquisitionValue).toDecimal(),
        residualValue: Money.fromString(dto.residualValue ?? '0.00').toDecimal(),
        usefulLifeYears: dto.usefulLifeYears,
        method: dto.method,
      },
    });
  }

  /**
   * List view: every asset plus the three figures it needs to display —
   * valeurBrute, amortissementsCumules (posted-only, see
   * computeFixedAssetSummary), and vnc. VNC is what ties to the bilan, so
   * it's computed the same way here as everywhere else this figure is
   * needed, never independently.
   */
  async findAll(company: CompanyContext): Promise<FixedAssetListItemDto[]> {
    const assets = await this.prisma.fixedAsset.findMany({
      where: { companyId: company.companyId },
      orderBy: { acquisitionDate: 'asc' },
      include: { depreciationEntries: { where: { postedEcritureId: { not: null } } } },
    });
    return assets.map((asset) => this.toListItem(asset));
  }

  /** Single-asset counterpart to findAll's enriched shape — same figures, same formula. */
  async findOneWithSummary(company: CompanyContext, id: string): Promise<FixedAssetListItemDto> {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, companyId: company.companyId },
      include: { depreciationEntries: { where: { postedEcritureId: { not: null } } } },
    });
    if (!asset) {
      throw new NotFoundException(`Fixed asset ${id} not found`);
    }
    return this.toListItem(asset);
  }

  async findOne(company: CompanyContext, id: string): Promise<FixedAsset> {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, companyId: company.companyId },
    });
    if (!asset) {
      throw new NotFoundException(`Fixed asset ${id} not found`);
    }
    return asset;
  }

  /** Read-only: fetches the already-computed schedule without regenerating it. */
  async findSchedule(company: CompanyContext, fixedAssetId: string): Promise<DepreciationEntryDto[]> {
    await this.findOne(company, fixedAssetId); // 404s + company-scopes
    const entries = await this.prisma.depreciationEntry.findMany({
      where: { fixedAssetId, companyId: company.companyId },
      include: { fiscalYear: true },
      orderBy: { fiscalYear: { startDate: 'asc' } },
    });
    return this.toScheduleDtos(entries);
  }

  /**
   * Computes and persists the straight-line depreciation schedule.
   * Declining-balance assets are rejected explicitly — see
   * depreciation-schedule.ts and CLAUDE.md. Never silently changes the
   * amount of an already-posted entry (postedEcritureId set): a posted
   * dotation is booked in the ledger and must stay in lockstep with it, so
   * a regeneration that would change it throws instead — see
   * postDotation() for what "posted" means.
   */
  async generateSchedule(
    company: CompanyContext,
    fixedAssetId: string,
  ): Promise<DepreciationEntryDto[]> {
    const asset = await this.findOne(company, fixedAssetId);
    if (asset.method !== 'LINEAR') {
      throw new NotImplementedException(
        'Declining-balance (dégressif) depreciation is not implemented yet.',
      );
    }

    const fiscalYears = await this.prisma.fiscalYear.findMany({
      where: { companyId: company.companyId },
    });
    const schedule = computeLinearSchedule(asset, fiscalYears);

    const existingEntries = await this.prisma.depreciationEntry.findMany({
      where: { fixedAssetId: asset.id },
    });
    const existingByFiscalYear = new Map(existingEntries.map((e) => [e.fiscalYearId, e]));

    for (const line of schedule) {
      const existing = existingByFiscalYear.get(line.fiscalYearId);
      if (existing?.postedEcritureId && !Money.fromDecimal(existing.amount).equals(line.amount)) {
        throw new ConflictException(
          `The dotation for fiscal year ${line.fiscalYearId} was already posted at ` +
            `${Money.fromDecimal(existing.amount).toApiString()} — regenerating the schedule would ` +
            `change it to ${line.amount.toApiString()}. A posted dotation is immutable; this means ` +
            "the asset's own data changed after posting. Investigate before regenerating.",
        );
      }
    }

    const linesToUpsert = schedule.filter(
      (line) => !existingByFiscalYear.get(line.fiscalYearId)?.postedEcritureId,
    );
    if (linesToUpsert.length > 0) {
      await this.prisma.$transaction(
        linesToUpsert.map((line) =>
          this.prisma.depreciationEntry.upsert({
            where: {
              fixedAssetId_fiscalYearId: { fixedAssetId: asset.id, fiscalYearId: line.fiscalYearId },
            },
            create: {
              companyId: company.companyId,
              fixedAssetId: asset.id,
              fiscalYearId: line.fiscalYearId,
              amount: line.amount.toDecimal(),
            },
            update: { amount: line.amount.toDecimal() },
          }),
        ),
      );
    }

    return this.findSchedule(company, asset.id);
  }

  /**
   * Posts one period's dotation (débit expense / crédit amortissements) as
   * a real écriture, going through EntriesService.create() +
   * EntriesService.validate() exactly like any manually-entered écriture —
   * same balance check, same fiscalYearOpen guard, same sequential
   * numbering. No privileged write path: this method only ever assembles
   * the DTO and calls the normal service, then records the link.
   */
  async postDotation(
    company: CompanyContext,
    depreciationEntryId: string,
  ): Promise<DepreciationEntryDto> {
    const entry = await this.prisma.depreciationEntry.findFirst({
      where: { id: depreciationEntryId, companyId: company.companyId },
      include: { fixedAsset: true, fiscalYear: true },
    });
    if (!entry) {
      throw new NotFoundException(`Depreciation entry ${depreciationEntryId} not found`);
    }
    if (entry.postedEcritureId) {
      throw new ConflictException(
        `The dotation for "${entry.fixedAsset.label}" (${entry.fiscalYear.label}) has already been ` +
          `posted (écriture ${entry.postedEcritureId}).`,
      );
    }

    const otherPosted = await this.prisma.depreciationEntry.findMany({
      where: {
        companyId: company.companyId,
        fixedAssetId: entry.fixedAssetId,
        postedEcritureId: { not: null },
      },
    });
    const alreadyPosted = otherPosted.reduce(
      (sum, e) => sum.plus(Money.fromDecimal(e.amount)),
      Money.zero(),
    );
    assertWithinDepreciableBase(entry.fixedAsset, alreadyPosted, Money.fromDecimal(entry.amount));

    const odJournal = await this.prisma.journal.findFirst({
      where: { companyId: company.companyId, type: JournalType.OPERATIONS_DIVERSES },
      orderBy: { code: 'asc' },
    });
    if (!odJournal) {
      throw new NotFoundException(
        'No opérations diverses journal (type OPERATIONS_DIVERSES) exists for this company — ' +
          'create one first.',
      );
    }

    const amount = Money.fromDecimal(entry.amount).toApiString();
    const dto: CreateEcritureDto = {
      journalId: odJournal.id,
      fiscalYearId: entry.fiscalYearId,
      ecritureDate: entry.fiscalYear.endDate.toISOString().slice(0, 10),
      libelle: `Dotation aux amortissements - ${entry.fixedAsset.label} (${entry.fiscalYear.label})`,
      lignes: [
        { compteId: entry.fixedAsset.expenseAccountId, debit: amount },
        { compteId: entry.fixedAsset.depreciationAccountId, credit: amount },
      ],
    };

    const draft = await this.entriesService.create(company, dto);
    const validated = await this.entriesService.validate(company, draft.id);

    const updated = await this.prisma.depreciationEntry.update({
      where: { id: entry.id },
      data: { postedEcritureId: validated.id },
    });

    return {
      id: updated.id,
      fiscalYearId: updated.fiscalYearId,
      fiscalYearLabel: entry.fiscalYear.label,
      amount: Money.fromDecimal(updated.amount).toApiString(),
      postedEcritureId: updated.postedEcritureId,
      postedEcritureNum: validated.ecritureNum ?? null,
    };
  }

  private toListItem(
    asset: FixedAsset & { depreciationEntries: DepreciationEntry[] },
  ): FixedAssetListItemDto {
    const { valeurBrute, amortissementsCumules, vnc } = computeFixedAssetSummary(
      asset,
      asset.depreciationEntries,
    );
    return {
      id: asset.id,
      label: asset.label,
      accountId: asset.accountId,
      depreciationAccountId: asset.depreciationAccountId,
      expenseAccountId: asset.expenseAccountId,
      acquisitionDate: asset.acquisitionDate.toISOString().slice(0, 10),
      serviceStartDate: asset.serviceStartDate.toISOString().slice(0, 10),
      acquisitionValue: Money.fromDecimal(asset.acquisitionValue).toApiString(),
      residualValue: Money.fromDecimal(asset.residualValue).toApiString(),
      usefulLifeYears: asset.usefulLifeYears,
      method: asset.method,
      cessionDate: asset.cessionDate ? asset.cessionDate.toISOString().slice(0, 10) : null,
      cessionPrice: asset.cessionPrice ? Money.fromDecimal(asset.cessionPrice).toApiString() : null,
      valeurBrute: valeurBrute.toApiString(),
      amortissementsCumules: amortissementsCumules.toApiString(),
      vnc: vnc.toApiString(),
    };
  }

  /** Batches the écriture lookup for posted entries' EcritureNum rather than one query per line. */
  private async toScheduleDtos(
    entries: (DepreciationEntry & { fiscalYear: { label: string } })[],
  ): Promise<DepreciationEntryDto[]> {
    const postedIds = entries
      .map((e) => e.postedEcritureId)
      .filter((id): id is string => id !== null);
    const ecritureNumById = new Map(
      postedIds.length === 0
        ? []
        : (
            await this.prisma.ecriture.findMany({
              where: { id: { in: postedIds } },
              select: { id: true, ecritureNum: true },
            })
          ).map((e) => [e.id, e.ecritureNum]),
    );

    return entries.map((entry) => ({
      id: entry.id,
      fiscalYearId: entry.fiscalYearId,
      fiscalYearLabel: entry.fiscalYear.label,
      amount: Money.fromDecimal(entry.amount).toApiString(),
      postedEcritureId: entry.postedEcritureId,
      postedEcritureNum: entry.postedEcritureId
        ? ecritureNumById.get(entry.postedEcritureId) ?? null
        : null,
    }));
  }

  private async loadAccountTriplet(
    company: CompanyContext,
    dto: { accountId: string; depreciationAccountId: string; expenseAccountId: string },
  ): Promise<{ asset: Account; depreciation: Account; expense: Account }> {
    const uniqueIds = [...new Set([dto.accountId, dto.depreciationAccountId, dto.expenseAccountId])];
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: uniqueIds }, companyId: company.companyId },
    });
    if (accounts.length !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more account references do not belong to this company.',
      );
    }
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return {
      asset: byId.get(dto.accountId)!,
      depreciation: byId.get(dto.depreciationAccountId)!,
      expense: byId.get(dto.expenseAccountId)!,
    };
  }
}
