import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Account, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { resolvePcgClass } from '../../common/pcg/resolve-pcg-class';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateTiersDto } from './dto/create-tiers.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

/**
 * Collectifs that accept a tiers (compte auxiliaire) breakdown — 401
 * fournisseurs, 411 clients, and (as of the dashboard's comptes courants
 * d'associés tile, 2026-08-24) 455 associés. Matches the frontend's
 * identically-named check (frontend/src/lib/accounts.ts); duplicated
 * rather than shared because only types cross the frontend/backend
 * boundary in this project, not runtime code — see CLAUDE.md. Widening
 * this only affects NEW auxiliary sub-accounts created going forward —
 * historical écritures posted to the flat 455000 collectif before this
 * change stay unattributed to any specific associé unless re-tagged by
 * hand; nothing here retroactively reclassifies existing data.
 */
export function isAuxiliaryBearingCollectif(number: string): boolean {
  return number.startsWith('401') || number.startsWith('411') || number.startsWith('455');
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(company: CompanyContext, dto: CreateAccountDto): Promise<Account> {
    const pcgClass = resolvePcgClass(dto.number);

    try {
      return await this.prisma.account.create({
        data: {
          companyId: company.companyId,
          number: dto.number,
          label: dto.label,
          pcgClass,
          isAuxiliary: dto.isAuxiliary ?? false,
          parentId: dto.parentId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR) {
          throw new ConflictException(`Account number "${dto.number}" already exists.`);
        }
      }
      throw error;
    }
  }

  findAll(company: CompanyContext): Promise<Account[]> {
    return this.prisma.account.findMany({
      where: { companyId: company.companyId },
      orderBy: { number: 'asc' },
    });
  }

  async findOne(company: CompanyContext, id: string): Promise<Account> {
    const account = await this.prisma.account.findFirst({
      where: { id, companyId: company.companyId },
    });
    if (!account) {
      throw new NotFoundException(`Account ${id} not found`);
    }
    return account;
  }

  /**
   * Creates a tiers (compte auxiliaire) under a 401/411 collectif. The
   * CompteNum is always derived from the parent, never client-supplied —
   * see CreateTiersDto — so "well-formed under its collectif" is
   * guaranteed by construction rather than validated after the fact.
   */
  async createTiers(
    company: CompanyContext,
    parentId: string,
    dto: CreateTiersDto,
  ): Promise<Account> {
    const parent = await this.requireCollectif(company, parentId);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const siblings = await tx.account.findMany({
          where: { companyId: company.companyId, parentId: parent.id },
          select: { number: true },
        });
        const number = this.nextTiersNumber(
          parent.number,
          siblings.map((s) => s.number),
        );
        return tx.account.create({
          data: {
            companyId: company.companyId,
            number,
            label: dto.label,
            pcgClass: parent.pcgClass,
            isAuxiliary: true,
            parentId: parent.id,
            addressLine: dto.addressLine,
            postalCode: dto.postalCode,
            city: dto.city,
            countryCode: dto.countryCode,
            sirenOrRci: dto.sirenOrRci,
            vatNumber: dto.vatNumber,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR
      ) {
        throw new ConflictException(
          'Two tiers were created under this collectif at the same time — try again.',
        );
      }
      throw error;
    }
  }

  /** Tiers (comptes auxiliaires) under one collectif, for the CompAux picker. */
  async listTiers(company: CompanyContext, parentId: string): Promise<Account[]> {
    await this.requireCollectif(company, parentId);
    return this.prisma.account.findMany({
      where: { companyId: company.companyId, parentId, isAuxiliary: true },
      orderBy: { number: 'asc' },
    });
  }

  /**
   * Label plus the optional tiers-identity fields — see UpdateAccountDto.
   * As of the Plan Comptable module (2026-09-06), `number` is also
   * editable: when supplied and different from the account's current
   * number, `pcgClass` is recomputed via `resolvePcgClass()` (never
   * client-supplied directly, same discipline as `create()`) and
   * uniqueness is enforced the same way. `isAuxiliary`/`parentId` stay
   * immutable through this endpoint regardless — reparenting/converting
   * an account's own kind is out of scope; only its number/class/label/
   * identity fields can change. Renumbering a COLLECTIF that still has
   * tiers underneath it is refused (naming the count) rather than
   * silently leaving those children's numbers looking inconsistent with
   * their new parent number — they'd keep working (the FK is by id, not
   * number) but the numbering would no longer read as a coherent series.
   */
  async rename(company: CompanyContext, id: string, dto: UpdateAccountDto): Promise<Account> {
    const account = await this.findOne(company, id);

    const data: Prisma.AccountUpdateInput = {
      label: dto.label,
      addressLine: dto.addressLine,
      postalCode: dto.postalCode,
      city: dto.city,
      countryCode: dto.countryCode,
      sirenOrRci: dto.sirenOrRci,
      vatNumber: dto.vatNumber,
    };

    if (dto.number !== undefined && dto.number !== account.number) {
      const childCount = await this.prisma.account.count({ where: { parentId: account.id } });
      if (childCount > 0) {
        throw new ConflictException(
          `Impossible de renuméroter le compte "${account.number}" — ${childCount} tiers ` +
            "dépendent de ce compte collectif. Renumérotez-les d'abord si nécessaire.",
        );
      }
      data.number = dto.number;
      data.pcgClass = resolvePcgClass(dto.number);
    }

    try {
      return await this.prisma.account.update({ where: { id: account.id }, data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR
      ) {
        throw new ConflictException(`Account number "${dto.number}" already exists.`);
      }
      throw error;
    }
  }

  /**
   * Hard delete — only allowed when nothing references this account
   * anywhere: no tiers underneath it, no écriture ligne (main or
   * auxiliary), no fixed asset (as the asset/depreciation/expense
   * account), no linked bank account, no invoice (as client or a
   * revenue line), and no recurring-entry template line (those store
   * the account NUMBER as a plain string, not an id FK — see
   * RecurringEntryTemplateLine — so this check is separate from the
   * FK-backed ones above). Closes the "no delete/deactivate on Account"
   * gap documented in CLAUDE.md "Known scope boundaries" — deliberately
   * conservative: every reference must be gone first, never a cascade.
   */
  async remove(company: CompanyContext, id: string): Promise<void> {
    const account = await this.findOne(company, id);

    const [
      childCount,
      lignesAsMain,
      lignesAsAux,
      fixedAssetCount,
      bankAccountCount,
      invoiceAsClientCount,
      invoiceLineAsRevenueCount,
      recurringLineCount,
    ] = await Promise.all([
      this.prisma.account.count({ where: { parentId: id } }),
      this.prisma.ecritureLigne.count({ where: { compteId: id } }),
      this.prisma.ecritureLigne.count({ where: { compteAuxId: id } }),
      this.prisma.fixedAsset.count({
        where: {
          OR: [{ accountId: id }, { depreciationAccountId: id }, { expenseAccountId: id }],
        },
      }),
      this.prisma.bankAccount.count({ where: { compteId: id } }),
      this.prisma.invoice.count({ where: { clientAccountId: id } }),
      this.prisma.invoiceLine.count({ where: { revenueAccountId: id } }),
      this.prisma.recurringEntryTemplateLine.count({
        where: {
          template: { companyId: company.companyId },
          OR: [{ accountNumber: account.number }, { auxAccountNumber: account.number }],
        },
      }),
    ]);

    const blockers: string[] = [];
    if (childCount > 0) blockers.push(`${childCount} tiers sous ce compte`);
    if (lignesAsMain > 0) blockers.push(`${lignesAsMain} ligne(s) d'écriture`);
    if (lignesAsAux > 0) blockers.push(`${lignesAsAux} ligne(s) d'écriture (compte auxiliaire)`);
    if (fixedAssetCount > 0) blockers.push(`${fixedAssetCount} immobilisation(s)`);
    if (bankAccountCount > 0) blockers.push('un compte bancaire lié');
    if (invoiceAsClientCount > 0) blockers.push(`${invoiceAsClientCount} facture(s) client`);
    if (invoiceLineAsRevenueCount > 0)
      blockers.push(`${invoiceLineAsRevenueCount} ligne(s) de facture`);
    if (recurringLineCount > 0) blockers.push(`${recurringLineCount} ligne(s) de modèle récurrent`);

    if (blockers.length > 0) {
      throw new ConflictException(
        `Impossible de supprimer le compte "${account.number}" — il est référencé par : ` +
          `${blockers.join(', ')}.`,
      );
    }

    await this.prisma.account.delete({ where: { id } });
  }

  private async requireCollectif(company: CompanyContext, parentId: string): Promise<Account> {
    const parent = await this.prisma.account.findFirst({
      where: { id: parentId, companyId: company.companyId },
    });
    if (!parent) {
      throw new NotFoundException(`Account ${parentId} not found`);
    }
    if (parent.isAuxiliary) {
      throw new BadRequestException('Cannot create a tiers under another tiers account.');
    }
    if (!isAuxiliaryBearingCollectif(parent.number)) {
      throw new BadRequestException(
        `Account "${parent.number}" is not a collectif that accepts a tiers (only 401 and 411 do).`,
      );
    }
    return parent;
  }

  /**
   * Next sequential suffix under a collectif's 3-digit root ("401" ->
   * "401001", "401002", ...), derived from existing siblings rather than
   * an atomic counter — tiers creation isn't a hot concurrent path the
   * way écriture validation is, so a transaction plus a unique-constraint
   * catch (see createTiers) is enough. Fixed-width zero-padded suffixes
   * keep lexical and numeric ordering identical, so there's no
   * lexical-sort trap the way an unpadded String field would have.
   */
  private nextTiersNumber(parentNumber: string, existingSiblingNumbers: string[]): string {
    const root = parentNumber.slice(0, 3);
    const suffixLength = parentNumber.length - 3;
    const usedSuffixes = existingSiblingNumbers
      .filter((n) => n.startsWith(root))
      .map((n) => Number(n.slice(3)))
      .filter((n) => Number.isInteger(n));
    const next = usedSuffixes.length === 0 ? 1 : Math.max(...usedSuffixes) + 1;
    return root + String(next).padStart(suffixLength, '0');
  }
}
