import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { CommonAuthModule } from './common/auth/common-auth.module';
import { AuthMiddleware } from './common/auth/auth.middleware';
import { ReadOnlyGuard } from './common/auth/read-only.guard';
import { CompanyContextMiddleware } from './common/tenant/company-context.middleware';
import { AuthModule } from './modules/auth/auth.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { MembershipsController } from './modules/memberships/memberships.controller';
import { CompaniesModule } from './modules/companies/companies.module';
import { CompaniesController } from './modules/companies/companies.controller';
import { AccountsModule } from './modules/accounts/accounts.module';
import { AccountsController } from './modules/accounts/accounts.controller';
import { JournalsModule } from './modules/journals/journals.module';
import { JournalsController } from './modules/journals/journals.controller';
import { FiscalYearsModule } from './modules/fiscal-years/fiscal-years.module';
import { FiscalYearsController } from './modules/fiscal-years/fiscal-years.controller';
import { ANouveauModule } from './modules/a-nouveau/a-nouveau.module';
import { ANouveauController } from './modules/a-nouveau/a-nouveau.controller';
import { EntriesModule } from './modules/entries/entries.module';
import { EntriesController } from './modules/entries/entries.controller';
import { FecModule } from './modules/fec/fec.module';
import { FecController } from './modules/fec/fec.controller';
import { ImportExcelModule } from './modules/import-excel/import-excel.module';
import { ImportExcelController } from './modules/import-excel/import-excel.controller';
import { FecImportModule } from './modules/fec-import/fec-import.module';
import { FecImportController } from './modules/fec-import/fec-import.controller';
import { DepreciationModule } from './modules/depreciation/depreciation.module';
import { DepreciationController } from './modules/depreciation/depreciation.controller';
import { VatModule } from './modules/vat/vat.module';
import { VatController } from './modules/vat/vat.controller';
import { LiasseModule } from './modules/liasse/liasse.module';
import { LiasseController } from './modules/liasse/liasse.controller';
import { CashFlowModule } from './modules/cash-flow/cash-flow.module';
import { CashFlowController } from './modules/cash-flow/cash-flow.controller';
import { FinancialAnalysisModule } from './modules/financial-analysis/financial-analysis.module';
import { FinancialAnalysisController } from './modules/financial-analysis/financial-analysis.controller';
import { ResultatFiscalModule } from './modules/resultat-fiscal/resultat-fiscal.module';
import { ResultatFiscalController } from './modules/resultat-fiscal/resultat-fiscal.controller';
import { LedgerModule } from './modules/ledger/ledger.module';
import { LedgerController } from './modules/ledger/ledger.controller';
import { AiChatModule } from './modules/ai-chat/ai-chat.module';
import { AiChatController } from './modules/ai-chat/ai-chat.controller';
import { CloudCredentialsModule } from './modules/cloud-credentials/cloud-credentials.module';
import { CloudCredentialsController } from './modules/cloud-credentials/cloud-credentials.controller';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DashboardController } from './modules/dashboard/dashboard.controller';
import { DocumentsModule } from './modules/documents/documents.module';
import { EcritureDocumentsController } from './modules/documents/ecriture-documents.controller';
import { DocumentExtractionController } from './modules/documents/document-extraction.controller';
import { BankAccountsModule } from './modules/bank-accounts/bank-accounts.module';
import { BankAccountsController } from './modules/bank-accounts/bank-accounts.controller';
import { BankReconciliationModule } from './modules/bank-reconciliation/bank-reconciliation.module';
import { BankReconciliationController } from './modules/bank-reconciliation/bank-reconciliation.controller';
import { BankAggregatorModule } from './modules/bank-aggregator/bank-aggregator.module';
import { BankAggregatorController } from './modules/bank-aggregator/bank-aggregator.controller';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { InvoicingController } from './modules/invoicing/invoicing.controller';
import { RecurringEntriesModule } from './modules/recurring-entries/recurring-entries.module';
import { RecurringEntriesController } from './modules/recurring-entries/recurring-entries.controller';
import { AnomaliesModule } from './modules/anomalies/anomalies.module';
import { AnomaliesController } from './modules/anomalies/anomalies.controller';
import { ActivityModule } from './modules/activity/activity.module';
import { ActivityController } from './modules/activity/activity.controller';
import { DevModule } from './modules/dev/dev.module';
import { DevController } from './modules/dev/dev.controller';

