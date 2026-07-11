import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAccountDto {
  @ApiProperty({
    description: 'CompteNum. Leading digit must be a valid PCG class (1-8).',
    example: '607000',
  })
  @IsString()
  @Matches(/^[1-8][0-9A-Za-z]*$/, {
    message: 'number must start with a PCG class digit (1-8)',
  })
  number!: string;

  @ApiProperty({ description: 'CompteLib.', example: 'Achats de marchandises' })
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiPropertyOptional({
    description: 'True for a compte auxiliaire (e.g. a specific client/supplier sub-account).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isAuxiliary?: boolean;

  @ApiPropertyOptional({ description: 'Parent account id, for PCG account hierarchy.' })
  @IsOptional()
  @IsString()
  parentId?: string;
}
