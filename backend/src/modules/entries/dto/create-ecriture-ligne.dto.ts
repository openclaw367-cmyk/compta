import { IsOptional, IsString } from 'class-validator';
import { IsMoneyString } from '../../../common/decimal';

export class CreateEcritureLigneDto {
  @IsString()
  compteId!: string;

  @IsOptional()
  @IsString()
  compteAuxId?: string;

  /** Money string, e.g. "1234.56". Exactly one of debit/credit must be non-zero. */
  @IsOptional()
  @IsMoneyString()
  debit?: string;

  @IsOptional()
  @IsMoneyString()
  credit?: string;

  @IsOptional()
  @IsString()
  lettrage?: string;

  @IsOptional()
  @IsMoneyString()
  montantDevise?: string;

  @IsOptional()
  @IsString()
  idDevise?: string;
}
