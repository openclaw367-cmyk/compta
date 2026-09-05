import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { EcritureDocumentsService } from './ecriture-documents.service';

const UPLOAD_BODY_SCHEMA = {
  schema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' } },
    required: ['file'],
  },
};

/**
 * Attach/view/replace/remove a justificatif on one écriture — see
 * CLAUDE.md "Supporting-document attachments". Deliberately allowed
 * regardless of the entry's validated/draft status or fiscal-year state
 * (see EcritureDocumentsService's own doc comment for why) — every
 * mutating route here is logged, never blocked.
 */
@ApiTags('documents')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description: 'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('entries/:ecritureId/documents')
export class EcritureDocumentsController {
  constructor(private readonly documents: EcritureDocumentsService) {}

  @ApiOperation({ summary: "List an écriture's attached documents." })
  @ApiParam({ name: 'ecritureId' })
  @Get()
  list(@CurrentCompany() company: CompanyContext, @Param('ecritureId') ecritureId: string) {
    return this.documents.list(company, ecritureId);
  }

  @ApiOperation({
    summary: "This écriture's document attach/replace/remove history.",
    description:
      'What closes the audit gap of allowing attach/replace/remove on an already-validated ' +
      'entry — timestamp and what changed, always; no "who", since this app has no ' +
      'authentication/user-identity model to honestly attribute one.',
  })
  @ApiParam({ name: 'ecritureId' })
  @Get('audit-log')
  auditLog(@CurrentCompany() company: CompanyContext, @Param('ecritureId') ecritureId: string) {
    return this.documents.auditLog(company, ecritureId);
  }

  @ApiOperation({
    summary: 'Stream one document, inline (for the viewer, never a download prompt).',
  })
  @ApiParam({ name: 'ecritureId' })
  @ApiParam({ name: 'id' })
  @Get(':id/file')
  async getFile(
    @CurrentCompany() company: CompanyContext,
    @Param('ecritureId') ecritureId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { document, buffer } = await this.documents.getFile(company, ecritureId, id);
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(document.fileName)}"`,
    );
    res.send(buffer);
  }

  @ApiOperation({
    summary: 'Attach a document (PDF/JPEG/PNG) to an écriture — allowed on any entry, any status.',
  })
  @ApiParam({ name: 'ecritureId' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY_SCHEMA)
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  attach(
    @CurrentCompany() company: CompanyContext,
    @Param('ecritureId') ecritureId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    return this.documents.attach(company, ecritureId, file);
  }

  @ApiOperation({ summary: 'Replace an attached document with a new file. Logged as REPLACED.' })
  @ApiParam({ name: 'ecritureId' })
  @ApiParam({ name: 'id' })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY_SCHEMA)
  @Put(':id')
  @UseInterceptors(FileInterceptor('file'))
  replace(
    @CurrentCompany() company: CompanyContext,
    @Param('ecritureId') ecritureId: string,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Aucun fichier reçu.');
    }
    return this.documents.replace(company, ecritureId, id, file);
  }

  @ApiOperation({ summary: 'Remove an attached document. Logged as REMOVED.' })
  @ApiParam({ name: 'ecritureId' })
  @ApiParam({ name: 'id' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentCompany() company: CompanyContext,
    @Param('ecritureId') ecritureId: string,
    @Param('id') id: string,
  ) {
    return this.documents.remove(company, ecritureId, id);
  }
}
