import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Wraps whatever the provider's Connect flow hands back (redirect query
 * params, or a widget postMessage payload) — its real shape is a
 * placeholder pending real Bridge docs, see
 * `providers/bridge-aggregator.adapter.ts`'s own doc comment, so this DTO
 * deliberately validates only "it's an object" rather than specific
 * fields that might be wrong.
 */
export class ConfirmLinkDto {
  @ApiProperty({
    description: "Raw callback payload from the aggregator's Connect flow.",
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  callbackPayload!: Record<string, unknown>;
}
