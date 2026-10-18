import { ApiProperty } from '@nestjs/swagger';

export class ValidateBatchResultItemDto {
  @ApiProperty() ecritureId!: string;
  @ApiProperty({ enum: ['VALIDATED', 'FAILED'] })
  status!: 'VALIDATED' | 'FAILED';
  @ApiProperty({ required: false, nullable: true }) ecritureNum?: string | null;
  @ApiProperty({ required: false }) error?: string;
}

/**
 * Response for POST /entries/validate-batch — see
 * EntriesService.validateBatch()'s own doc comment for why this is
 * never all-or-nothing: each id is validated independently (reusing
 * the exact same per-entry transaction validate() already uses), so
 * one failure never aborts or rolls back the rest. `results` always
 * names every id's own outcome — never a silent partial success.
 */
export class ValidateBatchResponseDto {
  @ApiProperty({ type: [ValidateBatchResultItemDto] })
  results!: ValidateBatchResultItemDto[];
  @ApiProperty() validatedCount!: number;
  @ApiProperty() failedCount!: number;
}
