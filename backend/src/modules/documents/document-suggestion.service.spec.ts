import { NotFoundException } from '@nestjs/common';
import { CloudModelProvider } from '@prisma/client';
import { DocumentSuggestionService } from './document-suggestion.service';
import { InvoiceExtractionService } from '../invoice-extraction/invoice-extraction.service';
import { ChatOrchestratorService, OrchestratedMessage } from '../ai-chat/chat-orchestrator.service';
import { CloudProposeToolsService } from '../ai-chat/tools/cloud-propose-tools.service';
import { CloudCredentialsService } from '../cloud-credentials/cloud-credentials.service';
import { CompanyContext } from '../../common/tenant/company-context';

const company: CompanyContext = { companyId: 'company-1' };

function pdfFile(): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'facture.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 100,
    buffer: Buffer.from('x'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as unknown as Express.Multer.File['stream'],
  };
}

describe('DocumentSuggestionService', () => {
  let invoiceExtraction: jest.Mocked<Pick<InvoiceExtractionService, 'extract'>>;
  let orchestrator: jest.Mocked<Pick<ChatOrchestratorService, 'runTurn'>>;
  let cloudProposeTools: CloudProposeToolsService;
  let cloudCredentials: jest.Mocked<Pick<CloudCredentialsService, 'getDecryptedKey'>>;
  let service: DocumentSuggestionService;

  beforeEach(() => {
    invoiceExtraction = {
      extract: jest.fn().mockResolvedValue({ fileName: 'facture.pdf', fields: {}, rawText: '' }),
    };
    orchestrator = { runTurn: jest.fn() };
    cloudProposeTools = {} as CloudProposeToolsService;
    cloudCredentials = { getDecryptedKey: jest.fn().mockResolvedValue('sk-test-key') };
    service = new DocumentSuggestionService(
      invoiceExtraction as unknown as InvoiceExtractionService,
      orchestrator as unknown as ChatOrchestratorService,
      cloudProposeTools,
      cloudCredentials as unknown as CloudCredentialsService,
    );
  });

  it('throws NotFoundException, with zero side effects, when no credential is configured for the provider', async () => {
    cloudCredentials.getDecryptedKey.mockRejectedValueOnce(
      new NotFoundException('No CLAUDE credential is configured for this company.'),
    );
    await expect(service.suggest(company, CloudModelProvider.CLAUDE, pdfFile())).rejects.toThrow(
      NotFoundException,
    );
    expect(orchestrator.runTurn).not.toHaveBeenCalled();
  });

  it('calls runTurn() with an empty history — a genuine one-shot turn, no ChatSession involved', async () => {
    orchestrator.runTurn.mockResolvedValueOnce([]);
    await service.suggest(company, CloudModelProvider.CLAUDE, pdfFile());
    expect(orchestrator.runTurn).toHaveBeenCalledWith(
      company,
      [],
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ tools: cloudProposeTools, modelName: 'claude-opus-5' }),
    );
  });

  it('extracts the last propose_ecriture tool result as the confirmable proposal', async () => {
    const proposal = {
      dto: { journalId: 'j1' },
      warnings: [],
      assumptions: ['guessed the account'],
    };
    const produced: OrchestratedMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'propose_ecriture', arguments: {} }],
      },
      {
        role: 'tool',
        content: JSON.stringify(proposal),
        toolName: 'propose_ecriture',
        toolCallId: 'c1',
      },
    ];
    orchestrator.runTurn.mockResolvedValueOnce(produced);
    const result = await service.suggest(company, CloudModelProvider.CLAUDE, pdfFile());
    expect(result.proposal).toEqual(proposal);
    expect(result.message).toBeNull();
  });

  it("falls back to the assistant's own text when no proposal was produced", async () => {
    const produced: OrchestratedMessage[] = [
      {
        role: 'assistant',
        content: 'Il me manque le montant de la facture pour proposer une écriture.',
      },
    ];
    orchestrator.runTurn.mockResolvedValueOnce(produced);
    const result = await service.suggest(company, CloudModelProvider.CLAUDE, pdfFile());
    expect(result.proposal).toBeNull();
    expect(result.message).toContain('montant');
  });

  it('treats a rejected proposal ({ error }) as no proposal, not a crash', async () => {
    const produced: OrchestratedMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'propose_ecriture', arguments: {} }],
      },
      {
        role: 'tool',
        content: JSON.stringify({ error: 'Unbalanced écriture.' }),
        toolName: 'propose_ecriture',
        toolCallId: 'c1',
      },
      { role: 'assistant', content: "La proposition n'était pas équilibrée, je recommence." },
    ];
    orchestrator.runTurn.mockResolvedValueOnce(produced);
    const result = await service.suggest(company, CloudModelProvider.CLAUDE, pdfFile());
    expect(result.proposal).toBeNull();
    expect(result.message).toContain('recommence');
  });

  it('uses deepseek-v4-pro as the model name for the DEEPSEEK provider', async () => {
    orchestrator.runTurn.mockResolvedValueOnce([]);
    await service.suggest(company, CloudModelProvider.DEEPSEEK, pdfFile());
    expect(orchestrator.runTurn).toHaveBeenCalledWith(
      company,
      [],
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ modelName: 'deepseek-v4-pro' }),
    );
  });
});
