import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { Account, DepreciationEntry, FiscalYear, FixedAsset, JournalType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { EntriesService } from '../entries/entries.service';
import { CreateEcritureDto } from '../entries/dto/create-ecriture.dto';
import { CreateEcritureLigneDto } from '../entries/dto/create-ecriture-ligne.dto';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { FixedAssetListItemDto } from './dto/fixed-asset-list-item.dto';
import { DepreciationEntryDto } from './dto/depreciation-entry.dto';
import { CessionFixedAssetDto } from './dto/cession-fixed-asset.dto';
import { CessionResultDto } from './dto/cession-result.dto';
import { computeLinearSchedule } from './depreciation-schedule';
import { computeFinalPeriodDotation } from './cession-proration';
import { CESSION_ACCOUNTS, resolveCessionNature, assertValidCompteReglement } from './cession-invariants';
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

  /**
   * Disposal (cession) of a fixed asset — see CLAUDE.md "Immobilisations
   * / cession" for the full écriture design this implements and why
   * (PCG Art. 942-20 / Art. 944-46). Every posting goes through
   * EntriesService.create()/validate(), no privileged write path — the
   * final prorated dotation reuses postDotation() itself rather than
   * duplicating it.
   *
   * Order of operations:
   *  1. Guard: not already disposed, cessionDate not before serviceStartDate.
   *  2. Resolve the fiscal year covering cessionDate, and the 675x/775x
   *     accounts for this asset's nature (incorporelle/corporelle) —
   *     required to already exist, never auto-created (same discipline
   *     as a-nouveau.service.ts's 120/129 lookup).
   *  3. Guard: every fiscal year between the asset's service-start year
   *     and the disposal year has a POSTED dotation — otherwise VNC at
   *     cession would be understated by however much depreciation is
   *     missing.
   *  4. Post the disposal year's own dotation, prorated by day-count
   *     from périodeStart (max of the fiscal year's start and the
   *     asset's serviceStartDate) to cessionDate — skipped if a correct
   *     dotation already covers this period, refused if an INCORRECT
   *     (full-year) one is already posted (must be reversed first).
   *  5. With VNC now current, post the disposal écriture: débit
   *     amortissementsCumules + débit VNC (675x) = crédit valeurBrute
   *     (21x); plus, unless cessionPrice is 0 (mise au rebut), débit
   *     compte de règlement = crédit produit (775x). Zero-valued lines
   *     are omitted (EntriesService rejects a 0.00 débit/crédit line).
   *  6. Mark the FixedAsset disposed (cessionDate/cessionPrice set on
   *     the same row — never deleted; 2054/2055/2059-A all key off this).
   */
  async disposeFixedAsset(
    company: CompanyContext,
    fixedAssetId: string,
    dto: CessionFixedAssetDto,
  ): Promise<CessionResultDto> {
    const asset = await this.findOne(company, fixedAssetId);
    if (asset.cessionDate) {
      throw new ConflictException(
        `"${asset.label}" was already disposed on ${asset.cessionDate.toISOString().slice(0, 10)}.`,
      );
    }

    const cessionDate = new Date(dto.cessionDate);
    const cessionPrice = Money.fromString(dto.cessionPrice);
    if (cessionPrice.isNegative()) {
      throw new BadRequestException('cessionPrice cannot be negative.');
    }
    if (cessionDate < asset.serviceStartDate) {
      throw new BadRequestException(
        `cessionDate (${dto.cessionDate}) is before this asset's serviceStartDate ` +
          `(${asset.serviceStartDate.toISOString().slice(0, 10)}).`,
      );
    }

    const disposalFiscalYear = await this.findFiscalYearContaining(company, cessionDate);
    if (!disposalFiscalYear) {
      throw new NotFoundException(`No fiscal year covers cessionDate ${dto.cessionDate}.`);
    }

    const assetAccount = await this.prisma.account.findFirst({
      where: { id: asset.accountId, companyId: company.companyId },
    });
    if (!assetAccount) {
      throw new NotFoundException(`Account ${asset.accountId} not found`);
    }
    const nature = resolveCessionNature(assetAccount.number);
    const { vnc: vncAccountNumber, produit: produitAccountNumber } = CESSION_ACCOUNTS[nature];
    const vncAccount = await this.requireAccountByNumber(company, vncAccountNumber);
    const produitAccount = await this.requireAccountByNumber(company, produitAccountNumber);

    let compteReglement: Account;
    if (dto.compteReglementId) {
      const found = await this.prisma.account.findFirst({
        where: { id: dto.compteReglementId, companyId: company.companyId },
      });
      if (!found) {
        throw new BadRequestException('compteReglementId does not belong to this company.');
      }
      compteReglement = found;
    } else {
      compteReglement = await this.requireAccountByNumber(company, '462000');
    }
    assertValidCompteReglement(compteReglement);

    await this.assertPriorYearsPosted(company, asset, disposalFiscalYear);

    const periodStart =
      disposalFiscalYear.startDate > asset.serviceStartDate
        ? disposalFiscalYear.startDate
        : asset.serviceStartDate;

    const existingDisposalEntry = await this.prisma.depreciationEntry.findFirst({
      where: { fixedAssetId: asset.id, fiscalYearId: disposalFiscalYear.id },
    });
    if (existingDisposalEntry?.postedEcritureId) {
      throw new ConflictException(
        `The dotation for "${asset.label}" (${disposalFiscalYear.label}) is already posted at ` +
          `${Money.fromDecimal(existingDisposalEntry.amount).toApiString()} — a mid-year disposal ` +
          "needs a prorated amount instead. Reverse (contre-passer) that écriture first, then retry.",
      );
    }

    const proratedAmount = computeFinalPeriodDotation(asset, periodStart, cessionDate);
    let finalDotationEcritureNum: string | null = null;
    if (!proratedAmount.isZero()) {
      const entry = await this.prisma.depreciationEntry.upsert({
        where: {
          fixedAssetId_fiscalYearId: { fixedAssetId: asset.id, fiscalYearId: disposalFiscalYear.id },
        },
        create: {
          companyId: company.companyId,
          fixedAssetId: asset.id,
          fiscalYearId: disposalFiscalYear.id,
          amount: proratedAmount.toDecimal(),
        },
        update: { amount: proratedAmount.toDecimal() },
      });
      const posted = await this.postDotation(company, entry.id);
      finalDotationEcritureNum = posted.postedEcritureNum;
    }

    const postedEntries = await this.prisma.depreciationEntry.findMany({
      where: { fixedAssetId: asset.id, postedEcritureId: { not: null } },
    });
    const { valeurBrute, amortissementsCumules, vnc } = computeFixedAssetSummary(
      asset,
      postedEntries,
    );

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

    const lignes: CreateEcritureLigneDto[] = [];
    if (!amortissementsCumules.isZero()) {
      lignes.push({ compteId: asset.depreciationAccountId, debit: amortissementsCumules.toApiString() });
    }
    if (!vnc.isZero()) {
      lignes.push({ compteId: vncAccount.id, debit: vnc.toApiString() });
    }
    lignes.push({ compteId: asset.accountId, credit: valeurBrute.toApiString() });
    if (!cessionPrice.isZero()) {
      lignes.push({ compteId: compteReglement.id, debit: cessionPrice.toApiString() });
      lignes.push({ compteId: produitAccount.id, credit: cessionPrice.toApiString() });
    }

    const cessionEcritureDto: CreateEcritureDto = {
      journalId: odJournal.id,
      fiscalYearId: disposalFiscalYear.id,
      ecritureDate: dto.cessionDate,
      libelle: `Cession - ${asset.label} (${disposalFiscalYear.label})`,
      lignes,
    };
    const draft = await this.entriesService.create(company, cessionEcritureDto);
    const validated = await this.entriesService.validate(company, draft.id);

    await this.prisma.fixedAsset.update({
      where: { id: asset.id },
      data: { cessionDate, cessionPrice: cessionPrice.toDecimal() },
    });

    return {
      finalDotationEcritureNum,
      cessionEcritureNum: validated.ecritureNum!,
      vnc: vnc.toApiString(),
      cessionPrice: cessionPrice.toApiString(),
      plusOuMoinsValue: cessionPrice.minus(vnc).toApiString(),
    };
  }

  private async findFiscalYearContaining(
    company: CompanyContext,
    date: Date,
  ): Promise<FiscalYear | null> {
    return this.prisma.fiscalYear.findFirst({
      where: { companyId: company.companyId, startDate: { lte: date }, endDate: { gte: date } },
    });
  }

  private async requireAccountByNumber(company: CompanyContext, number: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({
      where: { companyId: company.companyId, number },
    });
    if (!account) {
      throw new NotFoundException(
        `Account "${number}" is required to post a cession écriture — create it first.`,
      );
    }
    return account;
  }

  /**
   * Every fiscal year strictly between the asset's own service-start
   * year and the disposal year must already have a posted dotation —
   * otherwise the disposal's VNC would be silently understated by
   * whatever depreciation never got posted. Compares a COUNT of
   * qualifying fiscal years against a count of posted entries within
   * that same range, rather than trying to guess which years "should"
   * exist — if the schedule was never generated/posted for a prior
   * year, this throws rather than silently treating it as zero.
   */
  private async assertPriorYearsPosted(
    company: CompanyContext,
    asset: FixedAsset,
    disposalFiscalYear: FiscalYear,
  ): Promise<void> {
    const serviceStartFiscalYear = await this.findFiscalYearContaining(
      company,
      asset.serviceStartDate,
    );
    if (!serviceStartFiscalYear) {
      throw new NotFoundException(
        `No fiscal year covers this asset's serviceStartDate ` +
          `(${asset.serviceStartDate.toISOString().slice(0, 10)}).`,
      );
    }

    const priorFiscalYears = await this.prisma.fiscalYear.findMany({
      where: {
        companyId: company.companyId,
        startDate: { gte: serviceStartFiscalYear.startDate },
        endDate: { lt: disposalFiscalYear.startDate },
      },
    });
    if (priorFiscalYears.length === 0) {
      return;
    }

    const priorEntries = await this.prisma.depreciationEntry.findMany({
      where: {
        fixedAssetId: asset.id,
        fiscalYearId: { in: priorFiscalYears.map((fy) => fy.id) },
        postedEcritureId: { not: null },
      },
    });
    if (priorEntries.length !== priorFiscalYears.length) {
      throw new ConflictException(
        `${priorEntries.length} of ${priorFiscalYears.length} fiscal year(s) before the disposal ` +
          `year (${disposalFiscalYear.label}) have a posted dotation for "${asset.label}" — post the ` +
          "missing one(s) first (see generateSchedule()/postDotation()), otherwise VNC at cession " +
          'would be understated.',
      );
    }
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
