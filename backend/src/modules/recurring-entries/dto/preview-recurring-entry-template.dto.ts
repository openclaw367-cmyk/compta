import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PreviewRecurringEntryTemplateDto {
  @ApiProperty({
    example: '2026-09-05',
    description:
      'The date the resulting écriture would be dated — also resolves which fiscal year it lands in.',
  })
  @IsDateString()
  applicationDate!: string;
}
