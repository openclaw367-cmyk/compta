import { Module } from '@nestjs/common';
import { EntriesModule } from '../entries/entries.module';
import { RecurringEntriesController } from './recurring-entries.controller';
import { RecurringEntriesService } from './recurring-entries.service';

@Module({
  imports: [EntriesModule],
  controllers: [RecurringEntriesController],
  providers: [RecurringEntriesService],
  exports: [RecurringEntriesService],
})
export class RecurringEntriesModule {}
