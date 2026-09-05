import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class AcceptInviteDto {
  @ApiProperty({ description: 'The raw token from the emailed invite link.' })
  @IsString()
  token!: string;

  @ApiPropertyOptional({
    description:
      'Required only if the invited email has no account yet — creates one. Ignored (an ' +
      'existing account is not re-authenticated here) if the email already belongs to a User.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
