import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LedgerTotalsDto } from './trial-balance-response.dto';

export class AccountLedgerLineDto {
  @ApiProperty()
  ecritureId!: string;

  @ApiPropertyOptional({ description: 'Null for a still-draft écriture.', example: '3' })
  ecritureNum!: string | null;

  @ApiProperty({ example: 'VE' })
  journalCode!: string;

  @ApiProperty({ example: '2026-02-10' })
  ecritureDate!: string;

  @ApiPropertyOptional()
  pieceRef?: string | null;

  @ApiProperty()
  libelle!: string;

  @ApiProperty({ description: 'Money string.' })
  debit!: string;

  @ApiProperty({ description: 'Money string.' })
  credit!: string;

  @ApiPropertyOptional()
  lettrage?: string | null;

  @ApiProperty({
    description:
      'Cumulative debit-minus-credit balance up to and including this line, as a money string.',
  })
  runningBalance!: string;
}

/** Response for GET /ledger/accounts/:accountId — one account's grand livre. */
export class AccountLedgerResponseDto {
  @ApiProperty()
  accountId!: string;

  @ApiProperty({ example: '607000' })
  accountNumber!: string;

  @ApiProperty({ example: 'Achats de marchandises' })
  accountLabel!: string;

  @ApiProperty()
  fiscalYearId!: string;

  @ApiProperty({ required: false, nullable: true })
  periodStart?: string;

  @ApiProperty({ required: false, nullable: true })
  periodEnd?: string;

  @ApiProperty({ type: [AccountLedgerLineDto] })
  lines!: AccountLedgerLineDto[];

  @ApiProperty({ type: LedgerTotalsDto })
  totals!: LedgerTotalsDto;
}
