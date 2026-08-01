/**
 * Re-exports the backend's own request DTOs as types only (`import type`
 * is fully erased at build time — nothing from NestJS/class-validator/
 * class-transformer ever reaches the frontend bundle). This is the "safe"
 * half of type sharing: these DTOs are already string-typed for money
 * fields by design (`@IsMoneyString()`), so the TS shape matches the JSON
 * we actually send. See api/types.ts for why response shapes are instead
 * hand-authored rather than imported from Prisma's generated types.
 */
export type { CreateEcritureDto } from '../../../backend/src/modules/entries/dto/create-ecriture.dto';
export type { CreateEcritureLigneDto } from '../../../backend/src/modules/entries/dto/create-ecriture-ligne.dto';
export type { CreateTiersDto } from '../../../backend/src/modules/accounts/dto/create-tiers.dto';
export type { UpdateAccountDto } from '../../../backend/src/modules/accounts/dto/update-account.dto';
export type { CreateFiscalYearDto } from '../../../backend/src/modules/fiscal-years/dto/create-fiscal-year.dto';
export type { UpdateCompanyDto } from '../../../backend/src/modules/companies/dto/update-company.dto';
