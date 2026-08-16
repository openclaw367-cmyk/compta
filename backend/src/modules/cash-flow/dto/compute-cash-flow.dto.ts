import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ComputeCashFlowDto {
  @ApiProperty({
    description: 'The fiscal year to generate the tableau des flux de trésorerie for.',
  })
  @IsString()
  fiscalYearId!: string;
}
