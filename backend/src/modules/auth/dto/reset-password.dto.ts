import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'The raw token from the emailed reset link.' })
  @IsString()
  token!: string;

  @ApiProperty({ example: 'a-new-strong-password', description: 'At least 8 characters.' })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
