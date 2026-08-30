import { Body, Controller, Delete, Get, Param, Post, Put, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { InvoicingService } from './invoicing.service';
import { FacturXService } from './factur-x.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { FinalizeInvoiceDto } from './dto/finalize-invoice.dto';

@ApiTags('invoicing')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('invoicing/invoices')
export class InvoicingController {
  constructor(
    private readonly invoicingService: InvoicingService,
    private readonly facturXService: FacturXService,
  ) {}

  @ApiOperation({
    summary: 'Create a DRAFT invoice (SALE or CREDIT_NOTE). No écriture posted yet.',
  })
  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateInvoiceDto) {
    return this.invoicingService.create(company, dto);
  }

  @ApiOperation({ summary: "List the company's invoices." })
  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.invoicingService.findAll(company);
  }

  @ApiOperation({ summary: 'Get one invoice by id, with lines.' })
  @ApiParam({ name: 'id' })
  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.invoicingService.findOne(company, id);
  }

  @ApiOperation({ summary: 'Full replace of a DRAFT invoice. Rejects a FINALIZED invoice.' })
  @ApiParam({ name: 'id' })
  @Put(':id')
  update(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoicingService.update(company, id, dto);
  }

  @ApiOperation({ summary: 'Delete a DRAFT invoice. Rejects a FINALIZED invoice.' })
  @ApiParam({ name: 'id' })
  @Delete(':id')
  remove(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.invoicingService.remove(company, id);
  }

  @ApiOperation({
    summary:
      'Finalize a DRAFT invoice: assigns invoiceNumber, posts the écriture, computes mentions.',
    description:
      'Throws NotImplementedException for an MC-jurisdiction company — Monaco invoicing rules are ' +
      'pending official confirmation, see specs/invoicing-plan.md §1.6. Zero side effects on that path.',
  })
  @ApiParam({ name: 'id' })
  @Post(':id/finalize')
  finalize(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: FinalizeInvoiceDto,
  ) {
    return this.invoicingService.finalize(company, id, dto);
  }

  @ApiOperation({
    summary:
      'The mandatory-mentions data for a FINALIZED invoice — a data model, not a PDF (Phase A scope).',
  })
  @ApiParam({ name: 'id' })
  @Get(':id/mentions')
  getMentions(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.invoicingService.getMentions(company, id);
  }

  @ApiOperation({
    summary: 'Download the Factur-X 1.09 / EN16931 file for a FINALIZED invoice.',
    description:
      'PDF/A-3 with the CII XML embedded, validated against the official XSD + Schematron ' +
      'EN16931 business rules both before AND after embedding (round-trip check). Throws if any ' +
      'line is VAT-exempt — only standard-rated invoices are supported this pass, see ' +
      'invoice-to-cii.ts.',
  })
  @ApiParam({ name: 'id' })
  @ApiProduces('application/pdf')
  @Get(':id/factur-x')
  async downloadFacturX(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const invoice = await this.invoicingService.findOne(company, id);
    const pdf = await this.facturXService.render(company, id);
    const filename = `factur-x-${invoice.invoiceNumber}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(pdf));
  }
}
