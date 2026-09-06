import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { FecImportService } from './fec-import.service';

const UPLOAD_BODY_SCHEMA = {
  schema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' } },
    required: ['file'],
  },
};

/**
 * FEC file import (.txt pipe-delimited, .csv, or .xlsx) — bootstraps a
 * company's accounts/journals/écritures from an external FEC export.
 * Preview-then-confirm, same shape as import-excel: preview() parses and
 * plans (which accounts/journals would be created, which fiscal year
 * would be used or created) without persisting anything; confirm()
 * re-parses the resubmitted file and persists everything atomically.
 * See CLAUDE.md "FEC import".
 */
@ApiTags('fec-import')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description:
    'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('fec-import')
export class FecImportController {
  constructor(private readonly fecImportService: FecImportService) {}

  @ApiOperation({ summary: 'Parse and plan a FEC file import — no persistence.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY_SCHEMA)
  @Post('preview')
  @UseInterceptors(FileInterceptor('file'))
  async preview(
    @CurrentCompany() company: CompanyContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    return this.fecImportService.preview(company, {
      originalname: file.originalname,
      buffer: file.buffer,
    });
  }

  @ApiOperation({
    summary: 'Re-parse and persist a FEC file import (all-or-nothing) — écritures land as drafts.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY_SCHEMA)
  @Post('confirm')
  @UseInterceptors(FileInterceptor('file'))
  async confirm(
    @CurrentCompany() company: CompanyContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    return this.fecImportService.confirmImport(company, {
      originalname: file.originalname,
      buffer: file.buffer,
    });
  }
}
