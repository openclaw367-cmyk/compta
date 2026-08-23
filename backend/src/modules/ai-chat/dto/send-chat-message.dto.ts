import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { CloudModelProvider } from '@prisma/client';

export class SendChatMessageDto {
  @ApiProperty({ example: 'Quel est mon résultat fiscal pour 2026 ?' })
  @IsString()
  @MinLength(1)
  content!: string;

  /**
   * Presence IS the explicit per-invocation "☁️ Proposer avec [Provider]"
   * action (see CLAUDE.md "AI chatbot cloud tier") — omission (the default
   * "Envoyer" send) always means local. This field alone is NOT sufficient
   * to actually route through cloud: AiChatService.sendMessage() still
   * checks a stored credential exists and calls decideCloudThread() (see
   * cloud-thread-gate.ts) before honoring it — a client that sets this
   * without either of those gets refused, not silently downgraded.
   */
  @ApiPropertyOptional({ enum: CloudModelProvider })
  @IsOptional()
  @IsEnum(CloudModelProvider)
  cloudProvider?: CloudModelProvider;
}
