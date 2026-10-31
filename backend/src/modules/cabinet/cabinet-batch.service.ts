import { BadRequestException, Injectable } from '@nestjs/common';
import { CompaniesService } from '../companies/companies.service';
import { FiscalYearsService } from '../fiscal-years/fiscal-years.service';
import { FecExportService } from '../fec/fec-export.service';
import { AuthenticatedUser } from '../../common/auth/request-with-user';
import { CompanyContext } from '../../common/tenant/company-context';
import {
  CabinetBatchResponseDto,
  CabinetBatchResultItemDto,
} from './dto/cabinet-batch-response.dto';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Cabinet item 3 — batch cross-company actions (see CLAUDE.md
 * "Multi-client / cabinet management (item 3)"). The one, real batch
 * action this ships: export FEC for every company (of the CALLER's own
 * memberships) with an open fiscal year whose `endDate` falls within a
 * given calendar month — the exact example CLAUDE.md/specs/roadmap.md
 * both use for this feature.
 *
 * **Never a new privileged write/read path.** Every company is acted on
 * by calling `FecExportService.generate(context, fiscalYearId)` —
 * verbatim, unmodified, exactly once per matching (company, fiscal
 * year) pair — the SAME gated method `FecController.export()` already
 * calls for a single company. This service never reimplements any part
 * of its draft-block check, its SIREN/RCI check, or its row formatting;
 * it only resolves WHICH companies/fiscal years qualify and loops.
 *
 * **Authorization**: this spans multiple companies in one call, so it
 * cannot go through `CompanyContextMiddleware` (which resolves exactly
 * ONE company from `x-company-id`) — see `CabinetBatchController`'s own
 * doc comment and `app.module.ts`'s wiring. The caller never supplies a
 * company-id list: every company acted on comes from
 * `CompaniesService.findAllForUser(user.id)`, the exact same
 * membership-scoped read `GET /companies` and `CabinetPage.tsx` already
 * use — a company the caller doesn't belong to can never be reached
 * through this endpoint, by construction, not by a separate permission
 * check. The per-company `CompanyContext` built here ({companyId,
 * role}) is exactly the shape `CompanyContextMiddleware` would have
 * resolved for an individual, non-batched call against that same
 * company.
 */
@Injectable()
export class CabinetBatchService {
  constructor(
    private readonly companiesService: CompaniesService,
    private readonly fiscalYearsService: FiscalYearsService,
    private readonly fecExportService: FecExportService,
  ) {}

  async exportFecForClosingCompanies(
    user: AuthenticatedUser,
    month: string,
  ): Promise<CabinetBatchResponseDto> {
    const { start, end } = this.parseMonth(month);

    const memberships = await this.companiesService.findAllForUser(user.id);

    const results: CabinetBatchResultItemDto[] = [];

    for (const membership of memberships) {
      const context: CompanyContext = { companyId: membership.id, role: membership.role };
      const fiscalYears = await this.fiscalYearsService.findAll(context);
      const closingThisMonth = fiscalYears.filter(
        (fy) => fy.closedAt === null && fy.endDate >= start && fy.endDate < end,
      );

      for (const fiscalYear of closingThisMonth) {
        try {
          const { fileName } = await this.fecExportService.generate(context, fiscalYear.id);
          results.push({
            companyId: membership.id,
            companyName: membership.name,
            fiscalYearId: fiscalYear.id,
            fiscalYearLabel: fiscalYear.label,
            status: 'SUCCEEDED',
            fileName,
          });
        } catch (error) {
          results.push({
            companyId: membership.id,
            companyName: membership.name,
            fiscalYearId: fiscalYear.id,
            fiscalYearLabel: fiscalYear.label,
            status: 'FAILED',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return {
      results,
      succeededCount: results.filter((r) => r.status === 'SUCCEEDED').length,
      failedCount: results.filter((r) => r.status === 'FAILED').length,
    };
  }

  /**
   * `month` is a caller-supplied query param (e.g. "2026-10"), never
   * "the current month" hardcoded — this keeps the service testable
   * against fixed data and usable for a near-future month too (e.g.
   * preparing ahead of a month that hasn't started yet).
   */
  private parseMonth(month: string): { start: Date; end: Date } {
    if (!MONTH_PATTERN.test(month)) {
      throw new BadRequestException('month must be in YYYY-MM format, e.g. "2026-10".');
    }
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    return {
      start: new Date(Date.UTC(year, monthIndex, 1)),
      end: new Date(Date.UTC(year, monthIndex + 1, 1)),
    };
  }
}
