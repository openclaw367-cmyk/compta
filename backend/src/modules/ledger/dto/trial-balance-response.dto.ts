import { ApiProperty } from '@nestjs/swagger';

export class TrialBalanceLineDto {
  @ApiProperty()
  accountId!: string;

  @ApiProperty({ example: '607000' })
  accountNumber!: string;

  @ApiProperty({ example: 'Achats de marchandises' })
  accountLabel!: string;

  @ApiProperty({ description: 'Money string.', example: '1000.00' })
  totalDebit!: string;

  @ApiProperty({ description: 'Money string.', example: '0.00' })
  totalCredit!: string;

  @ApiProperty({
    description: 'totalDebit - totalCredit as a money string. Positive = solde débiteur.',
    example: '1000.00',
  })
  balance!: string;
}

export class LedgerTotalsDto {
  @ApiProperty({ description: 'Money string.' })
  debit!: string;

  @ApiProperty({ description: 'Money string.' })
  credit!: string;

  @ApiProperty({ description: 'debit - credit as a money string.' })
  balance!: string;
}

/** Response for GET /ledger/trial-balance. */
export class TrialBalanceResponseDto {
  @ApiProperty()
  fiscalYearId!: string;

  @ApiProperty({ required: false, nullable: true })
  periodStart?: string;

  @ApiProperty({ required: false, nullable: true })
  periodEnd?: string;

  @ApiProperty({
    type: [TrialBalanceLineDto],
    description:
      'One line per account with at least one line in scope; untouched accounts are omitted.',
  })
  lines!: TrialBalanceLineDto[];

  @ApiProperty({ type: LedgerTotalsDto })
  totals!: LedgerTotalsDto;
}
