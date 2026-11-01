import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { generateOpaqueToken } from '../../common/auth/opaque-token';
import { EntriesService, EcritureWriteResult } from '../entries/entries.service';
import { CreateEcritureDto } from '../entries/dto/create-ecriture.dto';
import { ProposedEcriture } from '../ai-chat/tools/propose-tools.service';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h — see McpProposalToken's own schema doc comment.

export interface PendingMcpProposal {
  id: string;
  dto: CreateEcritureDto;
  warnings: string[];
  assumptions: string[];
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Backs the MCP confirmation flow — see CLAUDE.md "MCP confirmation
 * flow". `createToken()` is called from the MCP server (`src/mcp-server/`)
 * right after a successful `propose_ecriture` tool call; `listPending()`/
 * `confirm()`/`reject()` back the ordinary, authenticated web confirm
 * page (`McpConfirmationsController`). Nothing here ever calls
 * `EntriesService.create()` except `confirm()`, and only after the
 * atomic single-use flip below succeeds — see that method's own doc
 * comment for why the ordering (lock, THEN post) is load-bearing, not
 * cosmetic.
 *
 * **The raw opaque token (in the URL) and the row id (used by
 * confirm/reject) are deliberately different concepts, not the same
 * value twice.** The raw token is a one-time, unguessable "you were
 * handed this exact link" proof — but per CLAUDE.md's own design,
 * VIEWING the pending stack is authorized by the caller's live,
 * authenticated session (`req.user.id`/`req.companyContext`), never by
 * the token in the URL (opening ANY of your own valid links shows your
 * WHOLE current stack, not just that one item) — so once a row is
 * listed to an authorized session, its own row id is exactly as safe
 * an identifier for a follow-up confirm/reject as any other
 * session-authorized resource id elsewhere in this app (e.g. revoking
 * an invite by its row id). The raw token itself is never persisted
 * (only its hash, same as RefreshToken/PasswordResetToken) and is
 * never looked up again after `createToken()` returns it — there is no
 * "resolve this link" endpoint, deliberately, to avoid a second,
 * redundant authorization concept alongside the session-scoped one
 * that actually governs everything here.
 */
@Injectable()
export class McpConfirmationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entries: EntriesService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates the pending-confirmation row and returns the real,
   * browser-openable URL — never the raw token alone. Called ONLY from
   * the MCP server, with the exact (userId, company) the authenticated
   * MCP session already resolved; there is no other caller and no
   * other way to mint one of these tokens.
   */
  async createToken(
    userId: string,
    company: CompanyContext,
    proposal: ProposedEcriture,
  ): Promise<string> {
    const { raw, hash } = generateOpaqueToken();
    await this.prisma.mcpProposalToken.create({
      data: {
        tokenHash: hash,
        userId,
        companyId: company.companyId,
        dto: proposal.dto as unknown as Prisma.InputJsonValue,
        warnings: proposal.warnings,
        assumptions: proposal.assumptions,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });
    const frontendOrigin = this.config.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:5173';
    return `${frontendOrigin}/mcp-confirm/${raw}`;
  }

  /**
   * The ENTIRE pending stack for this exact (user, company) — this is
   * what makes "several proposals collect into one confirm page" true:
   * there is no separate batch entity, just every non-expired PENDING
   * row for this identity.
   */
  async listPending(userId: string, company: CompanyContext): Promise<PendingMcpProposal[]> {
    const rows = await this.prisma.mcpProposalToken.findMany({
      where: {
        userId,
        companyId: company.companyId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      dto: row.dto as unknown as CreateEcritureDto,
      warnings: row.warnings as unknown as string[],
      assumptions: row.assumptions as unknown as string[],
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    }));
  }

  /**
   * Single-use, enforced by an atomic conditional update — the
   * `updateMany` only ever flips a row that is STILL `PENDING`, and its
   * `count` tells us whether WE were the one who flipped it. This is
   * checked and the status is locked to CONFIRMED BEFORE
   * `EntriesService.create()` is ever called, deliberately — the
   * alternative order (post first, mark confirmed after) would let two
   * racing requests (a double-click, two open tabs) both pass a
   * "is it still pending" read-check and both call `create()`,
   * producing a silent DUPLICATE écriture. Locking first means the
   * worst failure mode is the opposite, safer shape: the row is marked
   * CONFIRMED but `create()` itself then throws (a stale account/
   * journal reference) — a visible, immediately-surfaced error the
   * user can act on, never a silent duplicate post. Same class of
   * accepted, narrow risk as `disposeFixedAsset()`'s own two-step
   * `cessionEcritureId` assignment and `InvoicingService.finalize()`'s
   * two-step invoice-number-then-post shape (see CLAUDE.md for both).
   */
  async confirm(id: string, userId: string, company: CompanyContext): Promise<EcritureWriteResult> {
    const row = await this.findOwnedRowOrThrow(id, userId, company);
    const flipped = await this.prisma.mcpProposalToken.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status: 'CONFIRMED', resolvedAt: new Date() },
    });
    if (flipped.count !== 1) {
      throw new ConflictException(
        'This proposal has already been confirmed or rejected, or has expired.',
      );
    }
    // Resolved fresh, from the CONFIRMING user's own live membership —
    // never inherited from whatever role the MCP session had when the
    // proposal was first made. A role downgrade between propose and
    // confirm is caught here, live, not silently honored from a stale
    // capture.
    return this.entries.create(company, row.dto as unknown as CreateEcritureDto);
  }

  async reject(id: string, userId: string, company: CompanyContext): Promise<void> {
    const row = await this.findOwnedRowOrThrow(id, userId, company);
    const flipped = await this.prisma.mcpProposalToken.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status: 'REJECTED', resolvedAt: new Date() },
    });
    if (flipped.count !== 1) {
      throw new ConflictException(
        'This proposal has already been confirmed or rejected, or has expired.',
      );
    }
  }

  /**
   * Scoped to the EXACT (userId, companyId) the token was created
   * for — a row belonging to a different user, or presented under a
   * different company's `x-company-id`, is refused exactly like one
   * that doesn't exist at all (NotFoundException, not ForbiddenException
   * — never confirms to a caller that a given id merely belongs to
   * someone else).
   */
  private async findOwnedRowOrThrow(id: string, userId: string, company: CompanyContext) {
    const row = await this.prisma.mcpProposalToken.findUnique({ where: { id } });
    if (!row || row.userId !== userId || row.companyId !== company.companyId) {
      throw new NotFoundException(`Proposal ${id} not found.`);
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This proposal confirmation link has expired.');
    }
    return row;
  }
}
