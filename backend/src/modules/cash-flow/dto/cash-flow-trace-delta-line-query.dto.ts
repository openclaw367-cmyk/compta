import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CashFlowDeltaLineKey } from '../cash-flow-trace';

const KEYS: CashFlowDeltaLineKey[] = [
  'variationCreancesClients',
  'variationStocks',
  'variationDettesExploitation',
  'variationDettesSurImmobilisations',
  'variationEmprunts',
  'variationCapital',
];

export class CashFlowTraceDeltaLineQueryDto {
  @ApiProperty({ description: 'The fiscal year the tableau des flux was generated for.' })
  @IsString()
  fiscalYearId!: string;

  @ApiProperty({
    enum: KEYS,
    description:
      'Which "clean bilan-line delta" flux line to trace — see cash-flow-trace.ts for the full list ' +
      'and the lines deliberately refused instead.',
  })
  @IsIn(KEYS)
  key!: CashFlowDeltaLineKey;
}
