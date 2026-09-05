import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { BankAggregatorLinkService } from './bank-aggregator-link.service';
import { ConfirmLinkDto } from './dto/confirm-link.dto';

/**
 * Live bank-aggregator connectivity (Layer 1b — see CLAUDE.md "Bank
 * reconciliation — Layer 1b"). Never returns a real access token — every
 * response is a `BankAggregatorLinkSummary` (masked hint only), same
 * discipline as `CloudCredentialsController`. Nothing here auto-syncs:
 * `sync` is always an explicit, separate call — same "nothing runs
 * without an explicit human action" discipline as the rest of this app.
 */
@ApiTags('bank-aggregator')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description: 'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('bank-aggregator')
export class BankAggregatorController {
  constructor(private readonly links: BankAggregatorLinkService) {}

  @ApiOperation({
    summary: 'Start a Connect session — returns the hosted URL to send the user to.',
    description: 'No token is stored yet; that only happens once confirm is called.',
  })
  @ApiParam({ name: 'bankAccountId' })
  @Post('links/:bankAccountId/connect-session')
  createConnectSession(
    @CurrentCompany() company: CompanyContext,
    @Param('bankAccountId') bankAccountId: string,
  ) {
    return this.links.createConnectSession(company, bankAccountId);
  }

  @ApiOperation({ summary: 'Exchange a completed Connect flow for a stored, encrypted link.' })
  @ApiParam({ name: 'bankAccountId' })
  @Post('links/:bankAccountId/confirm')
  confirmLink(
    @CurrentCompany() company: CompanyContext,
    @Param('bankAccountId') bankAccountId: string,
    @Body() dto: ConfirmLinkDto,
  ) {
    return this.links.confirmLink(company, bankAccountId, dto.callbackPayload);
  }

  @ApiOperation({ summary: "This company's live bank-aggregator links (masked tokens only)." })
  @Get('links')
  list(@CurrentCompany() company: CompanyContext) {
    return this.links.list(company);
  }

  @ApiOperation({
    summary: 'Pull new transactions for this link — user-triggered, no scheduler.',
    description:
      'Lands in the same BankStatementLine rows a manual CAMT.053 import produces; the existing ' +
      'matching engine and review UI work against them unchanged.',
  })
  @ApiParam({ name: 'bankAccountId' })
  @Post('links/:bankAccountId/sync')
  syncNow(
    @CurrentCompany() company: CompanyContext,
    @Param('bankAccountId') bankAccountId: string,
  ) {
    return this.links.syncNow(company, bankAccountId);
  }

  @ApiOperation({
    summary: 'Revoke a live link.',
    description:
      "Calls the provider's own revoke endpoint before deleting the local row — never just a " +
      'local delete, since the provider would otherwise keep the connection alive.',
  })
  @ApiParam({ name: 'bankAccountId' })
  @Delete('links/:bankAccountId')
  @HttpCode(204)
  revoke(@CurrentCompany() company: CompanyContext, @Param('bankAccountId') bankAccountId: string) {
    return this.links.revoke(company, bankAccountId);
  }
}
