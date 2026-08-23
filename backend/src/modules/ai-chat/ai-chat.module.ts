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
import { ChatModelModule } from './chat-model/chat-model.module';
import { ReadToolsService } from './tools/read-tools.service';
import { ProposeToolsService } from './tools/propose-tools.service';
import { CloudProposeToolsService } from './tools/cloud-propose-tools.service';
import { ChatContextService } from './chat-context.service';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { InvoiceExtractionService } from './invoice-extraction.service';
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
 * `CloudProposeToolsService` (see CLAUDE.md "AI chatbot cloud tier") is
 * a THIRD registry, for the not-yet-wired-in cloud path — it inherits
 * this same non-persisting guarantee by construction, since it only
 * reuses `ProposeToolsService`'s own `propose_ecriture` `ChatTool` object
 * plus two of `ReadToolsService`'s tools (`search_accounts`,
 * `list_vat_rates`), never the other 14. Registered here as a normal DI
 * provider; not yet injected into `ChatOrchestratorService` — that
 * wiring, and the server-side enforcement of when a turn is allowed to
 * use it, is a later, separate build step.
 * `CompaniesModule` is imported for `ChatContextService`'s eager-context
 * fetch (see that file), which calls `CompaniesService.findCurrent()`
 * only — `updateCurrent()` exists on that class but nothing in this
 * module ever calls it.
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
    ChatModelModule,
  ],
  controllers: [AiChatController],
  providers: [
    ReadToolsService,
    ProposeToolsService,
    CloudProposeToolsService,
    ChatContextService,
    ChatOrchestratorService,
    InvoiceExtractionService,
    AiChatService,
  ],
})
export class AiChatModule {}
