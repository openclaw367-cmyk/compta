import { ApiProperty } from '@nestjs/swagger';

export class CabinetBatchResultItemDto {
  @ApiProperty() companyId!: string;
  @ApiProperty() companyName!: string;
  @ApiProperty() fiscalYearId!: string;
  @ApiProperty() fiscalYearLabel!: string;
  @ApiProperty({ enum: ['SUCCEEDED', 'FAILED'] })
  status!: 'SUCCEEDED' | 'FAILED';
  @ApiProperty({ required: false, description: 'The generated FEC file name, when SUCCEEDED.' })
  fileName?: string;
  @ApiProperty({ required: false, description: 'The underlying error message, when FAILED.' })
  error?: string;
}

/**
 * Response for POST /cabinet/batch/export-fec-closing — modeled directly
 * on EntriesService.validateBatch()'s own ValidateBatchResponseDto (see
 * CLAUDE.md "Multi-client / cabinet management (item 3)"): one entry per
 * (company, fiscal year) actually ATTEMPTED, never a silent partial
 * success and never an aggregate boolean that hides which ones failed.
 *
 * A company with no open fiscal year closing in the requested month is
 * simply ABSENT from `results` — it was never attempted, so it isn't a
 * failure and doesn't need an entry naming it. Each attempt reuses
 * `FecExportService.generate()` verbatim, exactly once, so a failure on
 * one company (e.g. unvalidated drafts triggering its own
 * ConflictException) never aborts or rolls back the rest — the loop
 * keeps going, the same way `validateBatch()`'s own per-id try/catch
 * does.
 */
export class CabinetBatchResponseDto {
  @ApiProperty({ type: [CabinetBatchResultItemDto] })
  results!: CabinetBatchResultItemDto[];
  @ApiProperty() succeededCount!: number;
  @ApiProperty() failedCount!: number;
}
