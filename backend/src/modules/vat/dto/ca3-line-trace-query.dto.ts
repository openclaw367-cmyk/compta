import { IsDateString, IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Ca3TraceColumn } from '../ca3-line-trace';

const COLUMNS: Ca3TraceColumn[] = ['baseHT', 'taxe'];

export class Ca3LineTraceQueryDto {
  @ApiProperty({ example: '2026-01-01', description: 'Inclusive start of the declaration period.' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ example: '2026-01-31', description: 'Inclusive end of the declaration period.' })
  @IsDateString()
  periodEnd!: string;

  @ApiProperty({ description: 'CA3 collectée-by-rate ligne code, e.g. "08", "9B", "09", "T6".' })
  @IsString()
  ligne!: string;

  @ApiProperty({ enum: COLUMNS, description: 'Which column to trace.' })
  @IsIn(COLUMNS)
  column!: Ca3TraceColumn;
}
