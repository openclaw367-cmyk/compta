import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Multipart form fields for a CSV bank-statement import — flat (not a
 * nested JSON object) because multipart form fields arrive as strings
 * either way, matching ImportStatementDto's own shape. The mapping is
 * always caller-supplied (never guessed): a bank CSV export has no
 * standardized column layout the way CAMT.053 does, so
 * CsvColumnsController's own header-sniff exists precisely so a human
 * reviews and picks these column names before either preview or
 * confirm ever parses a data row against them. See CLAUDE.md "Bank
 * reconciliation".
 */
export class CsvColumnMappingDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  bankAccountId!: string;

  @ApiProperty({ description: 'Header name of the transaction date column.' })
  @IsString()
  @MinLength(1)
  dateColumn!: string;

  @ApiProperty({ description: 'Header name of the free-text label/description column.' })
  @IsString()
  @MinLength(1)
  labelColumn!: string;

  @ApiProperty({
    required: false,
    description:
      'Header name of a single signed-amount column. Required unless debitColumn+creditColumn are both given.',
  })
  @IsOptional()
  @IsString()
  amountColumn?: string;

  @ApiProperty({ required: false, description: 'Header name of a debit-only amount column.' })
  @IsOptional()
  @IsString()
  debitColumn?: string;

  @ApiProperty({ required: false, description: 'Header name of a credit-only amount column.' })
  @IsOptional()
  @IsString()
  creditColumn?: string;

  @ApiProperty({
    required: false,
    description: "Header name of a bank-reference column, for this app's own re-import dedup.",
  })
  @IsOptional()
  @IsString()
  referenceColumn?: string;

  @ApiProperty({
    enum: ['DMY', 'MDY', 'YMD'],
    description: 'Order of day/month/year in dateColumn.',
  })
  @IsIn(['DMY', 'MDY', 'YMD'])
  dateFormat!: 'DMY' | 'MDY' | 'YMD';

  @ApiProperty({ enum: [',', '.'], description: 'Decimal separator used in the amount column(s).' })
  @IsIn([',', '.'])
  decimalSeparator!: ',' | '.';

  @ApiProperty({
    required: false,
    description: 'Field delimiter — omit to auto-detect from the header row.',
  })
  @IsOptional()
  @IsString()
  delimiter?: string;

  @ApiProperty({
    required: false,
    enum: ['true', 'false'],
    description:
      'Only meaningful with amountColumn: some banks export outflows as positive and inflows ' +
      "as negative — the reverse of this app's own signed convention. 'true' flips the sign.",
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  invertSign?: string;
}
