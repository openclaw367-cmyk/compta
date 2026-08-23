import { BadRequestException } from '@nestjs/common';
import { ChatSession, CloudModelProvider } from '@prisma/client';

export interface CloudTurnRequest {
  provider: CloudModelProvider;
  hasAttachedFiles: boolean;
}

export interface CloudThreadDecision {
  /** The thread id this turn's messages should be persisted/tagged under. */
  threadId: string;
  /** Whether this call OPENED a brand new thread (vs. continuing one). */
  opened: boolean;
}

/**
 * The server-side half of "granularity: per-invocation, explicit action,
 * bounded to one proposal thread" (see CLAUDE.md "AI chatbot cloud tier"
 * and specs/ai-chatbot-cloud-tier-implementation-spec.md, "Granularity").
 * The frontend only showing the "☁️ Proposer avec [Provider]" action when
 * there's something to propose from is a UX nicety — THIS function is the
 * actual boundary: `AiChatService.sendMessage()` calls it on every turn
 * that supplies `cloudProvider`, before any cloud adapter is constructed
 * or any message persisted, so a client that bypasses the UI (calling the
 * API directly) gets refused exactly the same way.
 *
 * Two independent rules, both enforced here:
 * - A NEW thread may only open when THIS turn itself carries a file to
 *   propose from (`hasAttachedFiles`) — a bare "send this text to Claude"
 *   with nothing attached can never start cloud routing, however the
 *   request got there. Continuing an already-open thread needs no new
 *   file (a follow-up question about the same proposal is fine).
 * - A thread, once open, is bound to the provider it was opened with.
 *   Requesting a different provider while one is open is refused rather
 *   than silently reassigned — a thread's `engine`/`cloudProvider` history
 *   must tell one consistent story across every message in it, and
 *   silently switching mid-thread would mean HALF that history was sent
 *   to a provider the caller didn't (for this turn) actually name.
 *
 * Callers must check credential existence separately, BEFORE calling this
 * (see CloudCredentialsService.getDecryptedKey(), which itself throws
 * NotFoundException for a missing credential) — a missing credential is a
 * different failure than a missing thread/file context, and checking it
 * first avoids ever opening/mutating thread state for a request that was
 * going to fail anyway.
 */
export function decideCloudThread(
  session: Pick<ChatSession, 'cloudProposalThreadId' | 'cloudProposalProvider'>,
  request: CloudTurnRequest,
  newThreadId: string,
): CloudThreadDecision {
  if (session.cloudProposalThreadId) {
    if (session.cloudProposalProvider !== request.provider) {
      throw new BadRequestException(
        `A cloud proposal thread is already open on this session with ` +
          `${session.cloudProposalProvider} — revert to local ("Revenir au local") before ` +
          `starting one with ${request.provider}.`,
      );
    }
    return { threadId: session.cloudProposalThreadId, opened: false };
  }
  if (!request.hasAttachedFiles) {
    throw new BadRequestException(
      'A cloud proposal thread can only be opened by a turn that attaches a file to propose ' +
        'from — send this message without cloudProvider to use the local assistant instead.',
    );
  }
  return { threadId: newThreadId, opened: true };
}
