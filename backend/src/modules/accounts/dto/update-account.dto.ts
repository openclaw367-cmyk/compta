import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Rename only — CompteNum, class, and hierarchy are immutable once created. */
export class UpdateAccountDto {
  @ApiProperty({ description: 'CompteLib.', example: 'Fournisseur Dupont SARL' })
  @IsString()
  @MinLength(1)
  label!: string;
}
