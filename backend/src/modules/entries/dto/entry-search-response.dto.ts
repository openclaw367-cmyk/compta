import { ApiProperty } from '@nestjs/swagger';

export class EntrySearchResultDto {
  @ApiProperty() id!: string;
  @ApiProperty() journalId!: string;
  @ApiProperty() journalCode!: string;
  @ApiProperty({ nullable: true }) ecritureNum!: string | null;
  @ApiProperty({ description: 'YYYY-MM-DD' }) ecritureDate!: string;
  @ApiProperty() libelle!: string;
  @ApiProperty({ nullable: true }) validatedAt!: string | null;
  @ApiProperty({
    description:
      "AMOUNT mode: the specific matching line's own amount. LIBELLE mode: the écriture's " +
      'total debit. Money string.',
  })
  amount!: string;
}

/** Response for GET /entries/search?q=... — see CLAUDE.md "Search — écritures by libellé/amount". */
export class EntrySearchResponseDto {
  @ApiProperty({ enum: ['LIBELLE', 'AMOUNT'] })
  mode!: 'LIBELLE' | 'AMOUNT';
  @ApiProperty() query!: string;
  @ApiProperty({ type: [EntrySearchResultDto] })
  results!: EntrySearchResultDto[];
  @ApiProperty({ description: 'Total matches before the result list was capped.' })
  totalCount!: number;
}
