import { Module } from '@nestjs/common';
import { EntriesModule } from '../entries/entries.module';
import { DepreciationController } from './depreciation.controller';
import { DepreciationService } from './depreciation.service';

@Module({
  imports: [EntriesModule],
  controllers: [DepreciationController],
  providers: [DepreciationService],
  exports: [DepreciationService],
})
export class DepreciationModule {}
