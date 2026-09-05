import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { FiscalYearsModule } from '../fiscal-years/fiscal-years.module';
import { ResultatFiscalController } from './resultat-fiscal.controller';
import { ResultatFiscalService } from './resultat-fiscal.service';

@Module({
  imports: [CompaniesModule, FiscalYearsModule],
  controllers: [ResultatFiscalController],
  providers: [ResultatFiscalService],
  exports: [ResultatFiscalService],
})
export class ResultatFiscalModule {}
