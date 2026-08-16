import { Module } from '@nestjs/common';
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
import { LocalModelModule } from './local-model/local-model.module';
import { ReadToolsService } from './tools/read-tools.service';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { AiChatService } from './ai-chat.service';
import { AiChatController } from './ai-chat.controller';

/**
 * Phase 1 — read-only. This module's provider list is the actual proof of
 * the "write-incapable by absence" guarantee described in CLAUDE.md "AI
 * chatbot": there is no write-tool service imported here, no
 * EntriesService.create() call anywhere in this module's own code (only
 * EntriesService.findAll/findOne, via ReadToolsService, both read paths),
 * and no `propose_ecriture` entry in ReadToolsService's registry. Phase 2
 * adds exactly that — a new tool + a new confirmation-gate endpoint — on
 * top of this module, never a change to how Phase 1 itself behaves.
 */
@Module({
  imports: [
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
    LocalModelModule,
  ],
  controllers: [AiChatController],
  providers: [ReadToolsService, ChatOrchestratorService, AiChatService],
})
export class AiChatModule {}
