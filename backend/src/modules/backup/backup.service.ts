import { ForbiddenException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/request-with-user';
import { importEsm } from '../../common/esm-interop';

// archiver@8 is ESM-only ("type": "module", no CommonJS build) — same
// class of incompatibility CLAUDE.md already documents for
// @stafyniaksacha/facturx and @nestjs/jwt, and the same fix: every
// runtime use goes through a cached, un-downleveled dynamic import(),
// never a static `import` of a value from it (a static import here
// would throw ERR_REQUIRE_ESM the moment this file is required, not
// just under Jest — see common/esm-interop.ts's own doc comment).
let cachedArchiver: typeof import('archiver') | null = null;
async function loadArchiver(): Promise<typeof import('archiver')> {
  if (!cachedArchiver) {
    cachedArchiver = await importEsm<typeof import('archiver')>('archiver');
  }
  return cachedArchiver;
}

export interface BackupExportResult {
  fileName: string;
  buffer: Buffer;
}

/**
 * Full-instance backup — a real `pg_dump` (custom format) of the WHOLE
 * database, zipped together with every attached document file (see
 * CLAUDE.md "Operational readiness — backup and recovery"). Deliberately
 * whole-database, not company-scoped: this app's actual deployment model
 * is one operator/firm running their own Postgres instance for several
 * of their OWN client companies (the same "local-first,
 * single-tenant-in-practice" model already accepted for
 * CredentialEncryptionService's own threat model) — a full backup is
 * what actually answers "the disk died, is my data gone," not a
 * per-company export that would have to hand-reconstruct 20+ Prisma
 * models and their foreign keys. `pg_dump`'s custom format is already
 * the industry-standard, atomic, battle-tested answer to that question.
 *
 * Restore is deliberately NOT a self-service endpoint — see
 * `scripts/backup/README.md` for the documented `pg_restore` runbook.
 * Restoring into a live, running database while the app might be
 * serving other requests is an operational action with real
 * consequences if done wrong, categorically different from export's
 * read-only risk profile — building and verifying a custom restore
 * endpoint was judged not worth the risk for a v1 whose actual job is
 * closing "no backup exists at all."
 *
 * Gated on the caller being an OWNER of at least one company — there is
 * no instance-level admin role in this app's `Membership` model (OWNER/
 * MEMBER/READ_ONLY are all per-company). A true multi-firm SaaS
 * deployment would need a real instance-admin role before this endpoint
 * could be exposed safely across unrelated firms; out of scope for this
 * app's actual single-operator deployment today.
 */
@Injectable()
export class BackupService {
  constructor(private readonly prisma: PrismaService) {}

  async export(user: AuthenticatedUser): Promise<BackupExportResult> {
    await this.assertCallerIsAnOwner(user.id);

    const companies = await this.prisma.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compta-backup-'));
    const dumpPath = path.join(tempDir, 'database.dump');
    try {
      await this.runPgDump(dumpPath);

      const manifest = {
        generatedAt: new Date().toISOString(),
        generatedBy: user.email,
        pgDumpFormat: 'custom',
        companies: companies.map((c) => ({ id: c.id, name: c.name })),
      };

      const buffer = await this.buildZip(dumpPath, manifest);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      return { fileName: `compta-backup-${timestamp}.zip`, buffer };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async assertCallerIsAnOwner(userId: string): Promise<void> {
    const ownerCount = await this.prisma.membership.count({
      where: { userId, role: 'OWNER' },
    });
    if (ownerCount === 0) {
      throw new ForbiddenException(
        'Only an account that owns at least one company may download a full backup.',
      );
    }
  }

  /**
   * `pg_dump` accepts a full connection URI as its dbname argument
   * directly — no manual parsing of host/port/user/password needed —
   * EXCEPT for Prisma's own `?schema=` query parameter, which `pg_dump`
   * doesn't recognize at all (confirmed live: it fails outright with
   * "invalid URI query parameter"). That parameter is stripped here and
   * translated into `pg_dump`'s own `-n/--schema` flag instead — found
   * and fixed live against this project's own real DATABASE_URL, not
   * assumed. `PG_DUMP_PATH` is an escape hatch for an install where the
   * binary isn't on PATH (this dev machine's native Windows Postgres
   * install already puts it there — confirmed directly — but that's
   * not guaranteed on every install).
   */
  private runPgDump(outputPath: string): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new InternalServerErrorException('DATABASE_URL is not configured.');
    }
    const pgDumpBin = process.env.PG_DUMP_PATH ?? 'pg_dump';
    const { connectionString, schema } = this.splitPrismaSchemaParam(databaseUrl);

    return new Promise((resolve, reject) => {
      const child = spawn(pgDumpBin, ['-Fc', '-n', schema, '-f', outputPath, connectionString]);
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        reject(
          new InternalServerErrorException(
            `pg_dump could not be started ("${pgDumpBin}") — is it installed and on PATH, or ` +
              `is PG_DUMP_PATH set to its full path? (${error.message})`,
          ),
        );
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new InternalServerErrorException(`pg_dump exited with code ${code}: ${stderr.trim()}`),
          );
        }
      });
    });
  }

  /**
   * Zips database.dump + manifest.json + every file under
   * DOCUMENT_STORAGE_DIR (the same directory
   * EcritureDocument/DocumentSuggestionService already read/write — see
   * CLAUDE.md "Supporting-document attachments"), buffered fully in
   * memory before returning — matching this app's own existing
   * file-download convention (FEC/Factur-X/report exports all return
   * `{fileName, content}` from the service, letting the controller stay
   * a thin res.send()). A real production accounting instance for one
   * firm's own clients is nowhere near the scale where in-memory
   * buffering becomes a problem; a streaming rewrite is a v2 concern if
   * that ever changes, not a reason to diverge from this app's existing
   * pattern now.
   *
   * Not exercised under Jest, by necessity — `loadArchiver()`'s dynamic
   * import throws under `jest-environment-node` regardless of how it's
   * written (the same "--experimental-vm-modules" limitation CLAUDE.md
   * already documents for Factur-X/pdfjs-dist), so `backup.service.spec.ts`
   * only covers the guard/pg_dump paths that never reach this method.
   * The real zip-contents proof is a one-off `ts-node` smoke run — see
   * CLAUDE.md "Operational readiness — backup and recovery" for the
   * result.
   */
  private async buildZip(dumpPath: string, manifest: object): Promise<Buffer> {
    const { ZipArchive } = await loadArchiver();
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const donePromise = new Promise<void>((resolve, reject) => {
      archive.on('end', () => resolve());
      archive.on('error', (error: Error) => reject(error));
    });

    archive.file(dumpPath, { name: 'database.dump' });
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    const documentsDir = path.resolve(process.env.DOCUMENT_STORAGE_DIR ?? './storage/documents');
    if (await this.pathExists(documentsDir)) {
      archive.directory(documentsDir, 'documents');
    }

    await archive.finalize();
    await donePromise;
    return Buffer.concat(chunks);
  }

  private async pathExists(candidate: string): Promise<boolean> {
    try {
      await fs.access(candidate);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Prisma's `DATABASE_URL` convention appends `?schema=<name>` — a
   * parameter that means something to Prisma's own client, not to the
   * standard libpq connection-string grammar `pg_dump` parses. Strips
   * it out and returns it separately so the caller can pass it via
   * `pg_dump`'s own `-n/--schema` flag instead. Defaults to "public"
   * (Prisma's own default) when the parameter is absent, rather than
   * guessing — matches this app's own "never silently default a
   * compliance-relevant value without naming the convention" posture,
   * even though schema selection isn't itself a compliance rule.
   */
  private splitPrismaSchemaParam(databaseUrl: string): {
    connectionString: string;
    schema: string;
  } {
    const url = new URL(databaseUrl);
    const schema = url.searchParams.get('schema') ?? 'public';
    url.searchParams.delete('schema');
    return { connectionString: url.toString(), schema };
  }
}
