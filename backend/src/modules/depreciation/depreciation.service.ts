import {
  BadRequestException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { DepreciationEntry, FixedAsset } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { computeLinearSchedule } from './depreciation-schedule';

@Injectable()
export class DepreciationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(company: CompanyContext, dto: CreateFixedAssetDto): Promise<FixedAsset> {
    await this.assertAccountsBelongToCompany(company, [
      dto.accountId,
      dto.depreciationAccountId,
      dto.expenseAccountId,
    ]);

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

  findAll(company: CompanyContext): Promise<FixedAsset[]> {
    return this.prisma.fixedAsset.findMany({
      where: { companyId: company.companyId },
      orderBy: { acquisitionDate: 'asc' },
    });
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

  /**
   * Computes and persists the straight-line depreciation schedule.
   * Declining-balance assets are rejected explicitly — see
   * depreciation-schedule.ts and CLAUDE.md.
   */
  async generateSchedule(
    company: CompanyContext,
    fixedAssetId: string,
  ): Promise<DepreciationEntry[]> {
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

    return this.prisma.$transaction(
      schedule.map((line) =>
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

  private async assertAccountsBelongToCompany(
    company: CompanyContext,
    accountIds: string[],
  ): Promise<void> {
    const uniqueIds = [...new Set(accountIds)];
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: uniqueIds }, companyId: company.companyId },
    });
    if (accounts.length !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more account references do not belong to this company.',
      );
    }
  }
}
