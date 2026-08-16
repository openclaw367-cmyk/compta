import { Body, Controller, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { CashFlowService } from './cash-flow.service';
import { ComputeCashFlowDto } from './dto/compute-cash-flow.dto';

@ApiTags('cash-flow')
@ApiHeader({
  name: 'x-company-id',
  required: false,
  description: 'Tenant id. Falls back to the single existing company if omitted.',
})
@Controller('cash-flow')
export class CashFlowController {
  constructor(private readonly cashFlowService: CashFlowService) {}

  @ApiOperation({
    summary: 'Generate the tableau des flux de trésorerie (indirect method) for a fiscal year.',
    description:
      'Reads the bilan/compte de résultat already built by the liasse module, across the opening ' +
      "(this fiscal year's own à-nouveau lines) and closing (this fiscal year's full ledger) states. " +
      'Refuses if any écriture in the fiscal year is still a draft, and throws if the three flux ' +
      'sections do not reconcile to the actual change in trésorerie — never plugs a mismatch.',
  })
  @Post('generate')
  generate(@CurrentCompany() company: CompanyContext, @Body() dto: ComputeCashFlowDto) {
    return this.cashFlowService.generate(company, dto);
  }
}
