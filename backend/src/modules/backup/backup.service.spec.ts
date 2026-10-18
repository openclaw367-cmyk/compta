import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { BackupService } from './backup.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/request-with-user';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
const mockedSpawn = spawn as unknown as jest.Mock;

const owner: AuthenticatedUser = { id: 'user-1', email: 'owner@example.com' };

function makePrismaMock() {
  return {
    membership: { count: jest.fn().mockResolvedValue(1) },
    company: {
      findMany: jest.fn().mockResolvedValue([{ id: 'company-1', name: 'Société Démo SARL' }]),
    },
  };
}

function mockFailingPgDump(exitCode: number, stderrText: string) {
  mockedSpawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    setImmediate(() => {
      child.stderr.emit('data', Buffer.from(stderrText));
      child.emit('close', exitCode);
    });
    return child;
  });
}

function mockPgDumpNotFound() {
  mockedSpawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    setImmediate(() => child.emit('error', new Error('ENOENT')));
    return child;
  });
}

/**
 * `archiver` (used by `BackupService.buildZip()`, called only AFTER
 * `runPgDump()` succeeds) is ESM-only and loaded via `common/esm-interop.ts`'s
 * dynamic `import()` — that throws under `jest-environment-node`
 * regardless of how it's written (the same limitation CLAUDE.md already
 * documents for Factur-X/pdfjs-dist). So this file only covers the
 * paths that fail BEFORE ever reaching `buildZip()`: the ownership
 * guard and every `pg_dump` outcome. The real end-to-end zip-contents
 * proof (database.dump/manifest.json present, no documents/ entry when
 * none exist, correct manifest fields) is a one-off `ts-node` smoke
 * run against the real dependency chain — see CLAUDE.md "Operational
 * readiness — backup and recovery" for that result.
 */
describe('BackupService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: BackupService;
  const originalEnv = process.env;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new BackupService(prisma as unknown as PrismaService);
    process.env = { ...originalEnv, DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };
    mockedSpawn.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('refuses when the caller owns no company, before ever touching pg_dump', async () => {
    prisma.membership.count.mockResolvedValueOnce(0);
    await expect(service.export(owner)).rejects.toThrow(ForbiddenException);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });

  it('passes the custom-format flag and the connection string (schema param stripped) to pg_dump', async () => {
    mockFailingPgDump(1, 'irrelevant — only inspecting the call args');
    await expect(service.export(owner)).rejects.toThrow(InternalServerErrorException);
    const [bin, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(bin).toBe('pg_dump');
    expect(args).toContain('-Fc');
    expect(args).toContain('postgresql://u:p@localhost:5432/db');
  });

  it("strips Prisma's own ?schema= query param and passes it via -n instead, since pg_dump rejects it as a connection-string param", async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db?schema=public';
    mockFailingPgDump(1, 'irrelevant');
    await expect(service.export(owner)).rejects.toThrow(InternalServerErrorException);
    const [, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(args).toEqual(expect.arrayContaining(['-n', 'public']));
    const connectionArg = args[args.length - 1];
    expect(connectionArg).not.toContain('schema');
  });

  it('defaults the schema to "public" when the DATABASE_URL carries no ?schema= param at all', async () => {
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/db';
    mockFailingPgDump(1, 'irrelevant');
    await expect(service.export(owner)).rejects.toThrow(InternalServerErrorException);
    const [, args] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(args).toEqual(expect.arrayContaining(['-n', 'public']));
  });

  it('uses PG_DUMP_PATH when set, instead of the bare "pg_dump" command', async () => {
    process.env.PG_DUMP_PATH = 'C:/Program Files/PostgreSQL/17/bin/pg_dump.exe';
    mockFailingPgDump(1, 'irrelevant');
    await expect(service.export(owner)).rejects.toThrow(InternalServerErrorException);
    const [bin] = mockedSpawn.mock.calls[0] as [string, string[]];
    expect(bin).toBe('C:/Program Files/PostgreSQL/17/bin/pg_dump.exe');
  });

  it('throws a clear error naming the binary when pg_dump cannot be started at all', async () => {
    mockPgDumpNotFound();
    await expect(service.export(owner)).rejects.toThrow(/pg_dump could not be started/);
  });

  it('throws, including stderr, when pg_dump exits with a non-zero code', async () => {
    mockFailingPgDump(1, 'FATAL: password authentication failed');
    await expect(service.export(owner)).rejects.toThrow(/password authentication failed/);
  });

  it('throws when DATABASE_URL is not configured, without ever spawning pg_dump', async () => {
    delete process.env.DATABASE_URL;
    await expect(service.export(owner)).rejects.toThrow(InternalServerErrorException);
    expect(mockedSpawn).not.toHaveBeenCalled();
  });
});
