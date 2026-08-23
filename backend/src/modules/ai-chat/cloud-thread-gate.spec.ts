import { BadRequestException } from '@nestjs/common';
import { CloudModelProvider } from '@prisma/client';
import { decideCloudThread } from './cloud-thread-gate';

describe('decideCloudThread', () => {
  it('opens a new thread when no thread is open and this turn attaches a file', () => {
    const decision = decideCloudThread(
      { cloudProposalThreadId: null, cloudProposalProvider: null },
      { provider: CloudModelProvider.CLAUDE, hasAttachedFiles: true },
      'new-thread-id',
    );
    expect(decision).toEqual({ threadId: 'new-thread-id', opened: true });
  });

  it('refuses to open a new thread when no file is attached', () => {
    expect(() =>
      decideCloudThread(
        { cloudProposalThreadId: null, cloudProposalProvider: null },
        { provider: CloudModelProvider.CLAUDE, hasAttachedFiles: false },
        'new-thread-id',
      ),
    ).toThrow(BadRequestException);
  });

  it('continues an already-open thread for the SAME provider, even with no new file', () => {
    const decision = decideCloudThread(
      { cloudProposalThreadId: 'thread-abc', cloudProposalProvider: CloudModelProvider.CLAUDE },
      { provider: CloudModelProvider.CLAUDE, hasAttachedFiles: false },
      'new-thread-id',
    );
    expect(decision).toEqual({ threadId: 'thread-abc', opened: false });
  });

  it('refuses to continue an already-open thread for a DIFFERENT provider than it was opened with', () => {
    expect(() =>
      decideCloudThread(
        { cloudProposalThreadId: 'thread-abc', cloudProposalProvider: CloudModelProvider.CLAUDE },
        { provider: CloudModelProvider.DEEPSEEK, hasAttachedFiles: true },
        'new-thread-id',
      ),
    ).toThrow(BadRequestException);
  });

  it('a new file attached mid-thread does not open a SECOND thread — the existing one still wins', () => {
    const decision = decideCloudThread(
      { cloudProposalThreadId: 'thread-abc', cloudProposalProvider: CloudModelProvider.CLAUDE },
      { provider: CloudModelProvider.CLAUDE, hasAttachedFiles: true },
      'new-thread-id',
    );
    expect(decision).toEqual({ threadId: 'thread-abc', opened: false });
  });
});
