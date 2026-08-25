import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SetLettrageDto {
  /** Omit or send null to clear lettrage/dateLettrage — the undo path. */
  @ApiPropertyOptional({ example: 'A1', nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  lettrage?: string | null;
}
