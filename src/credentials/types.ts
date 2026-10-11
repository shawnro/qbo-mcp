// Credential provider types for QuickBooks OAuth management

import { parseCredentialMode } from "../config.js";
import type { CredentialMode } from "../config.js";

export type { CredentialMode } from "../config.js";

/**
 * QuickBooks OAuth credentials structure
 */
export interface QBCredentials {
  client_id: string;
  client_secret: string;
  redirect_url: string;
  access_token: string;
  refresh_token: string;
  company_id?: string; // Stored in credentials for local mode
}

const REQUIRED_CREDENTIAL_FIELDS = [
  "client_id",
  "client_secret",
  "redirect_url",
  "access_token",
  "refresh_token",
] as const;

export function parseCredentialPayload(
  value: unknown,
  source = "QuickBooks credential payload"
): QBCredentials {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${source} must be a JSON object`);
  }

  const record = value as Record<string, unknown>;
  for (const field of REQUIRED_CREDENTIAL_FIELDS) {
    if (typeof record[field] !== "string" || !record[field].trim()) {
      throw new Error(`${source} field "${field}" must be a non-empty string`);
    }
  }
  if (
    record.company_id !== undefined
    && (typeof record.company_id !== "string" || !record.company_id.trim())
  ) {
    throw new Error(`${source} field "company_id" must be a non-empty string when provided`);
  }

  return {
    client_id: record.client_id as string,
    client_secret: record.client_secret as string,
    redirect_url: record.redirect_url as string,
    access_token: record.access_token as string,
    refresh_token: record.refresh_token as string,
    ...(record.company_id !== undefined && { company_id: record.company_id as string }),
  };
}

export function parseCredentialJson(
  content: string,
  source = "QuickBooks credential payload"
): QBCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`${source} must contain valid JSON`);
  }
  return parseCredentialPayload(parsed, source);
}

/**
 * Abstract credential provider interface
 * Implemented by AWS and Local providers
 */
export interface CredentialProvider {
  /**
   * Stable, non-secret identity of the credential storage location.
   * Providers that address the same OAuth grant must return the same scope.
   */
  getRefreshLockScope(): string;

  /**
   * Get current OAuth credentials
   */
  getCredentials(): Promise<QBCredentials>;

  /**
   * Save updated credentials (e.g., after token refresh)
   */
  saveCredentials(credentials: QBCredentials): Promise<void>;

  /**
   * Get the QuickBooks company/realm ID
   */
  getCompanyId(): Promise<string>;

  /**
   * Check if credentials are configured and available
   */
  isConfigured(): Promise<boolean>;
}

/**
 * Get credential mode from environment
 * Defaults to "local" if not specified
 */
export function getCredentialMode(
  env: Record<string, string | undefined> = process.env
): CredentialMode {
  return parseCredentialMode(env);
}
