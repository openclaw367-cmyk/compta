import { Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { VatRate } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CreateVatRateDto } from './dto/create-vat-rate.dto';

@Injectable()
export class VatService {
  constructor(private readonly prisma: PrismaService) {}

  create(company: CompanyContext, dto: CreateVatRateDto): Promise<VatRate> {
    return this.prisma.vatRate.create({
      data: {
        companyId: company.companyId,
        label: dto.label,
        ratePercent: dto.ratePercent,
        validFrom: new Date(dto.validFrom),
        validTo: dto.validTo ? new Date(dto.validTo) : undefined,
      },
    });
  }

  findAll(company: CompanyContext): Promise<VatRate[]> {
    return this.prisma.vatRate.findMany({
      where: { companyId: company.companyId },
      orderBy: { validFrom: 'desc' },
    });
  }

  async findOne(company: CompanyContext, id: string): Promise<VatRate> {
    const rate = await this.prisma.vatRate.findFirst({
      where: { id, companyId: company.companyId },
    });
    if (!rate) {
      throw new NotFoundException(`VAT rate ${id} not found`);
    }
    return rate;
  }

  /**
   * CA3-style VAT declaration computation (collected vs. deductible TVA,
   * per-period liability) is not implemented yet: it depends on
   * account-level TVA tagging conventions and, for Monaco, on rules that
   * must be verified independently rather than assumed identical to
   * France — see CLAUDE.md "Monaco compliance". Fails loudly rather than
   * returning a plausible-looking but unverified number.
   */
  computeDeclaration(): never {
    throw new NotImplementedException('VAT declaration computation is not implemented yet.');
  }
}
