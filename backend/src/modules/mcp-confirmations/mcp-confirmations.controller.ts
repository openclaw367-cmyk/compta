import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser } from '../../common/auth/request-with-user';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { McpConfirmationsService } from './mcp-confirmations.service';

/**
 * The web-facing half of the MCP confirmation flow — see CLAUDE.md "MCP
 * confirmation flow". An ordinary controller on the ALREADY-RUNNING app:
 * `AuthMiddleware`/`CompanyContextMiddleware`/the global `ReadOnlyGuard`
 * all apply automatically (this controller is in `companyScopedControllers`),
 * so a READ_ONLY member can view the pending stack but the two POST
 * routes are refused for them with ZERO new code here — the existing
 * guard already blocks any non-GET/HEAD request for that role.
 */
@ApiTags('mcp-confirmations')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description:
    'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('mcp-confirmations')
export class McpConfirmationsController {
  constructor(private readonly confirmations: McpConfirmationsService) {}

  @ApiOperation({
    summary:
      'Every pending MCP écriture proposal for the current (user, company) — the whole ' +
      'reviewable stack, not just one. See CLAUDE.md "MCP confirmation flow".',
  })
  @Get('pending')
  listPending(@CurrentUser() user: AuthenticatedUser, @CurrentCompany() company: CompanyContext) {
    return this.confirmations.listPending(user.id, company);
  }

  @ApiOperation({
    summary:
      'Confirm one pending proposal — posts through the ORDINARY EntriesService.create() ' +
      '(a draft, same as any other entry). Single-use: a second attempt is refused.',
  })
  @ApiParam({ name: 'id' })
  @Post(':id/confirm')
  confirm(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentCompany() company: CompanyContext,
  ) {
    return this.confirmations.confirm(id, user.id, company);
  }

  @ApiOperation({ summary: 'Reject one pending proposal — no ledger write.' })
  @ApiParam({ name: 'id' })
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentCompany() company: CompanyContext,
  ) {
    return this.confirmations.reject(id, user.id, company);
  }
}
