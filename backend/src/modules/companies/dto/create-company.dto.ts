import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Jurisdiction } from '@prisma/client';

export class CreateCompanyDto {
  @ApiProperty({ example: 'Société Démo SARL' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({
    enum: Jurisdiction,
    description: 'FR = France (Article A47 A-1 du LPF rules apply). MC = Monaco.',
  })
  @IsEnum(Jurisdiction)
  jurisdiction!: Jurisdiction;

  @ApiPropertyOptional({
    description:
      'French SIREN (9 digits). Required in practice before a FEC export can be produced.',
    example: '123456789',
  })
  @IsOptional()
  @IsString()
  siren?: string;

  @ApiPropertyOptional({
    description: "Monaco RCI (Registre du Commerce et de l'Industrie) identifier.",
  })
  @IsOptional()
  @IsString()
  rci?: string;

  @ApiPropertyOptional({ example: 'FR12123456789' })
  @IsOptional()
  @IsString()
  vatNumber?: string;
}
