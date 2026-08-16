import { Body, Controller, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { FinancialAnalysisService } from './financial-analysis.service';
import { ComputeFinancialAnalysisDto } from './dto/compute-financial-analysis.dto';

@ApiTags('financial-analysis')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('financial-analysis')
export class FinancialAnalysisController {
  constructor(private readonly financialAnalysisService: FinancialAnalysisService) {}

  @ApiOperation({
    summary:
      'Compute the retraitement analytique (SIG, BFR/FR/trésorerie, ratios) for a fiscal year.',
    description:
      'Fully deterministic — every figure is ledger-derived, no assumption (WACC/DCF/multiples are ' +
      'out of scope, deferred to a future Valuation module). Reuses the tableau de flux de ' +
      "trésorerie's own fetch, so BFR here ties to that module's ΔBFR by construction. Refuses if " +
      'any écriture in the fiscal year is still a draft, and throws if BFR or trésorerie nette fail ' +
      'to tie — never plugs a mismatch.',
  })
  @Post('generate')
  generate(@CurrentCompany() company: CompanyContext, @Body() dto: ComputeFinancialAnalysisDto) {
    return this.financialAnalysisService.generate(company, dto);
  }
}
