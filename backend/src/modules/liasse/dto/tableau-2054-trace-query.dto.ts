import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Tableau2054TraceColumn } from '../tableau-2054-trace';

const COLUMNS: Tableau2054TraceColumn[] = ['debut', 'acquisitions', 'cessions'];

export class Tableau2054TraceQueryDto {
  @ApiProperty({ description: 'The fiscal year the 2054 annexe was generated for.' })
  @IsString()
  fiscalYearId!: string;

  @ApiProperty({ description: '2054 row code, e.g. "TERRAINS", "AUTRES_CORP_MATERIEL_BUREAU".' })
  @IsString()
  rowCode!: string;

  @ApiProperty({
    enum: COLUMNS,
    description: 'Which movement column to trace — "fin" is never traceable, it is always derived.',
  })
  @IsIn(COLUMNS)
  column!: Tableau2054TraceColumn;
}
