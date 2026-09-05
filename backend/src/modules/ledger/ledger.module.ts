import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { FiscalYearsModule } from '../fiscal-years/fiscal-years.module';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

@Module({
  imports: [CompaniesModule, FiscalYearsModule],
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
