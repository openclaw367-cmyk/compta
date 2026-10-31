import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CashFlowTraceOpeningLineQueryDto {
  @ApiProperty({ description: 'The fiscal year the tableau des flux was generated for.' })
  @IsString()
  fiscalYearId!: string;

  @ApiProperty({
    description:
      'A bilan line code (e.g. "BX", "DZ") to trace against the OPENING (à-nouveau-only) account ' +
      'subset — the CLOSING side of the same code is traced via the existing /liasse/bilan-line-trace.',
  })
  @IsString()
  lineCode!: string;
}
