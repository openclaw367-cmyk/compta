import { Module } from '@nestjs/common';
import { FecImportController } from './fec-import.controller';
import { FecImportService } from './fec-import.service';

@Module({
  controllers: [FecImportController],
  providers: [FecImportService],
})
export class FecImportModule {}
