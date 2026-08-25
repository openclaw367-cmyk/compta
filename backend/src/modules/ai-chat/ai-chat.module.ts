import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { AccountsModule } from '../accounts/accounts.module';
import { JournalsModule } from '../journals/journals.module';
import { FiscalYearsModule } from '../fiscal-years/fiscal-years.module';
import { VatModule } from '../vat/vat.module';
import { LedgerModule } from '../ledger/ledger.module';
import { LiasseModule } from '../liasse/liasse.module';
import { CashFlowModule } from '../cash-flow/cash-flow.module';
import { FinancialAnalysisModule } from '../financial-analysis/financial-analysis.module';
import { ResultatFiscalModule } from '../resultat-fiscal/resultat-fiscal.module';
import { DepreciationModule } from '../depreciation/depreciation.module';
import { EntriesModule } from '../entries/entries.module';
import { CloudCredentialsModule } from '../cloud-credentials/cloud-credentials.module';
import { InvoiceExtractionModule } from '../invoice-extraction/invoice-extraction.module';
import { ChatModelModule } from './chat-model/chat-model.module';
import { ReadToolsService } from './tools/read-tools.service';
import { ProposeToolsService } from './tools/propose-tools.service';
import { CloudProposeToolsService } from './tools/cloud-propose-tools.service';
import { ChatContextService } from './chat-context.service';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { AiChatService } from './ai-chat.service';
import { AiChatController } from './ai-chat.controller';

/**
 * Phase 1 (read-only) + Phase 2 (propose-only writes). This module's
 * provider list is the actual proof of the write boundary described in
 * CLAUDE.md "AI chatbot": `ReadToolsService` (Phase 1) has zero write
 * capability, grep-verifiable — see its own doc comment. The ONLY
 * write-adjacent surface anywhere in this module is
 * `ProposeToolsService`'s single `propose_ecriture` tool, which never
 * calls `EntriesService.create()` or persists anything — see that file's
 * own doc comment and `entry-validation.service.ts` for the shared
 * validation it runs instead. There is no `validate_ecriture` tool, no
 * `EntriesService.validate()`/`.update()`/`.remove()` call anywhere in
 * this module: a confirmed proposal reaches the ledger only through the
 * frontend's ORDINARY `POST /entries` call — this module has no code
 * path to that write at all, gated or otherwise.
 * `CloudProposeToolsService` (see CLAUDE.md "AI chatbot cloud tier") is a
 * THIRD registry, for the cloud path — it inherits this same
 * non-persisting guarantee by construction, since it only reuses
 * `ProposeToolsService`'s own `propose_ecriture` `ChatTool` object plus
 * two of `ReadToolsService`'s tools (`search_accounts`, `list_vat_rates`),
 * never the other 14. `AiChatService` injects it directly (not through
 * `ChatOrchestratorService`'s constructor — that class stays
 * registry-agnostic via `CloudTurnOverride`, see
 * chat-orchestrator.service.ts) for its cloud branch, `sendCloudMessage()`.
 * The server-side gate on WHEN a turn is allowed to use it (credential
 * existence + thread/file context) lives in `cloud-thread-gate.ts`, not
 * here.
 * `CloudCredentialsModule` is imported for that same cloud branch —
 * `CloudCredentialsService.getDecryptedKey()` is the one call in this
 * whole module that ever touches a real plaintext API key, and only for
 * the duration of constructing that turn's cloud adapter.
 * `CompaniesModule` is imported for `ChatContextService`'s eager-context
 * fetch (see that file), which calls `CompaniesService.findCurrent()`
 * only — `updateCurrent()` exists on that class but nothing in this
 * module ever calls it.
 * `InvoiceExtractionModule` supplies `InvoiceExtractionService` (moved out
 * of this module, see that module's own doc comment) — this module no
 * longer provides it directly.
 * `ChatOrchestratorService`/`CloudProposeToolsService` are exported so
 * `DocumentsModule` (see CLAUDE.md "Supporting-document attachments") can
 * run its own one-shot cloud "suggest accounts" turn through the SAME
 * orchestrator/tool-registry the assistant's own cloud tier uses, rather
 * than a parallel implementation — the only two providers anything
 * outside this module has ever needed.
 */
@Module({
  imports: [
    CompaniesModule,
    AccountsModule,
    JournalsModule,
    FiscalYearsModule,
    VatModule,
    LedgerModule,
    LiasseModule,
    CashFlowModule,
    FinancialAnalysisModule,
    ResultatFiscalModule,
    DepreciationModule,
    EntriesModule,
    CloudCredentialsModule,
    InvoiceExtractionModule,
    ChatModelModule,
  ],
  controllers: [AiChatController],
  providers: [
    ReadToolsService,
    ProposeToolsService,
    CloudProposeToolsService,
    ChatContextService,
    ChatOrchestratorService,
    AiChatService,
  ],
  exports: [ChatOrchestratorService, CloudProposeToolsService],
})
export class AiChatModule {}
