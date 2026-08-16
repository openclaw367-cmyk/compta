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
