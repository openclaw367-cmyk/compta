import { Controller, Post } from '@nestjs/common';
import { LiasseService } from './liasse.service';

@Controller('liasse')
export class LiasseController {
  constructor(private readonly liasseService: LiasseService) {}

  @Post('generate')
  generate() {
    return this.liasseService.generate();
  }
}
