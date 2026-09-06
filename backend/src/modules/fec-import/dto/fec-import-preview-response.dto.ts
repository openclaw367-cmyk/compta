import { ApiProperty } from '@nestjs/swagger';
import { JournalType } from '@prisma/client';

export class FecImportPlannedJournalDto {
  @ApiProperty() code!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: JournalType })
  inferredType!: JournalType;
  @ApiProperty({
    description:
      'False when inferredType is only the OPERATIONS_DIVERSES fallback — the code/label matched no known convention.',
  })
  typeConfident!: boolean;
}

export class FecImportPlannedAccountDto {
  @ApiProperty() number!: string;
  @ApiProperty() label!: string;
  @ApiProperty() pcgClass!: number;
  @ApiProperty() isAuxiliary!: boolean;
  @ApiProperty({ nullable: true }) parentNumber!: string | null;
}

export class FecImportFiscalYearPlanDto {
  @ApiProperty({ enum: ['REUSE_EXISTING', 'CREATE_NEW'] })
  action!: 'REUSE_EXISTING' | 'CREATE_NEW';
  @ApiProperty({ required: false })
  fiscalYearId?: string;
  @ApiProperty() label!: string;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
}

export class FecImportPreviewLigneDto {
  @ApiProperty() compteNum!: string;
  @ApiProperty() compteLib!: string;
  @ApiProperty({ nullable: true }) compAuxNum!: string | null;
  @ApiProperty() debit!: string;
  @ApiProperty() credit!: string;
}

export class FecImportPreviewEcritureDto {
  @ApiProperty() journalCode!: string;
  @ApiProperty({
    description:
      "The file's own EcritureNum — a grouping key only, never persisted as this app's own ecritureNum (always assigned at validation, per CLAUDE.md).",
  })
  sourceEcritureNum!: string;
  @ApiProperty() ecritureDate!: string;
  @ApiProperty() libelle!: string;
  @ApiProperty({ nullable: true }) pieceRef!: string | null;
  @ApiProperty() total!: string;
  @ApiProperty({ type: [FecImportPreviewLigneDto] })
  lignes!: FecImportPreviewLigneDto[];
  @ApiProperty() isDuplicate!: boolean;
  @ApiProperty({ required: false }) duplicateOf?: string;
}

export class FecImportRejectedGroupDto {
  @ApiProperty() journalCode!: string;
  @ApiProperty() sourceEcritureNum!: string;
  @ApiProperty({ type: [String] }) errors!: string[];
}

export class FecImportPreviewResponseDto {
  @ApiProperty({ type: [String] }) fileErrors!: string[];

  @ApiProperty({ nullable: true, type: FecImportFiscalYearPlanDto })
  fiscalYearPlan!: FecImportFiscalYearPlanDto | null;

  @ApiProperty({ type: [FecImportPlannedJournalDto] })
  journalsToCreate!: FecImportPlannedJournalDto[];

  @ApiProperty({ type: [FecImportPlannedAccountDto] })
  accountsToCreate!: FecImportPlannedAccountDto[];

  @ApiProperty({
    type: [FecImportPreviewEcritureDto],
    description:
      'A bounded sample (see truncated/totalEcrituresCount) — confirm() processes every écriture regardless.',
  })
  toImport!: FecImportPreviewEcritureDto[];

  @ApiProperty() totalEcrituresCount!: number;
  @ApiProperty() truncated!: boolean;

  @ApiProperty({ type: [FecImportRejectedGroupDto] })
  rejected!: FecImportRejectedGroupDto[];
}
