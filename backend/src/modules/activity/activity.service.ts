import { Injectable, Logger } from '@nestjs/common';
import { ActivityEvent, ActivityEventType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';

const RECENT_LIMIT = 20;

/**
 * A lightweight, append-only trail of team/membership actions — see
 * CLAUDE.md "Activity feed". Deliberately scoped to team actions only
 * this pass (invited/accepted/role-changed/removed), not a generic
 * audit log of every write this app makes: instrumenting ledger-adjacent
 * writes (écriture validation, invoice finalization, fiscal-year close)
 * would mean threading `AuthenticatedUser` through several service call
 * chains that don't receive it today (`EntriesService.validate()`,
 * `InvoicingService.finalize()`, `FiscalYearsService.close()` all take
 * only a `CompanyContext`) — real, separately-scoped plumbing work, and
 * exactly the kind of change this app's own "don't touch what isn't
 * asked for" discipline says to flag rather than fold in silently. A
 * future pass can extend `ActivityEventType` and thread the actor
 * through those call sites deliberately, the same way this file's own
 * events were added.
 *
 * `log()` never throws into its caller — a failure to record an
 * activity event must never block the actual action it's describing
 * (inviting a member, changing a role, ...). Errors are logged and
 * swallowed, matching the "must never itself become the thing that
 * breaks the feature it's observing" discipline already used by
 * AnomaliesService's own skip-not-throw design.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(
    company: CompanyContext,
    type: ActivityEventType,
    actorEmail: string,
    options?: { targetEmail?: string; detail?: string },
  ): Promise<void> {
    try {
      await this.prisma.activityEvent.create({
        data: {
          companyId: company.companyId,
          type,
          actorEmail,
          targetEmail: options?.targetEmail ?? null,
          detail: options?.detail ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to record activity event ${type}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async listRecent(company: CompanyContext): Promise<ActivityEvent[]> {
    return this.prisma.activityEvent.findMany({
      where: { companyId: company.companyId },
      orderBy: { createdAt: 'desc' },
      take: RECENT_LIMIT,
    });
  }
}
