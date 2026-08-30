import { Module } from '@nestjs/common';
import { EntriesModule } from '../entries/entries.module';
import { InvoicingController } from './invoicing.controller';
import { InvoicingService } from './invoicing.service';

@Module({
  imports: [EntriesModule],
  controllers: [InvoicingController],
  providers: [InvoicingService],
  exports: [InvoicingService],
})
export class InvoicingModule {}
