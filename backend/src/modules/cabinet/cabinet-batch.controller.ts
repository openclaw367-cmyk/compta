import { BadRequestException, Controller, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser } from '../../common/auth/request-with-user';
import { CabinetBatchService } from './cabinet-batch.service';
import { CabinetBatchResponseDto } from './dto/cabinet-batch-response.dto';

/**
 * Spans multiple companies in one call, so it cannot go through
 * `CompanyContextMiddleware` (which resolves exactly ONE company from
 * `x-company-id` and checks membership in just that one) — same
 * "needs AuthMiddleware (who), never CompanyContextMiddleware (spans
 * every company)" shape as `BackupController`. See `app.module.ts`'s
 * own wiring comment and CLAUDE.md "Multi-client / cabinet management
 * (item 3)". No `@ApiHeader({name:'x-company-id', ...})` here, same
 * reasoning as `BackupController` — there is no single company
 * context for this controller.
 */
@ApiTags('cabinet')
@Controller('cabinet')
export class CabinetBatchController {
  constructor(private readonly cabinetBatchService: CabinetBatchService) {}

  @ApiOperation({
    summary:
      'Export FEC for every company the caller belongs to with an open fiscal year ' +
      'closing (endDate) within the given month.',
    description:
      'Reuses the existing, unmodified FecExportService.generate() once per matching ' +
      '(company, fiscal year) — never a new or privileged export path. Companies acted on ' +
      "are resolved from the caller's OWN memberships (CompaniesService.findAllForUser) — " +
      'never a client-supplied company-id list. A company with no fiscal year closing this ' +
      "month is simply not attempted. One company's failure (e.g. unvalidated drafts) never " +
      'aborts the others — see the response shape for the per-(company, fiscal year) outcome.',
  })
  @ApiQuery({ name: 'month', required: true, example: '2026-10', description: 'YYYY-MM' })
  @Post('batch/export-fec-closing')
  exportFecForClosingCompanies(
    @CurrentUser() user: AuthenticatedUser,
    @Query('month') month: string,
  ): Promise<CabinetBatchResponseDto> {
    if (!month) {
      throw new BadRequestException('month query parameter is required (format YYYY-MM).');
    }
    return this.cabinetBatchService.exportFecForClosingCompanies(user, month);
  }
}
