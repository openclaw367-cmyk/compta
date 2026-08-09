import { Body, Controller, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { LiasseService } from './liasse.service';
import { ComputeLiasseDto } from './dto/compute-liasse.dto';

@ApiTags('liasse')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('liasse')
export class LiasseController {
  constructor(private readonly liasseService: LiasseService) {}

  @ApiOperation({
    summary:
      'Generate the liasse fiscale (bilan 2050/2051, compte de résultat 2052/2053) for a fiscal year.',
    description:
      'Régime réel normal (2050-series) only — see specs/liasse-2050-implementation-spec.md. Refuses ' +
      'for a REEL_SIMPLIFIE company, and if any écriture in the fiscal year is still a draft. The ' +
      '2054+ annex forms (immobilisations, amortissements, résultat fiscal, ...) are not generated.',
  })
  @Post('generate')
  generate(@CurrentCompany() company: CompanyContext, @Body() dto: ComputeLiasseDto) {
    return this.liasseService.generate(company, dto);
  }
}
