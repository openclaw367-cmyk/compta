import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CloudModelProvider } from '@prisma/client';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { CloudCredentialsService } from './cloud-credentials.service';
import { SetCloudCredentialDto } from './dto/set-cloud-credential.dto';

/**
 * Never returns a real API key — every response here is a
 * CloudCredentialSummary (masked hint only). See CLAUDE.md "AI chatbot
 * cloud tier" for the consent flow this backs: a credential existing here
 * is a NECESSARY but not sufficient condition for a cloud turn — the
 * explicit per-invocation action and server-side thread enforcement are
 * separate, later pieces of this same design.
 */
@ApiTags('cloud-credentials')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('ai-chat/cloud-credentials')
export class CloudCredentialsController {
  constructor(private readonly cloudCredentials: CloudCredentialsService) {}

  @ApiOperation({
    summary: "Set (or replace) this company's API key for a cloud provider.",
    description:
      'Encrypted before storage; the response is a masked hint only, never the key itself. ' +
      'Setting a new key for a provider replaces the existing one.',
  })
  @Post()
  set(@CurrentCompany() company: CompanyContext, @Body() dto: SetCloudCredentialDto) {
    return this.cloudCredentials.set(company, dto);
  }

  @ApiOperation({ summary: "List this company's configured cloud providers (masked keys only)." })
  @Get()
  list(@CurrentCompany() company: CompanyContext) {
    return this.cloudCredentials.list(company);
  }

  @ApiOperation({
    summary: "Revoke this company's stored key for a provider.",
    description: 'Deletes the row outright — there is no "disable without deleting" state.',
  })
  @ApiParam({ name: 'provider', enum: CloudModelProvider })
  @Delete(':provider')
  @HttpCode(204)
  revoke(
    @CurrentCompany() company: CompanyContext,
    @Param('provider', new ParseEnumPipe(CloudModelProvider)) provider: CloudModelProvider,
  ) {
    return this.cloudCredentials.revoke(company, provider);
  }
}
