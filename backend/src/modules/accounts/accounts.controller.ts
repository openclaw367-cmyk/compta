import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { AccountsService } from './accounts.service';
import { PlanComptableImportService } from './plan-comptable-import.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateTiersDto } from './dto/create-tiers.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

const UPLOAD_BODY_SCHEMA = {
  schema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' } },
    required: ['file'],
  },
};

@ApiTags('accounts')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description:
    'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('accounts')
export class AccountsController {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly planComptableImportService: PlanComptableImportService,
  ) {}

  @ApiOperation({ summary: 'Create a PCG chart-of-accounts entry.' })
  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateAccountDto) {
    return this.accountsService.create(company, dto);
  }

  @ApiOperation({
    summary: 'Preview a chart-of-accounts Excel import — no persistence.',
    description:
      'Parses CompteNum/CompteLib (+ optional CompteParentNum for tiers, plus optional ' +
      'identity columns) and plans creates/updates by CompteNum. See CLAUDE.md "Plan Comptable".',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY_SCHEMA)
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file'))
  async previewImport(
    @CurrentCompany() company: CompanyContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    return this.planComptableImportService.preview(company, {
      originalname: file.originalname,
      buffer: file.buffer,
    });
  }

  @ApiOperation({
    summary: 'Re-parse and persist a chart-of-accounts Excel import (upsert by CompteNum).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(UPLOAD_BODY_SCHEMA)
  @Post('import/confirm')
  @UseInterceptors(FileInterceptor('file'))
  async confirmImportRoute(
    @CurrentCompany() company: CompanyContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier reçu.');
    return this.planComptableImportService.confirmImport(company, {
      originalname: file.originalname,
      buffer: file.buffer,
    });
  }

  @ApiOperation({ summary: "List the company's chart of accounts." })
  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.accountsService.findAll(company);
  }

  @ApiOperation({ summary: 'Get one account by id.' })
  @ApiParam({ name: 'id' })
  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.accountsService.findOne(company, id);
  }

  @ApiOperation({
    summary: 'Update an account.',
    description:
      'Label, and now (Plan Comptable module) CompteNum/class too — see UpdateAccountDto. ' +
      'isAuxiliary/parentId stay immutable through this endpoint.',
  })
  @ApiParam({ name: 'id' })
  @Patch(':id')
  rename(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accountsService.rename(company, id, dto);
  }

  @ApiOperation({
    summary: 'Delete an account.',
    description:
      'Only allowed when nothing references it (tiers, écritures, immobilisations, bank ' +
      'account, invoices, recurring templates) — refuses naming what blocks it otherwise.',
  })
  @ApiParam({ name: 'id' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.accountsService.remove(company, id);
  }

  @ApiOperation({
    summary: 'Create a tiers (compte auxiliaire) under a 401/411/455 collectif.',
    description: 'CompteNum is derived from the parent, not client-supplied.',
  })
  @ApiParam({ name: 'parentId' })
  @Post(':parentId/tiers')
  createTiers(
    @CurrentCompany() company: CompanyContext,
    @Param('parentId') parentId: string,
    @Body() dto: CreateTiersDto,
  ) {
    return this.accountsService.createTiers(company, parentId, dto);
  }

  @ApiOperation({ summary: 'List the tiers (comptes auxiliaires) under a collectif.' })
  @ApiParam({ name: 'parentId' })
  @Get(':parentId/tiers')
  listTiers(@CurrentCompany() company: CompanyContext, @Param('parentId') parentId: string) {
    return this.accountsService.listTiers(company, parentId);
  }
}
