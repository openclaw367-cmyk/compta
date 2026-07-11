import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DepreciationMethod } from '@prisma/client';
import { IsMoneyString } from '../../../common/decimal';

export class CreateFixedAssetDto {
  @ApiProperty({ example: 'Ordinateur portable' })
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiProperty({ description: 'Immobilisation account id (e.g. PCG class 2).' })
  @IsString()
  accountId!: string;

  @ApiProperty({ description: 'Amortissements account id.' })
  @IsString()
  depreciationAccountId!: string;

  @ApiProperty({ description: 'Dotations aux amortissements (expense) account id.' })
  @IsString()
  expenseAccountId!: string;

  @ApiProperty({ example: '2026-01-15' })
  @IsDateString()
  acquisitionDate!: string;

  @ApiProperty({ description: 'Mise en service date.', example: '2026-01-15' })
  @IsDateString()
  serviceStartDate!: string;

  @ApiProperty({ description: 'Money string, e.g. "1234.56".', example: '1200.00' })
  @IsMoneyString()
  acquisitionValue!: string;

  @ApiPropertyOptional({ description: 'Money string. Defaults to "0.00".', example: '0.00' })
  @IsOptional()
  @IsMoneyString()
  residualValue?: string;

  @ApiProperty({ example: 3, minimum: 1 })
  @IsInt()
  @Min(1)
  usefulLifeYears!: number;

  @ApiPropertyOptional({
    enum: DepreciationMethod,
    description: 'Only LINEAR is implemented — DECLINING is not (see CLAUDE.md).',
    default: DepreciationMethod.LINEAR,
  })
  @IsOptional()
  @IsEnum(DepreciationMethod)
  method?: DepreciationMethod;
}
