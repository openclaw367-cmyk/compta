import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { CompaniesService } from '../companies/companies.service';
import { JournalsService } from '../journals/journals.service';
import { FiscalYearsService } from '../fiscal-years/fiscal-years.service';
import { DevIdsResponseDto } from './dto/dev-ids-response.dto';

/**
 * Account numbers frequently needed for manual Swagger testing. Matched by
 * prefix (`startsWith`) rather than exact equality so both the full PCG
 * number (e.g. "445660") and its shorter conventional form (e.g. "44566")
 * resolve to the same seeded account.
 */
const COMMON_ACCOUNT_PREFIXES = ['607000', '401000', '706000', '411000', '44566', '44571'];

@Injectable()
export class DevService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companiesService: CompaniesService,
    private readonly journalsService: JournalsService,
    private readonly fiscalYearsService: FiscalYearsService,
  ) {}

  async getSeededIds(company: CompanyContext): Promise<DevIdsResponseDto> {
    const [companyRecord, fiscalYears, journals, accounts] = await Promise.all([
      this.companiesService.findCurrent(company),
      this.fiscalYearsService.findAll(company),
      this.journalsService.findAll(company),
      this.prisma.account.findMany({
        where: {
          companyId: company.companyId,
          OR: COMMON_ACCOUNT_PREFIXES.map((prefix) => ({ number: { startsWith: prefix } })),
        },
        orderBy: { number: 'asc' },
      }),
    ]);

    return {
      company: { id: companyRecord.id, name: companyRecord.name },
      fiscalYear: fiscalYears[0] ? { id: fiscalYears[0].id, label: fiscalYears[0].label } : null,
      journals: journals.map((journal) => ({
        id: journal.id,
        code: journal.code,
        label: journal.label,
      })),
      accounts: accounts.map((account) => ({
        id: account.id,
        number: account.number,
        label: account.label,
      })),
    };
  }
}
