import { Module } from '@nestjs/common';
import { ResultatFiscalController } from './resultat-fiscal.controller';
import { ResultatFiscalService } from './resultat-fiscal.service';

@Module({
  controllers: [ResultatFiscalController],
  providers: [ResultatFiscalService],
})
export class ResultatFiscalModule {}
