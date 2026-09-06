import { ApiProperty } from '@nestjs/swagger';

export class EntrySearchResultDto {
  @ApiProperty() id!: string;
  @ApiProperty() journalId!: string;
  @ApiProperty() journalCode!: string;
  @ApiProperty({ nullable: true }) ecritureNum!: string | null;
  @ApiProperty({ description: 'YYYY-MM-DD' }) ecritureDate!: string;
  @ApiProperty() libelle!: string;
  @ApiProperty({ nullable: true }) pieceRef!: string | null;
  @ApiProperty({ nullable: true }) validatedAt!: string | null;
  @ApiProperty({
    description:
      "AMOUNT mode: the specific matching line's own amount, or the écriture's total debit if " +
      "it matched only via PieceRef. LIBELLE mode: always the écriture's total debit. Money string.",
  })
  amount!: string;
}

/**
 * Response for GET /entries/search?q=... — see CLAUDE.md "Search —
 * écritures by libellé/amount". Both modes now also match PieceRef by
 * substring, not just libellé/amount — `mode` still just names how the
 * query itself was interpreted (a number vs. free text).
 */
export class EntrySearchResponseDto {
  @ApiProperty({ enum: ['LIBELLE', 'AMOUNT'] })
  mode!: 'LIBELLE' | 'AMOUNT';
  @ApiProperty() query!: string;
  @ApiProperty({ type: [EntrySearchResultDto] })
  results!: EntrySearchResultDto[];
  @ApiProperty({ description: 'Total matches before the result list was capped.' })
  totalCount!: number;
}
