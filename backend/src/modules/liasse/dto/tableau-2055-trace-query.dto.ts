import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Tableau2055TraceColumn } from '../tableau-2055-trace';

const COLUMNS: Tableau2055TraceColumn[] = ['debut', 'dotations', 'diminutions'];

export class Tableau2055TraceQueryDto {
  @ApiProperty({ description: 'The fiscal year the 2055 annexe was generated for.' })
  @IsString()
  fiscalYearId!: string;

  @ApiProperty({ description: '2055 category code, e.g. "TERRAINS", "INSTALLATIONS_TECHNIQUES".' })
  @IsString()
  categoryCode!: string;

  @ApiProperty({
    enum: COLUMNS,
    description: 'Which movement column to trace — "fin" is never traceable, it is always derived.',
  })
  @IsIn(COLUMNS)
  column!: Tableau2055TraceColumn;
}
