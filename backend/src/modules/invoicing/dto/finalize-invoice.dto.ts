import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The client-identity SNAPSHOT taken at finalize() time — see
 * specs/invoicing-phase-a-implementation-spec.md decision 5.
 * `Account` (the Tiers this invoice's `clientAccountId` points at) has
 * no address/SIREN/RCI fields today, so these are caller-supplied here
 * rather than read off the account — a natural follow-up (adding those
 * fields to `Account` for a "fill once" UX) is explicitly not attempted
 * this pass.
 */
export class FinalizeInvoiceDto {
  @ApiProperty({ example: '2026-08-30' })
  @IsDateString()
  invoiceDate!: string;

  @ApiProperty({ example: 'Client Petit SARL' })
  @IsString()
  @MinLength(1)
  clientName!: string;

  @ApiProperty({ example: '12 rue de la Paix, 75002 Paris, France' })
  @IsString()
  @MinLength(1)
  clientAddress!: string;

  @ApiPropertyOptional({ description: 'SIREN (France) or RCI (Monaco).' })
  @IsOptional()
  @IsString()
  clientSirenOrRci?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clientVatNumber?: string;
}
