import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * `label` is always required (this endpoint started as rename-only);
 * everything else is an optional tiers-identity field — see
 * CreateTiersDto's own doc comment and Account's schema doc comment.
 * CompteNum, class, and hierarchy stay immutable regardless — there's
 * no way to change those through this DTO.
 */
export class UpdateAccountDto {
  @ApiProperty({ description: 'CompteLib.', example: 'Fournisseur Dupont SARL' })
  @IsString()
  @MinLength(1)
  label!: string;

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
