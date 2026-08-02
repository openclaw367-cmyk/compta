import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ComputeVatDeclarationDto {
  @ApiProperty({ example: '2026-01-01', description: 'Inclusive start of the declaration period.' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ example: '2026-01-31', description: 'Inclusive end of the declaration period.' })
  @IsDateString()
  periodEnd!: string;
}
