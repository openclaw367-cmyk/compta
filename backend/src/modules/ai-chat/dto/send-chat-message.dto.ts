import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendChatMessageDto {
  @ApiProperty({ example: 'Quel est mon résultat fiscal pour 2026 ?' })
  @IsString()
  @MinLength(1)
  content!: string;
}
