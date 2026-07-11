import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateEcritureLigneDto } from './create-ecriture-ligne.dto';

export class CreateEcritureDto {
  @IsString()
  journalId!: string;

  @IsString()
  fiscalYearId!: string;

  @IsDateString()
  ecritureDate!: string;

  @IsOptional()
  @IsString()
  pieceRef?: string;

  @IsOptional()
  @IsDateString()
  pieceDate?: string;

  @IsString()
  @MinLength(1)
  libelle!: string;

  @ValidateNested({ each: true })
  @Type(() => CreateEcritureLigneDto)
  @ArrayMinSize(2, { message: 'An écriture needs at least two lines to balance.' })
  lignes!: CreateEcritureLigneDto[];
}
