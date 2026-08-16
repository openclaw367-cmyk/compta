import { CompanyContext } from '../../../common/tenant/company-context';
import { LocalToolSpec } from '../local-model/local-model.types';

/**
 * A tool the chatbot may call. `execute` is a THIN DISPATCH onto an
 * existing, already-tested domain service method — see read-tools.service.ts
 * for the enforced invariant this interface exists to make easy to follow:
 * no tool's `execute` may contain its own aggregation, classification, or
 * money arithmetic. If a question needs data no existing service exposes,
 * the fix is a new/extended service method (reviewed and tested on its
 * own), never inline logic here.
 *
 * `execute` may throw (a NestJS exception, same as any service) — the
 * orchestrator catches it and feeds the message back to the model as a
 * tool-result error, letting the model retry or explain the failure. This
 * is deliberately not swallowed into a generic "something went wrong":
 * the model sees the SAME error a human would get calling the same
 * endpoint (e.g. "Fiscal year xyz not found"), because it IS that error.
 */
export interface ChatTool {
  spec: LocalToolSpec;
  execute: (company: CompanyContext, args: Record<string, unknown>) => Promise<unknown>;
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Argument "${key}" is required and must be a non-empty string.`);
  }
  return value;
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Argument "${key}" must be a string if provided.`);
  }
  return value;
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  return value === true;
}

/**
 * Extracts a model-readable message from a thrown error — found live,
 * not by inspection: Nest's `ValidationPipe`/class-validator throw a
 * `BadRequestException` constructed from an ARRAY of constraint messages
 * (e.g. "debit must be a valid money string", "lignes must contain at
 * least 2 elements"), and for that array-constructed form
 * `err.message` degrades to the generic HTTP status text ("Bad Request
 * Exception") — the real per-field messages only live in
 * `err.getResponse().message`. A tool-calling loop that feeds the model
 * "Bad Request Exception" with no detail cannot self-correct; this was
 * observed live during Phase 2 verification (a malformed propose_ecriture
 * call — wrong money format, wrong line count — got this generic message
 * twice in a row and the model gave up rather than fixing the specific
 * problem). Every other exception in this app (NotFoundException etc.)
 * is constructed with a single string, where `.message` already IS that
 * string — this helper is a strict superset, never worse than the old
 * `err.message` fallback.
 */
export function extractErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'getResponse' in err) {
    const getResponse = (err as { getResponse?: unknown }).getResponse;
    if (typeof getResponse === 'function') {
      const response: unknown = getResponse.call(err);
      if (response && typeof response === 'object' && 'message' in response) {
        const message = response.message;
        if (Array.isArray(message)) {
          return message.join('; ');
        }
        if (typeof message === 'string') {
          return message;
        }
      }
    }
  }
  return err instanceof Error ? err.message : String(err);
}
