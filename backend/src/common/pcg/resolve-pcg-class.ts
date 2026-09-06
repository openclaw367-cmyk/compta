import { BadRequestException } from '@nestjs/common';

/**
 * Leading digit of a PCG account number determines its class (1-8) —
 * see CLAUDE.md "Ledger integrity" rule 5. Extracted out of
 * AccountsService (2026-09-06) so the FEC file importer's own
 * account-creation planning validates a CompteNum the exact same way
 * manual account creation does, rather than a second, potentially
 * drifting reimplementation. AccountsService.create() now delegates
 * here — zero behavior change, verified by its existing tests passing
 * unmodified.
 */
export function resolvePcgClass(number: string): number {
  const leadingDigit = Number(number.trim().charAt(0));
  if (!Number.isInteger(leadingDigit) || leadingDigit < 1 || leadingDigit > 8) {
    throw new BadRequestException(
      `Account number "${number}" does not map to a known PCG class (1-8).`,
    );
  }
  return leadingDigit;
}
