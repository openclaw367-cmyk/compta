import { Module } from '@nestjs/common';
import { CabinetBatchController } from './cabinet-batch.controller';
import { CabinetBatchService } from './cabinet-batch.service';
import { CompaniesModule } from '../companies/companies.module';
import { FiscalYearsModule } from '../fiscal-years/fiscal-years.module';
import { FecModule } from '../fec/fec.module';

@Module({
  imports: [CompaniesModule, FiscalYearsModule, FecModule],
  controllers: [CabinetBatchController],
  providers: [CabinetBatchService],
})
export class CabinetModule {}
