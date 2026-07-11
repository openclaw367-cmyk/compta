import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreateFiscalYearDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}
