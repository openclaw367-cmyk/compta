import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { LiasseService } from './liasse.service';
import { ComputeLiasseDto } from './dto/compute-liasse.dto';
import { LineTraceQueryDto } from './dto/line-trace-query.dto';

@ApiTags('liasse')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('liasse')
export class LiasseController {
  constructor(private readonly liasseService: LiasseService) {}

  @ApiOperation({
    summary: 'Generate the liasse fiscale for a fiscal year — regime-dependent shape.',
    description:
      'Branches on Company.regime. REEL_NORMAL returns the full 2050-series (bilan, compte de ' +
      'résultat, 2054/2055/2056/2057/2059 annexes) — see specs/liasse-2050-implementation-spec.md. ' +
      'REEL_SIMPLIFIE returns bilan simplifié (2033-A) and compte de résultat simplifié (2033-B, ' +
      '"résultat comptable" section only — no annexe equivalents yet, no résultat fiscal). Refuses ' +
      'for any other regime, and if any écriture in the fiscal year is still a draft.',
  })
  @Post('generate')
  generate(@CurrentCompany() company: CompanyContext, @Body() dto: ComputeLiasseDto) {
    return this.liasseService.generate(company, dto);
  }

  @ApiOperation({
    summary:
      "Generate the OTHER regime's liasse — a comparison view, independent of Company.regime.",
    description:
      'Both regimes are always computable from the same ledger; Company.regime only selects which ' +
      'one is official. A separate endpoint (not a field on /generate) so a failure computing the ' +
      "comparison regime never blocks viewing the company's own official liasse. Same draft-block " +
      'guard as /generate.',
  })
  @Post('generate-secondary')
  generateSecondary(@CurrentCompany() company: CompanyContext, @Body() dto: ComputeLiasseDto) {
    return this.liasseService.generateSecondary(company, dto);
  }

  @ApiOperation({
    summary:
      'Trace a bilan line back to its contributing accounts (Tier 1 — see CLAUDE.md "Traceability drill-down").',
    description:
      'A genuine read (GET, not POST — no side effects, cacheable, same "GET for a real read" ' +
      "discipline as /dashboard/summary), unlike /generate's own POST — auto-fetched when a report " +
      'row is expanded, not a triggered action. Reverse-classifies every account in the trial ' +
      'balance via the SAME rule tables the forward bilan computation uses, then asserts the ' +
      "detail sums to the line's own value to the centime — throws if it does not. Refuses " +
      '(naming why) for a non-drillable derived line such as DI. Regime-aware: picks 2050-series ' +
      'or 2033-series rule tables per Company.regime automatically.',
  })
  @Get('bilan-line-trace')
  traceBilanLine(@CurrentCompany() company: CompanyContext, @Query() dto: LineTraceQueryDto) {
    return this.liasseService.traceBilanLine(company, dto);
  }

  @ApiOperation({
    summary:
      'Trace a compte de résultat line back to its contributing accounts — same shape as bilan-line-trace.',
  })
  @Get('cdr-line-trace')
  traceCdrLine(@CurrentCompany() company: CompanyContext, @Query() dto: LineTraceQueryDto) {
    return this.liasseService.traceCdrLine(company, dto);
  }
}
