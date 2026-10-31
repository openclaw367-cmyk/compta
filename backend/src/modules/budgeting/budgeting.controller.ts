import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentCompany } from '../../common/tenant/current-company.decorator';
import { CompanyContext } from '../../common/tenant/company-context';
import { BudgetingService } from './budgeting.service';
import { CreateBudgetDto } from './dto/create-budget.dto';

@ApiTags('budgeting')
@ApiHeader({
  name: 'x-company-id',
  required: true,
  description:
    'Tenant id — must name a company the caller (see Authorization header) is a member of.',
})
@Controller('budgets')
export class BudgetingController {
  constructor(private readonly budgeting: BudgetingService) {}

  @ApiOperation({ summary: 'Create a Budget (account-level planned amounts for one fiscal year).' })
  @Post()
  create(@CurrentCompany() company: CompanyContext, @Body() dto: CreateBudgetDto) {
    return this.budgeting.create(company, dto);
  }

  @ApiOperation({ summary: "List the company's budgets, across every fiscal year." })
  @Get()
  findAll(@CurrentCompany() company: CompanyContext) {
    return this.budgeting.findAll(company);
  }

  @ApiOperation({ summary: 'Fetch one budget and its lines.' })
  @ApiParam({ name: 'id' })
  @Get(':id')
  findOne(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.budgeting.findOne(company, id);
  }

  @ApiOperation({ summary: 'Full replace of a budget (label/fiscal year/lines).' })
  @ApiParam({ name: 'id' })
  @Put(':id')
  update(
    @CurrentCompany() company: CompanyContext,
    @Param('id') id: string,
    @Body() dto: CreateBudgetDto,
  ) {
    return this.budgeting.update(company, id, dto);
  }

  @ApiOperation({
    summary: 'Delete a budget. A budget is pure metadata — this is a real hard delete.',
  })
  @ApiParam({ name: 'id' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.budgeting.remove(company, id);
  }

  @ApiOperation({
    summary:
      "Budget vs. actual variance report for this budget's own fiscal year. See CLAUDE.md " +
      '"Budgeting / forecasting" — the arithmetic and the actual column are verified; the ' +
      'budget figures themselves are a business input, never verified as "correct."',
  })
  @ApiParam({ name: 'id' })
  @Get(':id/variance')
  variance(@CurrentCompany() company: CompanyContext, @Param('id') id: string) {
    return this.budgeting.compareToActual(company, id);
  }
}
