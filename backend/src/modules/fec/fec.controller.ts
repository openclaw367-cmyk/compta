import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { FecExportService } from './fec-export.service';

@Controller('fec')
export class FecController {
  constructor(private readonly fecExportService: FecExportService) {}

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
}
