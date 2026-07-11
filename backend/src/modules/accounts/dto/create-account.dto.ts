import { IsBoolean, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateAccountDto {
  /** CompteNum. Leading digit must be a valid PCG class (1-8). */
  @IsString()
  @Matches(/^[1-8][0-9A-Za-z]*$/, {
    message: 'number must start with a PCG class digit (1-8)',
  })
  number!: string;

  /** CompteLib. */
  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsBoolean()
  isAuxiliary?: boolean;

  @IsOptional()
  @IsString()
  parentId?: string;
}
