import { IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/decimal';

export class CessionFixedAssetDto {
  @ApiProperty({ example: '2026-06-30' })
  @IsDateString()
  cessionDate!: string;

  @ApiProperty({
    description: 'Money string. Full sale proceeds — no TVA collectée line is posted (see CLAUDE.md).',
    example: '21000.00',
  })
  @IsMoneyString()
  cessionPrice!: string;

  @ApiPropertyOptional({
    description:
      'Compte de règlement id — a 462 (créance, reconciled later) or class-5 (immediate cash) ' +
      'account. Defaults to the company\'s 462000 account if omitted.',
  })
  @IsOptional()
  @IsString()
  compteReglementId?: string;
}
