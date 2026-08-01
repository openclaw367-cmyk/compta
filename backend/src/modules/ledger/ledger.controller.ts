import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { LedgerService } from './ledger.service';
import { TrialBalanceQueryDto } from './dto/trial-balance-query.dto';
import { TrialBalanceResponseDto } from './dto/trial-balance-response.dto';
import { AccountLedgerResponseDto } from './dto/account-ledger-response.dto';

@ApiTags('ledger')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @ApiOperation({
    summary: 'Trial balance (balance générale): per-account debit/credit totals and balance.',
    description:
      'Scoped to a fiscal year, optionally further scoped to a date range. Includes draft ' +
      '(unvalidated) écritures as well as validated ones.',
  })
  @ApiQuery({ name: 'fiscalYearId', required: true })
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiResponse({ status: 200, type: TrialBalanceResponseDto })
  @Get('trial-balance')
  trialBalance(
    @CurrentCompany() company: CompanyContext,
    @Query() query: TrialBalanceQueryDto,
  ): Promise<TrialBalanceResponseDto> {
    return this.ledgerService.trialBalance(company, query);
  }

  @ApiOperation({
    summary: 'Grand livre for one account: its écriture lines with a running balance.',
    description: 'Same scoping (fiscal year, optional date range) as the trial balance.',
  })
  @ApiParam({ name: 'accountId' })
  @ApiQuery({ name: 'fiscalYearId', required: true })
  @ApiQuery({ name: 'periodStart', required: false })
  @ApiQuery({ name: 'periodEnd', required: false })
  @ApiResponse({ status: 200, type: AccountLedgerResponseDto })
  @Get('accounts/:accountId')
  accountLedger(
    @CurrentCompany() company: CompanyContext,
    @Param('accountId') accountId: string,
    @Query() query: TrialBalanceQueryDto,
  ): Promise<AccountLedgerResponseDto> {
    return this.ledgerService.accountLedger(company, accountId, query);
  }
}
