import { IsDateString, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateVatRateDto {
  @IsString()
  @MinLength(1)
  label!: string;

  /** Percentage as a string with up to 2 decimals, e.g. "20.00". */
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  ratePercent!: string;

  @IsDateString()
  validFrom!: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;
}
