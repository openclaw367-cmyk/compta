import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class IgnoreStatementLineDto {
  @ApiPropertyOptional({ example: 'Virement interne déjà comptabilisé' })
  @IsOptional()
  @IsString()
  reason?: string;
}
