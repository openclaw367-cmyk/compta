import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ReadOnlyGuard } from './read-only.guard';

function makeContext(method: string, role: string | undefined) {
  const req = { method, companyContext: role ? { companyId: 'company-1', role } : undefined };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('ReadOnlyGuard', () => {
  const guard = new ReadOnlyGuard();

  it('allows GET for any role', () => {
    expect(guard.canActivate(makeContext('GET', 'READ_ONLY'))).toBe(true);
  });

  it('allows HEAD for any role', () => {
    expect(guard.canActivate(makeContext('HEAD', 'READ_ONLY'))).toBe(true);
  });

  it('blocks POST/PUT/PATCH/DELETE for a READ_ONLY role', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() => guard.canActivate(makeContext(method, 'READ_ONLY'))).toThrow(ForbiddenException);
    }
  });

  it('allows a write for MEMBER and OWNER', () => {
    expect(guard.canActivate(makeContext('POST', 'MEMBER'))).toBe(true);
    expect(guard.canActivate(makeContext('POST', 'OWNER'))).toBe(true);
  });

  it('allows a write when no companyContext exists at all (e.g. /auth/* or GET /companies)', () => {
    expect(guard.canActivate(makeContext('POST', undefined))).toBe(true);
  });
});
