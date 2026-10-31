import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { FinancialAnalysisFormulaKey } from '../financial-analysis-trace';

const KEYS: FinancialAnalysisFormulaKey[] = ['margeCommerciale', 'valeurAjoutee', 'ebe'];

export class FinancialAnalysisTraceQueryDto {
  @ApiProperty({ description: 'The fiscal year the analyse financière was generated for.' })
  @IsString()
  fiscalYearId!: string;

  @ApiProperty({
    enum: KEYS,
    description:
      'Which SIG cascade solde to trace — see financial-analysis-trace.ts for the full list and the ' +
      'soldes deliberately refused instead.',
  })
  @IsIn(KEYS)
  key!: FinancialAnalysisFormulaKey;
}
