import { Injectable, ValidationPipe } from '@nestjs/common';
import { CompanyContext } from '../../../common/tenant/company-context';
import { EntryValidationService } from '../../entries/entry-validation.service';
import { CreateEcritureDto } from '../../entries/dto/create-ecriture.dto';
import { ChatTool, extractErrorMessage } from './chat-tool';

/**
 * The proposal a human reviews and may confirm. `dto` is EXACTLY the
 * shape `POST /entries` expects — nothing here is chat-specific except
 * the two annotation arrays, which are dropped before the confirmed dto
 * is ever sent to that endpoint. Nothing in this file, or anywhere in
 * ai-chat, ever calls EntriesService.create() — see propose-tools
 * .service.spec.ts's own "never persists" test.
 */
export interface ProposedEcriture {
  dto: CreateEcritureDto;
  /** Non-blocking compliance warnings — same computeOrphanedImmobilisationWarnings() the real create() call would raise. */
  warnings: string[];
  /** Judgment calls the model made (account classification, VAT treatment, a value it had to read itself rather than take from parsed facts) — surfaced so a human can correct them before confirming, never silently decided. */
  assumptions: string[];
}

// Reuses Nest's own ValidationPipe — the exact class main.ts wires up
// globally (whitelist/transform/forbidNonWhitelisted) — rather than a
// parallel hand-rolled class-validator call, so a malformed proposal is
// rejected by the SAME rules an HTTP POST /entries body would be.
const dtoValidationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

/**
 * The Phase 2 write-adjacent tool registry — exactly ONE tool,
 * propose_ecriture. It NEVER persists (see the doc comment above and
 * CLAUDE.md "AI chatbot Phase 2"): it runs the identical checks
 * EntriesService.create() runs (via the shared EntryValidationService),
 * on the SAME DTO shape, validated by the SAME Nest ValidationPipe class
 * the HTTP boundary uses — then returns the validated-but-unpersisted
 * proposal for a human to review, edit, and confirm through the
 * ORDINARY POST /entries endpoint (the frontend's existing
 * useCreateEcriture() hook — no privileged path). A malformed or
 * hallucinated reference (a bad journalId/fiscalYearId/compteId) is
 * refused by the exact same NotFoundException/BadRequestException a
 * human's own bad manual entry would trigger, fed back to the model as
 * a retryable tool-result error.
 */
@Injectable()
export class ProposeToolsService {
  private readonly tools: ChatTool[];

  constructor(private readonly validation: EntryValidationService) {
    this.tools = this.buildTools();
  }

  getAll(): ChatTool[] {
    return this.tools;
  }

  async execute(
    company: CompanyContext,
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
    const tool = this.tools.find((t) => t.spec.name === name);
    if (!tool) {
      return { ok: false, error: `Unknown tool "${name}". No such tool is registered.` };
    }
    try {
      const value = await tool.execute(company, args);
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: extractErrorMessage(err) };
    }
  }

  private buildTools(): ChatTool[] {
    return [
      {
        spec: {
          name: 'propose_ecriture',
          description:
            'Propose a journal entry (écriture) for a human to review and confirm. This NEVER ' +
            'writes to the ledger by itself — it validates the proposal (balance, account/' +
            'journal/fiscal-year existence, VAT rate ownership) and returns it unpersisted for ' +
            'a human confirmation step. Only call this once you have every fact you need ' +
            '(amounts, which account, VAT, journal, fiscal year) — ask the user for anything ' +
            'missing rather than guessing. Use resolved fiscalYearId/journalId from the context ' +
            'above, and search_accounts to resolve an account. Every debit/credit is a money ' +
            'string like "120.00". If an accounting classification is genuinely ambiguous (e.g. ' +
            'a purchase that could be a charge or an immobilisation), make your best proposal ' +
            'but state the assumption explicitly in the assumptions field — never decide it silently.',
          parameters: {
            type: 'object',
            properties: {
              journalId: { type: 'string' },
              fiscalYearId: { type: 'string' },
              ecritureDate: { type: 'string', description: 'YYYY-MM-DD' },
              pieceRef: { type: 'string', description: 'Optional supporting-document reference.' },
              pieceDate: { type: 'string', description: 'YYYY-MM-DD, optional.' },
              libelle: { type: 'string' },
              lignes: {
                type: 'array',
                minItems: 2,
                items: {
                  type: 'object',
                  properties: {
                    compteId: { type: 'string' },
                    compteAuxId: { type: 'string' },
                    debit: { type: 'string', description: 'Money string, e.g. "120.00".' },
                    credit: { type: 'string', description: 'Money string, e.g. "120.00".' },
                    vatRateId: { type: 'string' },
                    dateEcheance: { type: 'string', description: 'YYYY-MM-DD, optional.' },
                  },
                  required: ['compteId'],
                },
              },
              assumptions: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Judgment calls made while building this proposal (account classification, ' +
                  'VAT treatment, a value read from free text rather than given as a parsed ' +
                  'fact). Empty array if none.',
              },
            },
            required: ['journalId', 'fiscalYearId', 'ecritureDate', 'libelle', 'lignes'],
          },
        },
        execute: async (company, args) => {
          const { assumptions, ...dtoArgs } = args;
          const dto = (await dtoValidationPipe.transform(dtoArgs, {
            type: 'body',
            metatype: CreateEcritureDto,
          })) as CreateEcritureDto;

          // Same checks EntriesService.create() runs, same order, same
          // shared service — the balance check's return value is
          // discarded here: it's called purely for its throw-on-imbalance
          // side effect, since /entries re-validates from the dto anyway
          // at confirm time.
          this.validation.buildBalancedLignes(company, dto.lignes);
          await this.validation.assertReferencesBelongToCompany(
            company,
            dto.journalId,
            dto.fiscalYearId,
          );
          await this.validation.assertVatRatesBelongToCompany(company, dto.lignes);
          const warnings = await this.validation.computeOrphanedImmobilisationWarnings(
            company,
            dto.lignes,
          );

          const proposal: ProposedEcriture = {
            dto,
            warnings,
            assumptions: Array.isArray(assumptions)
              ? assumptions.filter((a): a is string => typeof a === 'string')
              : [],
          };
          return proposal;
        },
      },
    ];
  }
}
