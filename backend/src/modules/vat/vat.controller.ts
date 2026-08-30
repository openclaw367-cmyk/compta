import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { VatService } from './vat.service';
import { CreateVatRateDto } from './dto/create-vat-rate.dto';
import { ComputeVatDeclarationDto } from './dto/compute-vat-declaration.dto';
import { Ca3LineTraceQueryDto } from './dto/ca3-line-trace-query.dto';

@ApiTags('vat')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('vat')
export class VatController {
  constructor(private readonly vatService: VatService) {}

  @ApiOperation({ summary: 'Create a taux de TVA (applicable over a date range).' })
  @Post('rates')
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateVatRateDto) {
    return this.vatService.create(company, dto);
  }

  @ApiOperation({ summary: "List the company's VAT rates." })
  @Get('rates')
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.vatService.findAll(company);
  }

  @ApiOperation({ summary: 'Get one VAT rate by id.' })
  @ApiParam({ name: 'id' })
  @Get('rates/:id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.vatService.findOne(company, id);
  }

  @ApiOperation({
    summary: 'Compute a CA3 (régime réel normal) declaration for a period — basic case only.',
    description:
      'See specs/vat-ca3-implementation-spec.md for scope. Refuses if any écriture dated in the ' +
      'period is still a draft. Monaco is not implemented.',
  })
  @Post('declaration')
  computeDeclaration(
    @CurrentCompany() company: CompanyContext,
    @Body() dto: ComputeVatDeclarationDto,
  ) {
    return this.vatService.computeDeclaration(company, dto);
  }

  @ApiOperation({
    summary:
      'Trace a CA3 collectée-by-rate ligne (08/09/9B/T6) back to its contributing accounts — Tier 3, see CLAUDE.md "Traceability drill-down".',
    description:
      'A genuine read (GET, auto-fetched on row expand), same discipline as the liasse trace ' +
      'endpoints. FR (CA3) only. No "→ écritures" hop this pass — see ca3-line-trace.ts\'s own doc ' +
      'comment for why a VAT period cannot cleanly reuse the fiscal-year-scoped AccountLedgerDrilldown.',
  })
  @Get('declaration/ca3-line-trace')
  traceCa3Line(@CurrentCompany() company: CompanyContext, @Query() dto: Ca3LineTraceQueryDto) {
    return this.vatService.traceCa3Line(company, dto);
  }
}
