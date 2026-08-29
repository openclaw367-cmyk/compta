import { IsEnum, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Regime } from '@prisma/client';

export class LineTraceQueryDto {
  @ApiProperty({ description: 'The fiscal year the report line was generated for.' })
  @IsString()
  fiscalYearId!: string;

  @ApiProperty({
    description: 'The line code to trace back to its contributing accounts, e.g. "BX", "DU", "FC".',
  })
  @IsString()
  lineCode!: string;

  /**
   * Which regime's rule table the line belongs to — explicit, NOT inferred
   * from `Company.regime`. Fixes a real bug found while wiring the frontend:
   * `LiassePage`'s comparison view (`generateSecondary()`) renders the OTHER
   * regime's bilan/CDR alongside the company's own official one, so a click
   * inside that comparison section must trace using the COMPARISON regime's
   * rule table, not the company's official one — inferring from
   * `Company.regime` would silently pick the wrong table (a REEL_NORMAL
   * company's 2033-A comparison rows would be traced against 2050-series
   * codes, which don't exist there, spuriously refusing a real, traceable
   * line as "not traçable"). The caller always knows which regime's table a
   * given row came from (it just rendered it), so this is required, not
   * optional/defaulted.
   */
  @ApiProperty({ enum: Regime, description: "Which regime's rule table to trace against." })
  @IsEnum(Regime)
  regime!: Regime;
}
