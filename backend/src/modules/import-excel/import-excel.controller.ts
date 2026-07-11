import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { ImportExcelService } from './import-excel.service';

@Controller('import-excel')
export class ImportExcelController {
  constructor(private readonly importExcelService: ImportExcelService) {}

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
