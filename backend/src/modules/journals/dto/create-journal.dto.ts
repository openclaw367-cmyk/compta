import { IsEnum, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JournalType } from '@prisma/client';

export class CreateJournalDto {
  @ApiProperty({ description: 'JournalCode.', example: 'AC' })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty({ description: 'JournalLib.', example: 'Journal des achats' })
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiProperty({ enum: JournalType })
  @IsEnum(JournalType)
  type!: JournalType;
}
