import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class DevCompanyRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Société Démo SARL' })
  name!: string;
}

class DevFiscalYearRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: '2026' })
  label!: string;
}

class DevJournalRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'AC' })
  code!: string;

  @ApiProperty({ example: 'Journal des achats' })
  label!: string;
}

class DevAccountRefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: '607000' })
  number!: string;

  @ApiProperty({ example: 'Achats de marchandises' })
  label!: string;
}

/** Response shape for GET /dev/ids — see DevService for the seeded-data lookup. */
export class DevIdsResponseDto {
  @ApiProperty({ type: DevCompanyRefDto })
  company!: DevCompanyRefDto;

  @ApiPropertyOptional({
    type: DevFiscalYearRefDto,
    description: 'Null if no fiscal year has been seeded/created yet.',
  })
  fiscalYear!: DevFiscalYearRefDto | null;

  @ApiProperty({ type: [DevJournalRefDto] })
  journals!: DevJournalRefDto[];

  @ApiProperty({
    type: [DevAccountRefDto],
    description:
      'The common accounts requested for quick lookup (607000, 401000, 706000, 411000, ' +
      '44566x, 44571x) — only the ones that actually exist for this company are returned.',
  })
  accounts!: DevAccountRefDto[];
}
