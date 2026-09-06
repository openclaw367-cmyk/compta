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
  @ApiProperty({
    nullable: true,
    description: 'Null for a CSV import — no balance oracle exists for that format.',
  })
  openingBalance!: string | null;
  @ApiProperty({ nullable: true }) closingBalance!: string | null;
  @ApiProperty({ type: [StatementPreviewLineDto] })
  lines!: StatementPreviewLineDto[];
}
