import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/decimal';

export class CreateInvoiceLineDto {
  @ApiProperty({ example: 'Prestation de conseil — mars 2026' })
  @IsString()
  @MinLength(1)
  description!: string;

  @ApiProperty({
    description:
      'Decimal string, same shape as a money string (this app has no plain-number field).',
    example: '3.00',
  })
  @IsMoneyString()
  quantity!: string;

  @ApiProperty({ description: 'Money string, unit price excluding tax (HT).', example: '500.00' })
  @IsMoneyString()
  unitPriceHT!: string;

  @ApiProperty({ description: 'Class-7 revenue account id (707/706-family).' })
  @IsString()
  revenueAccountId!: string;

  @ApiPropertyOptional({
    description: 'VAT rate id. Omit for a VAT-exempt line — never guessed.',
  })
  @IsOptional()
  @IsString()
  vatRateId?: string;
}
