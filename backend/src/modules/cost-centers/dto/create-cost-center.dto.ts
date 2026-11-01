import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCostCenterDto {
  @ApiProperty({ description: 'Short code, unique per company.', example: 'PROJ-A' })
  @IsString()
  code!: string;

  @ApiProperty({ description: 'Display label.', example: 'Projet A' })
  @IsString()
  label!: string;
}
