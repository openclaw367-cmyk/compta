import { IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * `label` is always required (this endpoint started as rename-only);
 * everything else is optional. `number` (added for the Plan Comptable
 * module, 2026-09-06) lets an existing account be renumbered/reclassified
 * — omit it to leave the number/class untouched. `isAuxiliary`/`parentId`
 * stay immutable regardless — there's no way to change those through
 * this DTO. See AccountsService.rename()'s own doc comment for the
 * renumber-blocked-when-it-has-tiers guard.
 */
export class UpdateAccountDto {
  @ApiProperty({ description: 'CompteLib.', example: 'Fournisseur Dupont SARL' })
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiPropertyOptional({
    description:
      'CompteNum. Leading digit must be a valid PCG class (1-8). Omit to leave unchanged.',
    example: '607000',
  })
  @IsOptional()
  @Matches(/^[1-8][0-9A-Za-z]*$/, {
    message: 'number must start with a PCG class digit (1-8)',
  })
  number?: string;

  @ApiPropertyOptional({ example: '12 rue de la Paix' })
  @IsOptional()
  @IsString()
  addressLine?: string;

  @ApiPropertyOptional({ example: '75002' })
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional({ example: 'Paris' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'FR' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ description: 'SIREN (France) or RCI (Monaco).' })
  @IsOptional()
  @IsString()
  sirenOrRci?: string;

  @ApiPropertyOptional({ example: 'FR98987654321' })
  @IsOptional()
  @IsString()
  vatNumber?: string;
}
