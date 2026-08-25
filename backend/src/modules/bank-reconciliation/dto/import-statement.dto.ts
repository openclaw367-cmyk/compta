import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ImportStatementDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  bankAccountId!: string;
}
