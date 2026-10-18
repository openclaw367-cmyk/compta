import { ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Exactly one of these two must be supplied — enforced in
 * EntriesService.validateBatch(), not here: this is a business rule
 * ("which drafts, by what selection"), not a shape constraint, matching
 * this app's own convention of putting that class of check in the
 * service (e.g. InvoicingService's own "correctsInvoiceId is only
 * allowed for a CREDIT_NOTE").
 */
export class ValidateBatchDto {
  @ApiPropertyOptional({
    description:
      'Explicit écriture ids to validate, in the given order (that order IS the ' +
      'EcritureNum assignment order). Mutually exclusive with fiscalYearId.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ecritureIds?: string[];

  @ApiPropertyOptional({
    description:
      'Validate every draft in this fiscal year, ordered by ecritureDate then ' +
      'createdAt (earliest first — so EcritureNum assignment reproduces chronological order, ' +
      'the shape a real historical import lands in). Mutually exclusive with ecritureIds.',
  })
  @IsOptional()
  @IsString()
  fiscalYearId?: string;
}
