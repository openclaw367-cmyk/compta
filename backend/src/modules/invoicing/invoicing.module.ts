import { Module } from '@nestjs/common';
import { EntriesModule } from '../entries/entries.module';
import { InvoicingController } from './invoicing.controller';
import { InvoicingService } from './invoicing.service';
import { FacturXService } from './factur-x.service';

@Module({
  imports: [EntriesModule],
  controllers: [InvoicingController],
  providers: [InvoicingService, FacturXService],
  exports: [InvoicingService, FacturXService],
})
export class InvoicingModule {}
