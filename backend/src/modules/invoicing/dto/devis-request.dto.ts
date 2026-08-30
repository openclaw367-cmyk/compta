import { IsDateString, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The ephemeral client-identity + date used to render a devis PDF for a
 * DRAFT invoice — see InvoicingService.generateDevis(). Deliberately the
 * SAME field shape as FinalizeInvoiceDto (a devis and the eventual
 * facture price/describe the client identically), but a SEPARATE class:
 * nothing here is ever persisted or snapshotted onto the Invoice row —
 * a DRAFT stays fully editable afterward, and finalize() still requires
 * its own, independently-submitted FinalizeInvoiceDto.
 */
export class DevisRequestDto {
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
    description: 'ISO 3166-1 alpha-2 country code — required, same as FinalizeInvoiceDto.',
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
