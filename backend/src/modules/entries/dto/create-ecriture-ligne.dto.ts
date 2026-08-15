import { IsDateString, IsOptional, IsString } from 'class-validator';
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

  @ApiPropertyOptional({
    description:
      'VAT rate id, for lines relevant to a CA3 declaration (a TVA collectée line or its ' +
      'corresponding revenue line at the same rate). Omit for lines with no VAT relevance.',
  })
  @IsOptional()
  @IsString()
  vatRateId?: string;

  @ApiPropertyOptional({
    description:
      'Due date for a créance/dette line — feeds the 2057 (état des échéances) maturity split. ' +
      'Omit for lines with no due-date concept (charges, produits, immobilisations, trésorerie); ' +
      "omitting it on a créance/dette line falls into 2057's documented default bucket rather than " +
      'blocking the écriture.',
    example: '2027-03-31',
  })
  @IsOptional()
  @IsDateString()
  dateEcheance?: string;
}
