import { Type } from 'class-transformer';
import { ArrayMinSize, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvoiceType } from '@prisma/client';
import { CreateInvoiceLineDto } from './create-invoice-line.dto';

export class CreateInvoiceDto {
  @ApiProperty({ description: 'Fiscal year id.' })
  @IsString()
  fiscalYearId!: string;

  @ApiPropertyOptional({ enum: InvoiceType, default: InvoiceType.SALE })
  @IsOptional()
  @IsEnum(InvoiceType)
  type?: InvoiceType;

  @ApiPropertyOptional({
    description:
      'Required, and must reference an existing FINALIZED SALE invoice on this company, when ' +
      'type = CREDIT_NOTE. Forbidden for a SALE.',
  })
  @IsOptional()
  @IsString()
  correctsInvoiceId?: string;

  @ApiProperty({
    description: 'The client this invoice bills — a 411-family auxiliary account id (Tiers).',
  })
  @IsString()
  clientAccountId!: string;

  @ApiProperty({ type: [CreateInvoiceLineDto], description: 'At least one line.' })
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceLineDto)
  @ArrayMinSize(1, { message: 'An invoice needs at least one line.' })
  lines!: CreateInvoiceLineDto[];
}
