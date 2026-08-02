import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One line of an asset's plan d'amortissement — either still projected, or
 * already posted to the ledger (postedEcritureId set). Shared response
 * shape for GET .../schedule (read-only) and POST .../schedule (compute +
 * persist), so the schedule view looks identical regardless of which call
 * produced it.
 */
export class DepreciationEntryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fiscalYearId!: string;

  @ApiProperty()
  fiscalYearLabel!: string;

  @ApiProperty({ description: 'Money string.' })
  amount!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Set once this dotation has been posted.' })
  postedEcritureId!: string | null;

  @ApiPropertyOptional({ nullable: true, description: "The posted écriture's EcritureNum, for display." })
  postedEcritureNum!: string | null;
}
