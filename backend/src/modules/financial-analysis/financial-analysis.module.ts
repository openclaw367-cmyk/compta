import { Module } from '@nestjs/common';
import { CashFlowModule } from '../cash-flow/cash-flow.module';
import { CompaniesModule } from '../companies/companies.module';
import { FiscalYearsModule } from '../fiscal-years/fiscal-years.module';
import { FinancialAnalysisController } from './financial-analysis.controller';
import { FinancialAnalysisService } from './financial-analysis.service';

@Module({
  imports: [CashFlowModule, CompaniesModule, FiscalYearsModule],
  controllers: [FinancialAnalysisController],
  providers: [FinancialAnalysisService],
  exports: [FinancialAnalysisService],
})
export class FinancialAnalysisModule {}
