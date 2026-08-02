import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DepreciationMethod } from '@prisma/client';

/**
 * Response shape for GET /depreciation/fixed-assets — the raw FixedAsset
 * fields plus the three derived figures the list view needs. valeurBrute /
 * amortissementsCumules / vnc are always computed via
 * computeFixedAssetSummary (see fixed-asset-invariants.ts), never
 * independently, so VNC = valeurBrute - amortissementsCumules holds by
 * construction everywhere this DTO is produced.
 */
export class FixedAssetListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  accountId!: string;

  @ApiProperty()
  depreciationAccountId!: string;

  @ApiProperty()
  expenseAccountId!: string;

  @ApiProperty()
  acquisitionDate!: string;

  @ApiProperty()
  serviceStartDate!: string;

  @ApiProperty({ description: 'Money string.' })
  acquisitionValue!: string;

  @ApiProperty({ description: 'Money string.' })
  residualValue!: string;

  @ApiProperty()
  usefulLifeYears!: number;

  @ApiProperty({ enum: DepreciationMethod })
  method!: DepreciationMethod;

  @ApiPropertyOptional({ nullable: true })
  cessionDate!: string | null;

  @ApiPropertyOptional({ description: 'Money string.', nullable: true })
  cessionPrice!: string | null;

  @ApiProperty({ description: 'Money string. Equal to acquisitionValue.' })
  valeurBrute!: string;

  @ApiProperty({
    description: 'Money string. Sum of this asset\'s posted dotations only (postedEcritureId set).',
  })
  amortissementsCumules!: string;

  @ApiProperty({ description: 'Money string. valeurBrute - amortissementsCumules.' })
  vnc!: string;
}
