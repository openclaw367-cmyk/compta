import { Module } from '@nestjs/common';
import { CashFlowModule } from '../cash-flow/cash-flow.module';
import { FinancialAnalysisController } from './financial-analysis.controller';
import { FinancialAnalysisService } from './financial-analysis.service';

@Module({
  imports: [CashFlowModule],
  controllers: [FinancialAnalysisController],
  providers: [FinancialAnalysisService],
  exports: [FinancialAnalysisService],
})
export class FinancialAnalysisModule {}
