import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmMatchDto {
  @ApiProperty({
    description: 'Which candidate écriture line this statement line is being confirmed against.',
  })
  @IsString()
  @MinLength(1)
  ecritureLigneId!: string;
}
