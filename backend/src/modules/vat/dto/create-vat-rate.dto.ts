import { IsDateString, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVatRateDto {
  @ApiProperty({ example: 'Taux normal' })
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiProperty({
    description: 'Percentage as a string with up to 2 decimals.',
    example: '20.00',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  ratePercent!: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  validFrom!: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  validTo?: string;
}
