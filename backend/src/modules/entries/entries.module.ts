import { Module } from '@nestjs/common';
import { EntriesController } from './entries.controller';
import { EntriesService } from './entries.service';
import { EntryValidationService } from './entry-validation.service';

@Module({
  controllers: [EntriesController],
  providers: [EntriesService, EntryValidationService],
  exports: [EntriesService, EntryValidationService],
})
export class EntriesModule {}
