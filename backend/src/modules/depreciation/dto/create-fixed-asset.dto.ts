import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { DepreciationMethod } from '@prisma/client';
import { IsMoneyString } from '../../../common/decimal';

export class CreateFixedAssetDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsString()
  accountId!: string;

  @IsString()
  depreciationAccountId!: string;

  @IsString()
  expenseAccountId!: string;

  @IsDateString()
  acquisitionDate!: string;

  @IsDateString()
  serviceStartDate!: string;

  @IsMoneyString()
  acquisitionValue!: string;

  @IsOptional()
  @IsMoneyString()
  residualValue?: string;

  @IsInt()
  @Min(1)
  usefulLifeYears!: number;

  @IsOptional()
  @IsEnum(DepreciationMethod)
  method?: DepreciationMethod;
}
