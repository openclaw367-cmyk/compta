import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @ApiProperty({ example: 'jane@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'a-strong-password', description: 'At least 8 characters.' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    example: 'Ma Société SARL',
    description:
      'Creates the company that comes with signup — the caller becomes its OWNER. Full company ' +
      'profile fields (SIREN, address, jurisdiction, ...) are editable afterward via the company ' +
      'profile screen, same as any other company.',
  })
  @IsString()
  @MinLength(1)
  companyName!: string;
}
