import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/decimal';

export class RecurringEntryTemplateLineDto {
  @ApiProperty({
    description: 'PCG account NUMBER (not id) — resolved to a live Account at apply-time.',
    example: '613200',
  })
  @IsString()
  accountNumber!: string;

  @ApiPropertyOptional({
    description: "Tiers sub-account NUMBER, scoped under accountNumber's own parent.",
  })
  @IsOptional()
  @IsString()
  auxAccountNumber?: string;

  @ApiPropertyOptional({ description: 'VAT rate id.' })
  @IsOptional()
  @IsString()
  vatRateId?: string;

  @ApiPropertyOptional({
    description: 'Money string, e.g. "1234.56". Exactly one of debit/credit must be non-zero.',
    example: '1200.00',
  })
  @IsOptional()
  @IsMoneyString()
  debit?: string;

  @ApiPropertyOptional({ description: 'Money string, e.g. "1234.56".', example: '0.00' })
  @IsOptional()
  @IsMoneyString()
  credit?: string;
}
