import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Creating a tiers never accepts a client-supplied CompteNum — the number
 * is derived server-side from the parent collectif so it's always
 * well-formed by construction. See AccountsService.createTiers.
 *
 * The identity fields below (address/SIREN-RCI/VAT) are all optional —
 * a tiers created via the quick inline "+ nouveau tiers" flow elsewhere
 * in this app (e.g. from the journal-entry grid's CompAux picker) still
 * only needs a label — but capturing them here once means invoicing can
 * pre-fill a client's own FinalizeInvoiceDto/DevisRequestDto fields
 * instead of asking for them again on every invoice. See Account's own
 * schema doc comment for why these field names mirror
 * InvoiceMentionsClientInput's exactly.
 */
export class CreateTiersDto {
  @ApiProperty({ description: 'CompteLib for the tiers.', example: 'Fournisseur Dupont' })
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

  @ApiPropertyOptional({
    description:
      'ISO 3166-1 alpha-2 country code, e.g. "FR" — not validated here (kept ' +
      'permissive at capture time; FinalizeInvoiceDto is what actually enforces the format).',
    example: 'FR',
  })
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
