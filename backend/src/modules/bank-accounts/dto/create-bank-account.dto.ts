import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBankAccountDto {
  @ApiProperty({
    description: 'The 512/514/516/517-family PCG Account id this bank account represents.',
  })
  @IsString()
  compteId!: string;

  @ApiProperty({ example: 'Compte courant BNP Paribas' })
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiPropertyOptional({ example: 'FR7630001007941234567890185' })
  @IsOptional()
  @IsString()
  iban?: string;

  @ApiPropertyOptional({ example: 'EUR' })
  @IsOptional()
  @IsString()
  currency?: string;
}
