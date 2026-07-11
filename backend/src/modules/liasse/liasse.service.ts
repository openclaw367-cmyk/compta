import { Injectable, NotImplementedException } from '@nestjs/common';

/**
 * Liasse fiscale (bilan, compte de résultat, and the CERFA-numbered annex
 * forms derived from the PCG chart of accounts) is not implemented yet.
 * Scaffolded as its own module because it depends on the accounts,
 * entries, and fiscal-years modules being stable first. See CLAUDE.md.
 */
@Injectable()
export class LiasseService {
  generate(): never {
    throw new NotImplementedException('Liasse fiscale generation is not implemented yet.');
  }
}
