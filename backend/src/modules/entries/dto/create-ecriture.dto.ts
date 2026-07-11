import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateEcritureLigneDto } from './create-ecriture-ligne.dto';

export class CreateEcritureDto {
  @ApiProperty({ description: 'Journal id.' })
  @IsString()
  journalId!: string;

  @ApiProperty({ description: 'Fiscal year id.' })
  @IsString()
  fiscalYearId!: string;

  @ApiProperty({ example: '2026-01-15' })
  @IsDateString()
  ecritureDate!: string;

  @ApiPropertyOptional({ description: 'Reference to the supporting document (PieceRef).' })
  @IsOptional()
  @IsString()
  pieceRef?: string;

  @ApiPropertyOptional({ example: '2026-01-14' })
  @IsOptional()
  @IsDateString()
  pieceDate?: string;

  @ApiProperty({ example: 'Achat fournitures' })
  @IsString()
  @MinLength(1)
  libelle!: string;

  @ApiProperty({
    type: [CreateEcritureLigneDto],
    description: 'At least two lines; total debit must equal total credit.',
  })
  @ValidateNested({ each: true })
  @Type(() => CreateEcritureLigneDto)
  @ArrayMinSize(2, { message: 'An écriture needs at least two lines to balance.' })
  lignes!: CreateEcritureLigneDto[];
}
