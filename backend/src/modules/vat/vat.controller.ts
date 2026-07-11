import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { VatService } from './vat.service';
import { CreateVatRateDto } from './dto/create-vat-rate.dto';

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
    summary: 'Compute a CA3-style VAT declaration.',
    description: 'Not implemented yet — returns 501. See CLAUDE.md "Monaco compliance".',
  })
  @Post('declaration')
  computeDeclaration() {
    return this.vatService.computeDeclaration();
  }
}
