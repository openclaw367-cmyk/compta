import { ApiProperty } from '@nestjs/swagger';

/** Header sniff for the CSV mapping UI — see CsvStatementParserService.detectColumns(). */
export class CsvColumnsPreviewDto {
  @ApiProperty({ description: 'Delimiter auto-detected from the header row.' })
  delimiter!: string;

  @ApiProperty({ type: [String] })
  headers!: string[];

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
    description: 'Up to 5 raw data rows, for the mapping UI to show alongside each header.',
  })
  sampleRows!: string[][];
}
