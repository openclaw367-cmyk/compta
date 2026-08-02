import { Module } from '@nestjs/common';
import { ANouveauController } from './a-nouveau.controller';
import { ANouveauService } from './a-nouveau.service';

@Module({
  controllers: [ANouveauController],
  providers: [ANouveauService],
})
export class ANouveauModule {}
