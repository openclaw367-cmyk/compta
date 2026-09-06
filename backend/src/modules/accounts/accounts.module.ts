import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { PlanComptableImportService } from './plan-comptable-import.service';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, PlanComptableImportService],
  exports: [AccountsService],
})
export class AccountsModule {}
