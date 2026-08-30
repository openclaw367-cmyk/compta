import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { ResultatFiscalService } from './resultat-fiscal.service';
import { ComputeResultatFiscalDto } from './dto/compute-resultat-fiscal.dto';
import { ResultatFiscalTraceQueryDto } from './dto/resultat-fiscal-trace-query.dto';

@ApiTags('resultat-fiscal')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('resultat-fiscal')
export class ResultatFiscalController {
  constructor(private readonly resultatFiscalService: ResultatFiscalService) {}

  @ApiOperation({
    summary:
      'Compute the détermination du résultat fiscal (2058-A/2058-B cadre III) for a fiscal year.',
    description:
      'NOT a pure ledger aggregation like every other liasse module — most réintégrations/déductions ' +
      'are tax judgment this app cannot derive, so they are supplied by the caller as declared ' +
      'adjustments. WJ (amendes, compte 6712) and WG (taxe véhicules, compte 63514) are computed as ' +
      'SUGGESTIONS only — never silently trusted; the response reports both the suggestion and ' +
      'whatever was confirmed. Asserts its own arithmetic (résultat fiscal = résultat comptable + ' +
      'réintégrations − déductions) but proves nothing about tax completeness.',
  })
  @Post('generate')
  generate(@CurrentCompany() company: CompanyContext, @Body() dto: ComputeResultatFiscalDto) {
    return this.resultatFiscalService.generate(company, dto);
  }

  @ApiOperation({
    summary:
      'Trace a 2058 WJ/WG suggestion back to its contributing accounts — Tier 3, see CLAUDE.md "Traceability drill-down".',
    description:
      'A genuine read (GET, auto-fetched on row expand). Only WJ/WG are traceable — every other ' +
      "réintégration/déduction is user-declared, with no ledger source at all by this module's own " +
      'design, and is never offered a drill-down affordance. Traces the SUGGESTION only, never a ' +
      'manually-confirmed override (which may have no ledger backing at all).',
  })
  @Get('trace')
  traceConfirmableLine(
    @CurrentCompany() company: CompanyContext,
    @Query() dto: ResultatFiscalTraceQueryDto,
  ) {
    return this.resultatFiscalService.traceConfirmableLine(company, dto);
  }
}
