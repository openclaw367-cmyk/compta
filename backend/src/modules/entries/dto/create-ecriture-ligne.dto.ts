import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/decimal';

export class CreateEcritureLigneDto {
  @ApiProperty({ description: 'Compte id (PCG account).', example: 'account-607000' })
  @IsString()
  compteId!: string;

  @ApiPropertyOptional({ description: 'Compte auxiliaire id (e.g. a specific client/supplier).' })
  @IsOptional()
  @IsString()
  compteAuxId?: string;

  @ApiPropertyOptional({
    description:
      'Money string, e.g. "1234.56". Exactly one of debit/credit must be non-zero on a given line.',
    example: '1200.00',
  })
  @IsOptional()
  @IsMoneyString()
  debit?: string;

  @ApiPropertyOptional({ description: 'Money string, e.g. "1234.56".', example: '0.00' })
  @IsOptional()
  @IsMoneyString()
  credit?: string;

  @ApiPropertyOptional({ description: 'Lettrage (reconciliation) marker.' })
  @IsOptional()
  @IsString()
  lettrage?: string;

  @ApiPropertyOptional({ description: 'Foreign-currency amount, money string.' })
  @IsOptional()
  @IsMoneyString()
  montantDevise?: string;

  @ApiPropertyOptional({ description: 'Currency code for montantDevise.', example: 'USD' })
  @IsOptional()
  @IsString()
  idDevise?: string;
}
