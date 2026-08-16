import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompanyContext } from '../../common/tenant/company-context';
import { LOCAL_MODEL_PORT, LocalModelPort } from './local-model/local-model.port';
import { LocalChatMessage } from './local-model/local-model.types';
import { ReadToolsService } from './tools/read-tools.service';

/**
 * Hard cap on tool-call round-trips within one user turn. Exists because a
 * weak local model can loop (call a tool, misread its result, call the
 * same tool again) — this bounds the damage to latency, never to
 * correctness, since no tool in Phase 1's registry can write anything.
 * See CLAUDE.md "AI chatbot" — this is exactly the kind of "a wrong
 * proposal from a weak local model must be caught by the identical
 * machinery" concern the design called out, applied to reasoning
 * failures rather than write attempts.
 */
const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `Tu es l'assistant comptable local de cette entreprise, intégré à un logiciel de comptabilité française/monégasque à double entrée.

Tu n'as accès qu'à des outils de LECTURE : balance, grand livre, comptes, journaux, exercices, taux de TVA, déclaration de TVA, liasse fiscale, flux de trésorerie, analyse financière, résultat fiscal, immobilisations, écritures. Utilise TOUJOURS un outil pour obtenir un chiffre réel avant de répondre — ne calcule et n'invente jamais un montant toi-même. Si un outil te renvoie une erreur, corrige tes arguments (par exemple en appelant list_fiscal_years ou search_accounts pour trouver le bon id) plutôt que de deviner.

Tu ne peux, à ce stade, RIEN écrire dans la comptabilité : aucun outil d'écriture n'existe dans cette version. Si on te demande de saisir, corriger ou valider une écriture, explique clairement que cette fonctionnalité n'est pas encore disponible et oriente vers l'écran de saisie manuelle.

Réponds en français, de façon concise et factuelle, avec les montants au format "1 234,56 €".`;

export interface OrchestratedMessage {
  role: 'assistant' | 'tool';
  content: string;
  toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  toolName?: string;
  toolCallId?: string;
}

/**
 * The tool-calling loop: send the conversation + tool specs to the local
 * model, execute whatever tools it asks for, feed results back, repeat
 * until it produces a final answer (or the iteration cap is hit). Every
 * message produced here — including tool calls and their results — is
 * returned for the caller to persist, so the full trace survives a page
 * reload and the confirmation-gate discipline (Phase 2) has a complete
 * record of exactly what was proposed and why.
 */
@Injectable()
export class ChatOrchestratorService {
  constructor(
    @Inject(LOCAL_MODEL_PORT) private readonly model: LocalModelPort,
    private readonly readTools: ReadToolsService,
    private readonly config: ConfigService,
  ) {}

  async runTurn(
    company: CompanyContext,
    history: LocalChatMessage[],
    userContent: string,
  ): Promise<OrchestratedMessage[]> {
    const modelName = this.config.get<string>('LOCAL_MODEL_NAME') ?? 'qwen2.5:7b';
    const tools = this.readTools.getAll().map((t) => t.spec);
    const messages: LocalChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userContent },
    ];
    const produced: OrchestratedMessage[] = [];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const result = await this.model.complete({ model: modelName, messages, tools });

      if (result.toolCalls.length === 0) {
        produced.push({ role: 'assistant', content: result.content });
        return produced;
      }

      messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls });
      produced.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls });

      for (const call of result.toolCalls) {
        const outcome = await this.readTools.execute(company, call.name, call.arguments);
        const resultContent = JSON.stringify(outcome.ok ? outcome.value : { error: outcome.error });
        messages.push({
          role: 'tool',
          content: resultContent,
          toolName: call.name,
          toolCallId: call.id,
        });
        produced.push({
          role: 'tool',
          content: resultContent,
          toolName: call.name,
          toolCallId: call.id,
        });
      }
    }

    produced.push({
      role: 'assistant',
      content:
        "Je n'ai pas réussi à répondre en un nombre raisonnable d'étapes d'outils. Essayez de " +
        'reformuler ou de préciser votre question (par exemple en donnant directement un ' +
        'exercice ou un numéro de compte).',
    });
    return produced;
  }
}
