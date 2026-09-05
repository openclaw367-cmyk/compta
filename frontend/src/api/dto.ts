/**
 * Re-exports the backend's own request DTOs as types only (`import type`
 * is fully erased at build time — nothing from NestJS/class-validator/
 * class-transformer ever reaches the frontend bundle). This is the "safe"
 * half of type sharing: these DTOs are already string-typed for money
 * fields by design (`@IsMoneyString()`), so the TS shape matches the JSON
 * we actually send. See api/types.ts for why response shapes are instead
 * hand-authored rather than imported from Prisma's generated types.
 */
export type { SignupDto } from '../../../backend/src/modules/auth/dto/signup.dto';
export type { LoginDto } from '../../../backend/src/modules/auth/dto/login.dto';
export type { ForgotPasswordDto } from '../../../backend/src/modules/auth/dto/forgot-password.dto';
export type { ResetPasswordDto } from '../../../backend/src/modules/auth/dto/reset-password.dto';
export type { AcceptInviteDto } from '../../../backend/src/modules/auth/dto/accept-invite.dto';
export type { InviteMemberDto } from '../../../backend/src/modules/memberships/dto/invite-member.dto';
export type { UpdateMemberRoleDto } from '../../../backend/src/modules/memberships/dto/update-member-role.dto';
export type { CreateEcritureDto } from '../../../backend/src/modules/entries/dto/create-ecriture.dto';
export type { CreateEcritureLigneDto } from '../../../backend/src/modules/entries/dto/create-ecriture-ligne.dto';
export type { CreateTiersDto } from '../../../backend/src/modules/accounts/dto/create-tiers.dto';
export type { UpdateAccountDto } from '../../../backend/src/modules/accounts/dto/update-account.dto';
export type { CreateFiscalYearDto } from '../../../backend/src/modules/fiscal-years/dto/create-fiscal-year.dto';
export type { CreateCompanyDto } from '../../../backend/src/modules/companies/dto/create-company.dto';
export type { UpdateCompanyDto } from '../../../backend/src/modules/companies/dto/update-company.dto';
export type { CreateVatRateDto } from '../../../backend/src/modules/vat/dto/create-vat-rate.dto';
export type { CreateJournalDto } from '../../../backend/src/modules/journals/dto/create-journal.dto';
export type { CreateAccountDto } from '../../../backend/src/modules/accounts/dto/create-account.dto';
export type { CreateFixedAssetDto } from '../../../backend/src/modules/depreciation/dto/create-fixed-asset.dto';
export type { CessionFixedAssetDto } from '../../../backend/src/modules/depreciation/dto/cession-fixed-asset.dto';
export type {
  ComputeResultatFiscalDto,
  DeclaredLineDto,
} from '../../../backend/src/modules/resultat-fiscal/dto/compute-resultat-fiscal.dto';
export type { SendChatMessageDto } from '../../../backend/src/modules/ai-chat/dto/send-chat-message.dto';
export type { SetCloudCredentialDto } from '../../../backend/src/modules/cloud-credentials/dto/set-cloud-credential.dto';
export type { CreateBankAccountDto } from '../../../backend/src/modules/bank-accounts/dto/create-bank-account.dto';
export type { CreateInvoiceDto } from '../../../backend/src/modules/invoicing/dto/create-invoice.dto';
export type { CreateInvoiceLineDto } from '../../../backend/src/modules/invoicing/dto/create-invoice-line.dto';
export type { FinalizeInvoiceDto } from '../../../backend/src/modules/invoicing/dto/finalize-invoice.dto';
export type { DevisRequestDto } from '../../../backend/src/modules/invoicing/dto/devis-request.dto';
export type { CreateRecurringEntryTemplateDto } from '../../../backend/src/modules/recurring-entries/dto/create-recurring-entry-template.dto';
export type { RecurringEntryTemplateLineDto } from '../../../backend/src/modules/recurring-entries/dto/recurring-entry-template-line.dto';
export type { PreviewRecurringEntryTemplateDto } from '../../../backend/src/modules/recurring-entries/dto/preview-recurring-entry-template.dto';
