import { IsDateString, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The client-identity SNAPSHOT taken at finalize() time — see
 * specs/invoicing-phase-a-implementation-spec.md decision 5.
 * `Account` (the Tiers this invoice's `clientAccountId` points at) has
 * no address/SIREN/RCI fields today, so these are caller-supplied here
 * rather than read off the account — a natural follow-up (adding those
 * fields to `Account` for a "fill once" UX) is explicitly not attempted
 * this pass. Address is STRUCTURED (not a single free-text string) —
 * added when the Factur-X CII renderer needed a real buyer country code
 * (EN16931 Schematron BR-8/BR-9); see the schema's own doc comment on
 * `Invoice.clientCountrySnapshot` for why the country field is an ISO
 * code, not a display name.
 */
export class FinalizeInvoiceDto {
  @ApiProperty({ example: '2026-08-30' })
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ example: 'Client Petit SARL' })
  @IsString()
  @MinLength(1)
  clientName!: string;

  @ApiPropertyOptional({ example: '12 rue de la Paix' })
  @IsOptional()
  @IsString()
  clientAddressLine?: string;

  @ApiPropertyOptional({ example: '75002' })
  @IsOptional()
  @IsString()
  clientPostalCode?: string;

  @ApiPropertyOptional({ example: 'Paris' })
  @IsOptional()
  @IsString()
  clientCity?: string;

  @ApiProperty({
    description: 'ISO 3166-1 alpha-2 country code — required (EN16931 Schematron BR-8/BR-9).',
    example: 'FR',
  })
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'clientCountryCode must be an ISO 3166-1 alpha-2 code, e.g. "FR".',
  })
  clientCountryCode!: string;

  @ApiPropertyOptional({ description: 'SIREN (France) or RCI (Monaco).' })
  @IsOptional()
  @IsString()
  clientSirenOrRci?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientVatNumber?: string;
}
