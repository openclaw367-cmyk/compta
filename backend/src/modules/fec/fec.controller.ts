import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { FecExportService } from './fec-export.service';

@ApiTags('fec')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('fec')
export class FecController {
  constructor(private readonly fecExportService: FecExportService) {}

  @ApiOperation({
    summary: 'Download the FEC file for a fiscal year (Article A47 A-1 du LPF).',
    description:
      'Fails if any écriture in the fiscal year is still a draft (unvalidated), or if the ' +
      'company has no SIREN/RCI.',
  })
  @ApiQuery({ name: 'fiscalYearId', required: true })
  @ApiProduces('text/plain')
  @Get('export')
  async export(
    @CurrentCompany() company: CompanyContext,
    @Query('fiscalYearId') fiscalYearId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!fiscalYearId) {
      throw new BadRequestException('fiscalYearId query parameter is required.');
    }
    const { fileName, content } = await this.fecExportService.generate(company, fiscalYearId);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(content);
  }

  @ApiOperation({
    summary: 'Download the descriptif accompanying the FEC file (Article A47 A-1 §XI).',
    description: 'Declares the conventional values used in the FEC file (e.g. PieceRef fallback).',
  })
  @ApiQuery({ name: 'fiscalYearId', required: true })
  @ApiProduces('text/plain')
  @Get('export/description')
  async exportDescription(
    @CurrentCompany() company: CompanyContext,
    @Query('fiscalYearId') fiscalYearId: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!fiscalYearId) {
      throw new BadRequestException('fiscalYearId query parameter is required.');
    }
    const { fileName, content } = await this.fecExportService.generateDescription(
      company,
      fiscalYearId,
    );
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(content);
  }
}
