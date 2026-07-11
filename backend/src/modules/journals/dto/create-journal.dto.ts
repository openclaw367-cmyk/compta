import { IsEnum, IsString, MinLength } from 'class-validator';
import { JournalType } from '@prisma/client';

export class CreateJournalDto {
  /** JournalCode, e.g. "AC", "VE", "BQ". */
  @IsString()
  @MinLength(1)
  code!: string;

  /** JournalLib. */
  @IsString()
  @MinLength(1)
  label!: string;

  @IsEnum(JournalType)
  type!: JournalType;
}
