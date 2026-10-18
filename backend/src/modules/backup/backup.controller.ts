import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthenticatedUser } from '../../common/auth/request-with-user';
import { BackupService } from './backup.service';

/**
 * No `x-company-id` header — deliberately. A full-instance backup spans
 * every company this install holds, so there's no single company
 * context for this controller, same reasoning as `GET /companies`'s own
 * exclusion. See `BackupService`'s own doc comment for the full design.
 */
@ApiTags('backup')
@Controller('backup')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @ApiOperation({
    summary: 'Download a full-instance backup (database + attached documents).',
    description:
      'Every company, every table — a real pg_dump (custom format) zipped together with every ' +
      'attached document file. Requires the caller to own at least one company. Restore is a ' +
      'documented pg_restore runbook, not a self-service endpoint — see scripts/backup/README.md.',
  })
  @ApiProduces('application/zip')
  @Get('export')
  async export(@CurrentUser() user: AuthenticatedUser, @Res() res: Response): Promise<void> {
    const { fileName, buffer } = await this.backupService.export(user);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}
