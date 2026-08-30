import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ResultatFiscalTraceCode } from '../resultat-fiscal-trace';

const CODES: ResultatFiscalTraceCode[] = ['WJ', 'WG'];

export class ResultatFiscalTraceQueryDto {
  @ApiProperty({ description: 'The fiscal year the résultat fiscal worksheet was generated for.' })
  @IsString()
  fiscalYearId!: string;

  @ApiProperty({
    enum: CODES,
    description:
      '2058 confirmable-line code — only WJ/WG are traceable (declared worksheet lines like WD/XA ' +
      "have no ledger source at all, by this module's own design).",
  })
  @IsIn(CODES)
  code!: ResultatFiscalTraceCode;
}
