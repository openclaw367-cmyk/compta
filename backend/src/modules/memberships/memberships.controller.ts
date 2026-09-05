import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser } from '../../common/auth/request-with-user';
import { MembershipsService } from './memberships.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

@ApiTags('memberships')
@Controller('memberships')
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @ApiOperation({ summary: 'List members and pending invites for the current company.' })
  @Get()
  list(@CurrentCompany() company: CompanyContext) {
    return this.membershipsService.list(company);
  }

  @ApiOperation({ summary: 'Invite someone to the current company by email — owner only.' })
  @Post('invite')
  invite(
    @CurrentCompany() company: CompanyContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteMemberDto,
  ) {
    return this.membershipsService.invite(company, user, dto);
  }

  @ApiOperation({ summary: 'Revoke a pending invite — owner only.' })
  @Delete('invites/:inviteId')
  revokeInvite(@CurrentCompany() company: CompanyContext, @Param('inviteId') inviteId: string) {
    return this.membershipsService.revokeInvite(company, inviteId);
  }

  @ApiOperation({
    summary: "Change a member's role — owner only. Refuses to demote the last remaining owner.",
  })
  @Patch(':membershipId')
  updateRole(
    @CurrentCompany() company: CompanyContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.membershipsService.updateRole(company, user, membershipId, dto.role);
  }

  @ApiOperation({
    summary:
      'Remove a member from the current company — owner only. Refuses to remove the ' +
      'last remaining owner.',
  })
  @Delete(':membershipId')
  remove(
    @CurrentCompany() company: CompanyContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('membershipId') membershipId: string,
  ) {
    return this.membershipsService.remove(company, user, membershipId);
  }
}
