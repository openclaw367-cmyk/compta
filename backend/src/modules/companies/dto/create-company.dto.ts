import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Jurisdiction } from '@prisma/client';

export class CreateCompanyDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(Jurisdiction)
  jurisdiction!: Jurisdiction;

  /** Required in practice for FR companies before a FEC export can be produced. */
  @IsOptional()
  @IsString()
  siren?: string;

  /** Monaco RCI identifier. */
  @IsOptional()
  @IsString()
  rci?: string;

  @IsOptional()
  @IsString()
  vatNumber?: string;
}
