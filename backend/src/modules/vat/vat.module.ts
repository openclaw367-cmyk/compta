import { Module } from '@nestjs/common';
import { VatController } from './vat.controller';
import { VatService } from './vat.service';

@Module({
  controllers: [VatController],
  providers: [VatService],
  exports: [VatService],
})
export class VatModule {}
