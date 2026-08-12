import type { MCPToolResult } from "../types/index.js";
import type QuickBooks from "node-quickbooks";
import type { QboLookupCache } from "../client/cache.js";

export type QboCompanyKey = string & { readonly __brand: "QboCompanyKey" };

export type QboPrincipal =
  | { readonly kind: "authenticated"; readonly id: string }
  | { readonly kind: "anonymous"; readonly id: "anonymous" };

export interface OutputPolicy {
  readonly mode: "stdio" | "http";
  readonly executionEnvironment: "local" | "lambda" | "node";
}

export interface QboCompanyRuntime {
  readonly companyKey: QboCompanyKey;
  readonly companyId: string;
  readonly lookupCache: QboLookupCache;
  createClientAttempt(): Promise<QboClientAttempt>;
  refreshAfterAuthError(failedCredentialFingerprint: string): Promise<void>;
  clearCaches(): void;
}

export interface QboClientAttempt {
  readonly client: QuickBooks;
  readonly credentialFingerprint: string;
}

export interface QboRequestContext {
  readonly requestId: string;
  readonly principal: QboPrincipal;
  readonly transport: "stdio" | "http";
  readonly output: OutputPolicy;
  readonly runtime: QboCompanyRuntime;
}

export function companyKey(value: string): QboCompanyKey {
  if (!value.trim()) throw new Error("Company key must not be empty");
  return value as QboCompanyKey;
}

export const anonymousPrincipal: QboPrincipal = {
  kind: "anonymous",
  id: "anonymous",
};