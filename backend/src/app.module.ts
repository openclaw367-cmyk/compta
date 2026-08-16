import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { CompanyContextMiddleware } from './common/tenant/company-context.middleware';
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
import { DevModule } from './modules/dev/dev.module';
import { DevController } from './modules/dev/dev.controller';

// Dev-only convenience routes (GET /dev/ids) are never mounted when
// NODE_ENV=production — this isn't a route-level guard, DevModule is
// absent from the module graph entirely, so there's nothing to hit even
// by guessing the path.
const isProduction = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CompaniesModule,
    AccountsModule,
    JournalsModule,
    FiscalYearsModule,
    ANouveauModule,
    EntriesModule,
    FecModule,
    ImportExcelModule,
    DepreciationModule,
    VatModule,
    LiasseModule,
    CashFlowModule,
    FinancialAnalysisModule,
    ResultatFiscalModule,
    LedgerModule,
    AiChatModule,
    ...(isProduction ? [] : [DevModule]),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Applied to an explicit controller allowlist rather than a wildcard
    // ('*'). Two reasons: (1) company creation itself (POST /companies)
    // must run before a tenant exists, so it still needs a path-level
    // exclude even with an allowlist; (2) Swagger's docs UI (mounted in
    // main.ts via SwaggerModule.setup, not as a Nest controller) is a raw
    // Express route outside this list, so it never needs a company header
    // and needs no exclude rule at all. See CLAUDE.md "Multi-tenant data
    // model".
    consumer
      .apply(CompanyContextMiddleware)
      .exclude({ path: 'companies', method: RequestMethod.POST })
      .forRoutes(
        CompaniesController,
        AccountsController,
        JournalsController,
        FiscalYearsController,
        ANouveauController,
        EntriesController,
        FecController,
        ImportExcelController,
        DepreciationController,
        VatController,
        LiasseController,
        CashFlowController,
        FinancialAnalysisController,
        ResultatFiscalController,
        LedgerController,
        AiChatController,
        ...(isProduction ? [] : [DevController]),
      );
  }
}
