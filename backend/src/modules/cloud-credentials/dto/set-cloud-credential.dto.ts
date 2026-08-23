import { IsEnum, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CloudModelProvider } from '@prisma/client';

export class SetCloudCredentialDto {
  @ApiProperty({ enum: CloudModelProvider })
  @IsEnum(CloudModelProvider)
  provider!: CloudModelProvider;

  @ApiProperty({
    description:
      "The provider's own API key, exactly as issued to you by them (e.g. Anthropic's " +
      "console or DeepSeek's platform). Stored encrypted — never returned in full by any " +
      'response, only as a masked hint.',
    example: 'sk-ant-api03-...',
  })
  @IsString()
  @MinLength(8)
  apiKey!: string;
}