// Dev-only convenience routes (GET /dev/ids) are never mounted when
// NODE_ENV=production — this isn't a route-level guard, DevModule is
// absent from the module graph entirely, so there's nothing to hit even
// by guessing the path. It's still behind AuthMiddleware/ReadOnlyGuard
// like everything else below, once auth exists — no unauthenticated
// backdoor, even a dev-only one.
const isProduction = process.env.NODE_ENV === 'production';

/** Every controller that requires a signed-in user AND a selected company. */
const companyScopedControllers = [
  AccountsController,
  JournalsController,
  FiscalYearsController,
  ANouveauController,
  EntriesController,
  FecController,
  ImportExcelController,
  FecImportController,
  DepreciationController,
  VatController,
  LiasseController,
  CashFlowController,
  FinancialAnalysisController,
  ResultatFiscalController,
  LedgerController,
  AiChatController,
  CloudCredentialsController,
  DashboardController,
  EcritureDocumentsController,
  DocumentExtractionController,
  BankAccountsController,
  BankReconciliationController,
  BankAggregatorController,
  InvoicingController,
  RecurringEntriesController,
  AnomaliesController,
  MembershipsController,
  ActivityController,
  ...(isProduction ? [] : [DevController]),
];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CryptoModule,
    CommonAuthModule,
    AuthModule,
    MembershipsModule,
    CompaniesModule,
    AccountsModule,
    JournalsModule,
    FiscalYearsModule,
    ANouveauModule,
    EntriesModule,
    FecModule,
    ImportExcelModule,
    FecImportModule,
    DepreciationModule,
    VatModule,
    LiasseModule,
    CashFlowModule,
    FinancialAnalysisModule,
    ResultatFiscalModule,
    LedgerModule,
    AiChatModule,
    CloudCredentialsModule,
    DashboardModule,
    DocumentsModule,
    BankAccountsModule,
    BankReconciliationModule,
    BankAggregatorModule,
    InvoicingModule,
    RecurringEntriesModule,
    AnomaliesModule,
    ActivityModule,
    ...(isProduction ? [] : [DevModule]),
  ],
  providers: [{ provide: APP_GUARD, useClass: ReadOnlyGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Two SEPARATE .apply() calls, not one combined chain — Nest runs
    // them in registration order (AuthMiddleware, then
    // CompanyContextMiddleware) for any route matched by both, but
    // `companies` itself needs ASYMMETRIC treatment: POST/GET /companies
    // require a signed-in caller (AuthMiddleware — creating/listing
    // companies needs to know WHO) but must skip CompanyContextMiddleware
    // entirely (no company is selected yet — GET /companies is exactly
    // what lets the frontend discover what to send as x-company-id in
    // the first place). A single combined `.apply(A, B).exclude(...)`
    // call can't express "skip B but not A" for the same route, hence
    // two calls. `/auth/*` is in NEITHER list — login/signup/refresh
    // must work with no prior identity or company context at all.
    // Swagger's docs UI (mounted in main.ts via SwaggerModule.setup, not
    // as a Nest controller) is a raw Express route outside this list
    // too, needing neither. See CLAUDE.md "Multi-user / roles &
    // permissions" and "Multi-tenant data model".
    consumer.apply(AuthMiddleware).forRoutes(CompaniesController, ...companyScopedControllers);

    consumer
      .apply(CompanyContextMiddleware)
      .exclude(
        { path: 'companies', method: RequestMethod.POST },
        { path: 'companies', method: RequestMethod.GET },
      )
      .forRoutes(CompaniesController, ...companyScopedControllers);
  }
}
