import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecurrenceFrequency } from '@prisma/client';
import { RecurringEntryTemplateLineDto } from './recurring-entry-template-line.dto';

/** Also used, as-is, for a full replace on update (PUT) — same shape, no separate DTO needed. */
export class CreateRecurringEntryTemplateDto {
  @ApiProperty({ example: 'Loyer bureau' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ description: 'Journal id.' })
  @IsString()
  journalId!: string;

  @ApiProperty({ example: 'Loyer bureau — septembre' })
  @IsString()
  @MinLength(1)
  libelle!: string;

  @ApiPropertyOptional({
    enum: RecurrenceFrequency,
    description: 'Purely informational — feeds the "prochaine échéance" hint, never auto-posts.',
  })
  @IsOptional()
  @IsEnum(RecurrenceFrequency)
  frequency?: RecurrenceFrequency;

  @ApiPropertyOptional({ description: 'Day of month, 1-31.', example: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  anchorDay?: number;

  @ApiPropertyOptional({
    description:
      'For QUARTERLY: month within the quarter (1-3, calendar-quarter aligned). For YEARLY: ' +
      'calendar month (1-12). Unused for MONTHLY.',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  anchorMonth?: number;

  @ApiProperty({
    type: [RecurringEntryTemplateLineDto],
    description: 'At least two lines.',
  })
  @ValidateNested({ each: true })
  @Type(() => RecurringEntryTemplateLineDto)
  @ArrayMinSize(2, { message: 'A template needs at least two lines to balance when applied.' })
  lines!: RecurringEntryTemplateLineDto[];
}
