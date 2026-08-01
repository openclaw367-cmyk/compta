import { BadRequestException } from '@nestjs/common';

/**
 * Shared by EntriesService (create/update/reverse) and ImportExcelService —
 * a closed fiscal year rejects new or mutated écritures from every posting
 * path, not just the one that happened to remember the check. See
 * CLAUDE.md "Ledger integrity".
 */
export function assertFiscalYearOpen(fiscalYear: { label: string; closedAt: Date | null }): void {
  if (fiscalYear.closedAt) {
    throw new BadRequestException(`Fiscal year "${fiscalYear.label}" is closed.`);
  }
}
