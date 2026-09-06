import { ApiProperty } from '@nestjs/swagger';

export class PlanComptableImportRowDto {
  @ApiProperty() rowNumber!: number;
  @ApiProperty() number!: string;
  @ApiProperty() label!: string;
  @ApiProperty() pcgClass!: number;
  @ApiProperty() isAuxiliary!: boolean;
  @ApiProperty({ nullable: true }) parentNumber!: string | null;
  @ApiProperty({ enum: ['CREATE', 'UPDATE'] })
  action!: 'CREATE' | 'UPDATE';
}

/** Response for POST /accounts/import/preview — writes nothing, purely informational. */
export class PlanComptableImportPreviewResponseDto {
  @ApiProperty({ type: [PlanComptableImportRowDto] })
  rows!: PlanComptableImportRowDto[];
  @ApiProperty() totalRowCount!: number;
  @ApiProperty({ description: 'True when rows[] was capped for display — confirm() is not.' })
  truncated!: boolean;
  @ApiProperty() createCount!: number;
  @ApiProperty() updateCount!: number;
  @ApiProperty({ type: [String] })
  errors!: string[];
}

/** Response for POST /accounts/import/confirm. */
export class PlanComptableImportResultDto {
  @ApiProperty() createdCount!: number;
  @ApiProperty() updatedCount!: number;
}
