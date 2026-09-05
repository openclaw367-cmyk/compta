import { Module } from '@nestjs/common';
import { CompaniesModule } from '../companies/companies.module';
import { VatController } from './vat.controller';
import { VatService } from './vat.service';

@Module({
  imports: [CompaniesModule],
  controllers: [VatController],
  providers: [VatService],
  exports: [VatService],
})
export class VatModule {}
