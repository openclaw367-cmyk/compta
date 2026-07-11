import { Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LiasseService } from './liasse.service';

@ApiTags('liasse')
@Controller('liasse')
export class LiasseController {
  constructor(private readonly liasseService: LiasseService) {}

  @ApiOperation({
    summary: 'Generate the liasse fiscale (bilan, compte de résultat, annexes).',
    description: 'Not implemented yet — returns 501. See CLAUDE.md.',
  })
  @Post('generate')
  generate() {
    return this.liasseService.generate();
  }
}
