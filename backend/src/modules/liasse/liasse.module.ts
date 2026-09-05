import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { FiscalYearsModule } from '../fiscal-years/fiscal-years.module';
import { LiasseController } from './liasse.controller';
import { LiasseService } from './liasse.service';

@Module({
  imports: [CompaniesModule, FiscalYearsModule],
  controllers: [LiasseController],
  providers: [LiasseService],
  exports: [LiasseService],
})
export class LiasseModule {}
