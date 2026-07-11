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

const PRISMA_UNIQUE_CONSTRAINT_ERROR = 'P2002';

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
