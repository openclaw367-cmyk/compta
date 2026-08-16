import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ComputeFinancialAnalysisDto {
  @ApiProperty({
    description: 'The fiscal year to compute the retraitement analytique for.',
  })
  @IsString()
  fiscalYearId!: string;
}
