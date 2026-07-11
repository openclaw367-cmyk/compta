import { Module } from '@nestjs/common';
import { ImportExcelController } from './import-excel.controller';
import { ImportExcelService } from './import-excel.service';

@Module({
  controllers: [ImportExcelController],
  providers: [ImportExcelService],
  exports: [ImportExcelService],
})
export class ImportExcelModule {}
