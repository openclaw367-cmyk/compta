import { ApiProperty } from '@nestjs/swagger';

export class StatementPreviewLineDto {
  @ApiProperty() bookingDate!: string;
  @ApiProperty({ nullable: true }) valueDate!: string | null;
  @ApiProperty({ description: 'Signed API-string — positive = inflow, negative = outflow.' })
  amount!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ nullable: true }) bankReference!: string | null;
  @ApiProperty({
    description:
      'True if this bankReference already exists on a previously-imported line for this bank account.',
  })
  isDuplicate!: boolean;
}

export class StatementPreviewResponseDto {
  @ApiProperty({ nullable: true }) iban!: string | null;
  @ApiProperty() periodStart!: string;
  @ApiProperty() periodEnd!: string;
  @ApiProperty() openingBalance!: string;
  @ApiProperty() closingBalance!: string;
  @ApiProperty({ type: [StatementPreviewLineDto] })
  lines!: StatementPreviewLineDto[];
}
