import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CloudModelProvider } from '@prisma/client';

export class SuggestAccountsDto {
  /**
   * Required (unlike SendChatMessageDto's optional cloudProvider) — this
   * endpoint IS the "☁️ Suggérer les comptes avec [Provider]" action
   * itself, always explicit, never a default. See CLAUDE.md
   * "Supporting-document attachments" — Layer 3: the "Comptable IA" toggle
   * never falls back to a local model for account suggestion.
   */
  @ApiProperty({ enum: CloudModelProvider })
  @IsEnum(CloudModelProvider)
  cloudProvider!: CloudModelProvider;
}
