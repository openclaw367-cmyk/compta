import { Module } from '@nestjs/common';
import { LiasseController } from './liasse.controller';
import { LiasseService } from './liasse.service';

@Module({
  controllers: [LiasseController],
  providers: [LiasseService],
  exports: [LiasseService],
})
export class LiasseModule {}
