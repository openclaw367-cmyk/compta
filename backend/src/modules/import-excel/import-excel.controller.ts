import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { ImportExcelService } from './import-excel.service';

@ApiTags('import-excel')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('import-excel')
export class ImportExcelController {
  constructor(private readonly importExcelService: ImportExcelService) {}

  @ApiOperation({
    summary: 'Import a journal from an .xlsx workbook as draft écritures.',
    description:
      'Expects columns EcritureRef, JournalCode, EcritureDate, CompteNum, EcritureLib, Debit, ' +
      'Credit (optional CompAuxNum, PieceRef, PieceDate). See import-excel.service.ts.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'fiscalYearId'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'The .xlsx workbook.' },
        fiscalYearId: { type: 'string', description: 'Fiscal year to import into.' },
      },
    },
  })
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  importJournal(
    @CurrentCompany() company: CompanyContext,
    @Body('fiscalYearId') fiscalYearId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('A "file" form field with the .xlsx workbook is required.');
    }
    if (!fiscalYearId) {
      throw new BadRequestException('A "fiscalYearId" form field is required.');
    }
    return this.importExcelService.importJournal(company, fiscalYearId, file);
  }
}
