import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ComputeLiasseDto {
  @ApiProperty({ description: 'The fiscal year to generate the liasse for.' })
  @IsString()
  fiscalYearId!: string;
}
