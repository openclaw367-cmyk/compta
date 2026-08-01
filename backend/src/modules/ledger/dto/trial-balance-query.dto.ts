import { IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TrialBalanceQueryDto {
  @ApiProperty({ description: 'Fiscal year id.' })
  @IsString()
  fiscalYearId!: string;

  @ApiPropertyOptional({
    description: 'Inclusive start of the period (EcritureDate), defaults to the whole fiscal year.',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @ApiPropertyOptional({
    description: 'Inclusive end of the period (EcritureDate), defaults to the whole fiscal year.',
    example: '2026-06-30',
  })
  @IsOptional()
  @IsDateString()
  periodEnd?: string;
}
