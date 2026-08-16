import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMoneyString } from '../../../common/decimal';

export class DeclaredLineDto {
  @ApiProperty({
    description:
      'The 2058-A/2058-B line code this adjustment corresponds to (e.g. "WD", "XD", "XA").',
  })
  @IsString()
  code!: string;

  @ApiProperty({ description: 'A human-readable label for this adjustment.' })
  @IsString()
  label!: string;

  @ApiProperty({
    description:
      'The declared amount — always positive; the section (réintégration/déduction) determines its effect.',
  })
  @IsMoneyString()
  montant!: string;
}

export class ComputeResultatFiscalDto {
  @ApiProperty({ description: 'The fiscal year to compute the résultat fiscal for.' })
  @IsString()
  fiscalYearId!: string;

  @ApiPropertyOptional({
    description:
      'The confirmed amount for WJ (amendes et pénalités, compte 6712) — defaults to the ledger-derived suggestion if omitted. Never silently trusted: the response always reports both the suggestion and what was actually confirmed.',
  })
  @IsOptional()
  @IsMoneyString()
  confirmedAmendesEtPenalites?: string;

  @ApiPropertyOptional({
    description:
      'The confirmed amount for WG (taxe sur les véhicules des sociétés, compte 63514) — defaults to the ledger-derived suggestion if omitted.',
  })
  @IsOptional()
  @IsMoneyString()
  confirmedTaxeVehicules?: string;

  @ApiPropertyOptional({
    description:
      'Every other réintégration the user declares (2058-A/2058-B cadre III), free-form.',
    type: [DeclaredLineDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeclaredLineDto)
  reintegrationsDeclarees?: DeclaredLineDto[];

  @ApiPropertyOptional({
    description: 'Every déduction the user declares, free-form.',
    type: [DeclaredLineDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeclaredLineDto)
  deductionsDeclarees?: DeclaredLineDto[];
}
