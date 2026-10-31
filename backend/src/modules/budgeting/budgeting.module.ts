import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { BudgetingController } from './budgeting.controller';
import { BudgetingService } from './budgeting.service';

@Module({
  imports: [LedgerModule],
  controllers: [BudgetingController],
  providers: [BudgetingService],
  exports: [BudgetingService],
})
export class BudgetingModule {}
