import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { LiasseService } from './liasse.service';
import { ComputeLiasseDto } from './dto/compute-liasse.dto';
import { LineTraceQueryDto } from './dto/line-trace-query.dto';
import { Tableau2054TraceQueryDto } from './dto/tableau-2054-trace-query.dto';
import { Tableau2055TraceQueryDto } from './dto/tableau-2055-trace-query.dto';
import { Tableau2056TraceQueryDto } from './dto/tableau-2056-trace-query.dto';

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

  @ApiOperation({
    summary:
      'Trace a 2054 (immobilisations) row/column back to its contributing FixedAssets — Tier 2, see CLAUDE.md "Traceability drill-down".',
    description:
      'Same GET/auto-fetched discipline as the Tier-1 traces above. REEL_NORMAL only — 2054 has no ' +
      'régime réel simplifié equivalent. "Fin" is never traceable (always derived); "début" is ' +
      'traceable to its contributing assets but not further to their own écritures — see ' +
      "tableau-2054-trace.ts's own doc comment for why.",
  })
  @Get('tableau-2054-trace')
  traceTableau2054(
    @CurrentCompany() company: CompanyContext,
    @Query() dto: Tableau2054TraceQueryDto,
  ) {
    return this.liasseService.traceTableau2054(company, dto);
  }

  @ApiOperation({
    summary:
      'Trace a 2055 (amortissements) category/column back to its contributing DepreciationEntry rows — Tier 2.',
    description:
      'Unlike 2054\'s own "début", every 2055 column (including "début") is traceable to real ' +
      'écritures — DepreciationEntry.fiscalYearId is a real, stored field, so each contribution ' +
      'carries its own correct fiscal year, never guessed. REEL_NORMAL only.',
  })
  @Get('tableau-2055-trace')
  traceTableau2055(
    @CurrentCompany() company: CompanyContext,
    @Query() dto: Tableau2055TraceQueryDto,
  ) {
    return this.liasseService.traceTableau2055(company, dto);
  }

  @ApiOperation({
    summary:
      'Trace a 2056 (provisions) category/column back to its contributing accounts — Tier 2, closest in shape to the Tier-1 bilan/CDR traces.',
    description:
      'REEL_NORMAL only. Every column (début included) is dated within the reported fiscal year by ' +
      "construction (à-nouveau posts opening balances at exactly that year's startDate) — no " +
      'per-item fiscal year resolution needed, unlike 2055.',
  })
  @Get('tableau-2056-trace')
  traceTableau2056(
    @CurrentCompany() company: CompanyContext,
    @Query() dto: Tableau2056TraceQueryDto,
  ) {
    return this.liasseService.traceTableau2056(company, dto);
  }
}
