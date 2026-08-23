import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { FiscalYearsModule } from '../fiscal-years/fiscal-years.module';
import { LiasseModule } from '../liasse/liasse.module';
import { FinancialAnalysisModule } from '../financial-analysis/financial-analysis.module';
import { LedgerModule } from '../ledger/ledger.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * The dashboard has no business logic of its own to test in isolation —
 * see DashboardService's own doc comment. This module's job is purely
 * wiring: import the four already-tested modules whose services
 * DashboardService composes, expose one read-only controller. No
 * providers beyond DashboardService itself, and nothing here is
 * exported — nothing else in the app depends on the dashboard.
 */
@Module({
  imports: [
    CompaniesModule,
    FiscalYearsModule,
    LiasseModule,
    FinancialAnalysisModule,
    LedgerModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
