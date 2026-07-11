import { Module } from '@nestjs/common';
import { FecController } from './fec.controller';
import { FecExportService } from './fec-export.service';

@Module({
  controllers: [FecController],
  providers: [FecExportService],
  exports: [FecExportService],
})
export class FecModule {}
