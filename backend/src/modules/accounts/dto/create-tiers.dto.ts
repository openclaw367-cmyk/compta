import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Creating a tiers never accepts a client-supplied CompteNum — the number
 * is derived server-side from the parent collectif so it's always
 * well-formed by construction. See AccountsService.createTiers.
 */
export class CreateTiersDto {
  @ApiProperty({ description: 'CompteLib for the tiers.', example: 'Fournisseur Dupont' })
  @IsString()
  @MinLength(1)
  label!: string;
}
