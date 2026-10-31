import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/decimal';

export class BudgetLineDto {
  @ApiProperty({
    description: "Account id — a real FK, see budgeting.ts's own doc comment for why.",
  })
  @IsString()
  accountId!: string;

  @ApiProperty({
    description:
      'Money string, non-negative, e.g. "1234.56" — the planned amount in the account\'s ' +
      'own natural reporting direction (planned spend for a debit-normal account, planned ' +
      "revenue for a credit-normal one). See budgeting.ts's own doc comment for the sign " +
      'convention used to compare this against the real ledger balance.',
    example: '1200.00',
  })
  @IsMoneyString()
  plannedAmount!: string;
}
