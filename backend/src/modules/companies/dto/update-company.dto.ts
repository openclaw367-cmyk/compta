import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Jurisdiction } from '@prisma/client';

/** All fields optional — a profile edit may touch just one at a time. */
export class UpdateCompanyDto {
  @ApiPropertyOptional({ example: 'Société Démo SARL' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({
    enum: Jurisdiction,
    description: 'FR = France (Article A47 A-1 du LPF rules apply). MC = Monaco.',
  })
  @IsOptional()
  @IsEnum(Jurisdiction)
  jurisdiction?: Jurisdiction;

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

  @ApiPropertyOptional({ example: '12 rue de la Paix' })
  @IsOptional()
  @IsString()
  addressLine?: string;

  @ApiPropertyOptional({ example: '75002' })
  @IsOptional()
  @IsString()
  postalCode?: string;

  @ApiPropertyOptional({ example: 'Paris' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'France' })
  @IsOptional()
  @IsString()
  country?: string;
}
