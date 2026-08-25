import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BankAccount } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { isBankAccount } from './bank-account-predicate';

/**
 * A real, named bank account linked to one 512/514/516/517-family PCG
 * account — see CLAUDE.md "Bank reconciliation". Create + list only, no
 * update/delete, matching this app's existing "no delete on reference
 * entities" pattern (Journal, VatRate, FiscalYear all have the same
 * shape).
 */
@Injectable()
export class BankAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(company: CompanyContext, dto: CreateBankAccountDto): Promise<BankAccount> {
    const compte = await this.prisma.account.findFirst({
      where: { id: dto.compteId, companyId: company.companyId },
    });
    if (!compte) {
      throw new NotFoundException(`Account ${dto.compteId} not found`);
    }
    if (!isBankAccount(compte)) {
      throw new BadRequestException(
        `Le compte ${compte.number} n'est pas un compte de trésorerie (512/514/516/517).`,
      );
    }

    const existing = await this.prisma.bankAccount.findUnique({
      where: { compteId: dto.compteId },
    });
    if (existing) {
      throw new ConflictException(
        `Un compte bancaire est déjà rattaché à ${compte.number} (${existing.label}).`,
      );
    }

    return this.prisma.bankAccount.create({
      data: {
        companyId: company.companyId,
        compteId: dto.compteId,
        label: dto.label,
        iban: dto.iban,
        currency: dto.currency ?? 'EUR',
      },
    });
  }

  findAll(company: CompanyContext): Promise<BankAccount[]> {
    return this.prisma.bankAccount.findMany({
      where: { companyId: company.companyId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
