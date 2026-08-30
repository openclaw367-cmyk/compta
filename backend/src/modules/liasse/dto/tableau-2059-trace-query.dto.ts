import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Tableau2059TraceColumn } from '../tableau-2059-trace';

const COLUMNS: Tableau2059TraceColumn[] = ['valeurOrigine', 'amortissements', 'prixDeVente'];

export class Tableau2059TraceQueryDto {
  @ApiProperty({ description: 'The fiscal year the 2059-A annexe was generated for.' })
  @IsString()
  fiscalYearId!: string;

  @ApiProperty({
    description:
      'The disposed FixedAsset id — 2059-A rows are keyed by asset, not by account (two disposed ' +
      'assets in the same year can share a gross account).',
  })
  @IsString()
  assetId!: string;

  @ApiProperty({
    enum: COLUMNS,
    description: '"valeurResiduelle" and "plusOuMoinsValue" are never traceable — always derived.',
  })
  @IsIn(COLUMNS)
  column!: Tableau2059TraceColumn;
}
