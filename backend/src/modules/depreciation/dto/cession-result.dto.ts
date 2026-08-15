import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response for POST .../cession — confirms what was actually posted so
 * the caller doesn't have to re-derive it: the (optional) final prorated
 * dotation and the disposal écriture itself, plus the VNC/plus-moins-
 * value figures the disposal écriture's amounts were built from.
 */
export class CessionResultDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      'EcritureNum of the final prorated dotation posted as part of this disposal, if one was ' +
      'needed (null when the disposal fiscal year was already fully and correctly posted).',
  })
  finalDotationEcritureNum!: string | null;

  @ApiProperty({ description: "The disposal écriture's EcritureNum." })
  cessionEcritureNum!: string;

  @ApiProperty({ description: 'Money string. VNC at the date of cession (675x débit).' })
  vnc!: string;

  @ApiProperty({ description: 'Money string. Sale proceeds (cessionPrice, 775x crédit).' })
  cessionPrice!: string;

  @ApiProperty({
    description:
      'Money string, signed. cessionPrice - vnc: positive = plus-value, negative = moins-value.',
  })
  plusOuMoinsValue!: string;
}
