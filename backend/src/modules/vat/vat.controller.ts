import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { VatService } from './vat.service';
import { CreateVatRateDto } from './dto/create-vat-rate.dto';
import { ComputeVatDeclarationDto } from './dto/compute-vat-declaration.dto';

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
}
