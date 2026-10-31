import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CashFlowTraceCafQueryDto {
  @ApiProperty({ description: 'The fiscal year the tableau des flux was generated for.' })
  @IsString()
  fiscalYearId!: string;
}
