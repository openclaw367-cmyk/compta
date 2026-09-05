import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { FiscalYearsModule } from '../fiscal-years/fiscal-years.module';
import { CashFlowController } from './cash-flow.controller';
import { CashFlowService } from './cash-flow.service';

@Module({
  imports: [CompaniesModule, FiscalYearsModule],
  controllers: [CashFlowController],
  providers: [CashFlowService],
  exports: [CashFlowService],
})
export class CashFlowModule {}
