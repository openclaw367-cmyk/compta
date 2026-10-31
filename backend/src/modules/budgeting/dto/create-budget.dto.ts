import { Type } from 'class-transformer';
import { ArrayMinSize, IsString, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { BudgetLineDto } from './budget-line.dto';

/** Also used, as-is, for a full replace on update (PUT) — same shape, no separate DTO
 *  needed, same precedent as CreateRecurringEntryTemplateDto. */
export class CreateBudgetDto {
  @ApiProperty({ description: 'Fiscal year id — a Budget is scoped to exactly one.' })
  @IsString()
  fiscalYearId!: string;

  @ApiProperty({ example: 'Budget 2026' })
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiProperty({ type: [BudgetLineDto], description: 'At least one account.' })
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  @ArrayMinSize(1, { message: 'A budget needs at least one account line.' })
  lines!: BudgetLineDto[];
}
