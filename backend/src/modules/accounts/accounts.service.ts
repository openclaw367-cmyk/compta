import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Account, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateTiersDto } from './dto/create-tiers.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

/**
 * Collectifs that accept a tiers (compte auxiliaire) breakdown — 401
 * fournisseurs, 411 clients. Matches the frontend's identically-named
 * check (frontend/src/components/journal/EcritureEditor.tsx); duplicated
 * rather than shared because only types cross the frontend/backend
 * boundary in this project, not runtime code — see CLAUDE.md.
 */
function isAuxiliaryBearingCollectif(number: string): boolean {
  return number.startsWith('401') || number.startsWith('411');
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(company: CompanyContext, dto: CreateAccountDto): Promise<Account> {
    const pcgClass = this.resolvePcgClass(dto.number);

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

  /** Rename only — see UpdateAccountDto. */
  async rename(company: CompanyContext, id: string, dto: UpdateAccountDto): Promise<Account> {
    const account = await this.findOne(company, id);
    return this.prisma.account.update({
      where: { id: account.id },
      data: { label: dto.label },
    });
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

  /** Leading digit of a PCG account number determines its class (1-8). */
  private resolvePcgClass(number: string): number {
    const leadingDigit = Number(number.trim().charAt(0));
    if (!Number.isInteger(leadingDigit) || leadingDigit < 1 || leadingDigit > 8) {
      throw new BadRequestException(
        `Account number "${number}" does not map to a known PCG class (1-8).`,
      );
    }
    return leadingDigit;
  }
}
