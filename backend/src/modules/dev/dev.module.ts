import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { JournalsModule } from '../journals/journals.module';
import { FiscalYearsModule } from '../fiscal-years/fiscal-years.module';
import { DevController } from './dev.controller';
import { DevService } from './dev.service';

@Module({
  imports: [CompaniesModule, JournalsModule, FiscalYearsModule],
  controllers: [DevController],
  providers: [DevService],
})
export class DevModule {}
