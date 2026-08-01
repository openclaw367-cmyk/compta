import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportPreviewLigneDto {
  @ApiProperty({ example: '607000' })
  compteNum!: string;

  @ApiProperty({ example: 'Achats de marchandises' })
  compteLib!: string;

  @ApiProperty({ description: 'Money string.' })
  debit!: string;

  @ApiProperty({ description: 'Money string.' })
  credit!: string;
}

export class ImportPreviewEcritureDto {
  @ApiProperty({ description: "Grouping key from the sheet's EcritureRef column." })
  ecritureRef!: string;

  @ApiProperty({ example: 'AC' })
  journalCode!: string;

  @ApiProperty({ example: '2026-01-15' })
  ecritureDate!: string;

  @ApiProperty()
  libelle!: string;

  @ApiPropertyOptional()
  pieceRef?: string;

  @ApiProperty({
    description: 'Money string — total debit, which always equals total credit for a valid group.',
  })
  total!: string;

  @ApiProperty({ type: [ImportPreviewLigneDto] })
  lignes!: ImportPreviewLigneDto[];

  @ApiProperty({
    description:
      'Same journal + date + set of (account, debit, credit) as an existing écriture (validated ' +
      'or draft), or another group in this same file. Warning only — never blocks the import.',
  })
  isDuplicate!: boolean;

  @ApiPropertyOptional({ description: 'Human-readable description of what it duplicates.' })
  duplicateOf?: string;
}

export class ImportPreviewRejectedDto {
  @ApiProperty()
  ecritureRef!: string;

  @ApiProperty({ type: [String] })
  errors!: string[];
}

/** Response for POST /import-excel/preview — a pure read, writes nothing (not even an ImportBatch row). */
export class ImportPreviewResponseDto {
  @ApiProperty({
    type: [String],
    description:
      'File-level problems (missing columns, unreadable cells, no data rows) — nothing could ' +
      'even be grouped into candidate écritures.',
  })
  fileErrors!: string[];

  @ApiProperty({ type: [ImportPreviewEcritureDto] })
  toImport!: ImportPreviewEcritureDto[];

  @ApiProperty({ type: [ImportPreviewRejectedDto] })
  rejected!: ImportPreviewRejectedDto[];
}
