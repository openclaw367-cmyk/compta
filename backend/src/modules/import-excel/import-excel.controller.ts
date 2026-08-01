import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { ImportExcelService } from './import-excel.service';
import { ImportPreviewResponseDto } from './dto/import-preview-response.dto';

const UPLOAD_BODY_SCHEMA = {
  type: 'object' as const,
  required: ['file', 'fiscalYearId'],
  properties: {
    file: { type: 'string', format: 'binary', description: 'The .xlsx workbook.' },
    fiscalYearId: { type: 'string', description: 'Fiscal year to import into.' },
  },
};

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
    summary: 'Preview an .xlsx import without writing anything.',
    description:
      'Same parsing/grouping/validation as the real import, plus a duplicate-of-existing-or-' +
      'in-file warning (never blocking). Writes nothing — not even an ImportBatch row. ' +
      'Confirming re-submits the same file to POST /import-excel.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: UPLOAD_BODY_SCHEMA })
  @ApiResponse({ status: 200, type: ImportPreviewResponseDto })
  @Post('preview')
  @UseInterceptors(FileInterceptor('file'))
  preview(
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
    return this.importExcelService.preview(company, fiscalYearId, file);
  }

  @ApiOperation({
    summary: 'Import a journal from an .xlsx workbook as draft écritures.',
    description:
      'Expects columns EcritureRef, JournalCode, EcritureDate, CompteNum, EcritureLib, Debit, ' +
      'Credit (optional CompAuxNum, PieceRef, PieceDate). Always persists one ImportBatch — ' +
      'COMMITTED or FAILED — even when the import is rejected. See import-excel.service.ts.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: UPLOAD_BODY_SCHEMA })
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
