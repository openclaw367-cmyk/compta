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
    summary: 'Generate the liasse fiscale for a fiscal year — regime-dependent shape.',
    description:
      'Branches on Company.regime. REEL_NORMAL returns the full 2050-series (bilan, compte de ' +
      'résultat, 2054/2055/2056/2057/2059 annexes) — see specs/liasse-2050-implementation-spec.md. ' +
      'REEL_SIMPLIFIE returns bilan simplifié (2033-A) and compte de résultat simplifié (2033-B, ' +
      '"résultat comptable" section only — no annexe equivalents yet, no résultat fiscal). Refuses ' +
      'for any other regime, and if any écriture in the fiscal year is still a draft.',
  })
  @Post('generate')
  generate(@CurrentCompany() company: CompanyContext, @Body() dto: ComputeLiasseDto) {
    return this.liasseService.generate(company, dto);
  }
}
