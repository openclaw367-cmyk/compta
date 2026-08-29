import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Tableau2056TraceColumn } from '../tableau-2056-trace';

const COLUMNS: Tableau2056TraceColumn[] = ['debut', 'dotations', 'reprises'];

export class Tableau2056TraceQueryDto {
  @ApiProperty({ description: 'The fiscal year the 2056 annexe was generated for.' })
  @IsString()
  fiscalYearId!: string;

  @ApiProperty({
    description: '2056 category code, e.g. "GARANTIES_CLIENTS", "DEPREC_COMPTES_CLIENTS".',
  })
  @IsString()
  categoryCode!: string;

  @ApiProperty({
    enum: COLUMNS,
    description: 'Which movement column to trace — "fin" is never traceable, it is always derived.',
  })
  @IsIn(COLUMNS)
  column!: Tableau2056TraceColumn;
}
