// QuickBooks client authentication and session management

import QuickBooks from "node-quickbooks";
import { getCredentialProvider, getCredentialMode, isLocalMode } from "../credentials/index.js";
import type { QBCredentials, CredentialProvider } from "../credentials/index.js";
import { refreshAccessToken } from "../credentials/oauth-client.js";
import { clearLookupCache } from "./cache.js";
import { isQBError, extractQBErrorInfo } from "../types/index.js";

// Sandbox mode for development/testing (read lazily so dotenv has time to load)
const isSandbox = () => process.env.QBO_SANDBOX === "true";

// QuickBooks client and credentials state
let qbo: QuickBooks | null = null;
let credentials: QBCredentials | null = null;
let companyId: string | null = null;
let provider: CredentialProvider | null = null;

// Export companyId getter for tools that need it
export function getCompanyIdValue(): string | null {
  return companyId;
}

// Clear cached credentials (call on auth errors to force fresh fetch)
export function clearCredentialsCache(): void {
  qbo = null;
  credentials = null;
  clearLookupCache();
}

// Check if error is an authentication failure
export function isAuthError(error: unknown): boolean {
  // QBO Fault-style errors (from API responses)
  if (isQBError(error)) {
    const { code } = extractQBErrorInfo(error);
    return code === '3200' || code === '401';
  }
  // HTTP status code errors (e.g. from node-quickbooks or axios)
  if (error && typeof error === 'object') {
    const statusCode = (error as Record<string, unknown>).statusCode
      ?? (error as Record<string, unknown>).status;
    if (statusCode === 401 || statusCode === 403) return true;
  }
  // Error message heuristics
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('authenticationfailed') || msg.includes('token expired') ||
        msg.includes('unauthorized')) return true;
  }
  return false;
}

// Initialize or refresh the QuickBooks session
export async function getClient(): Promise<QuickBooks> {
  // Get credential provider (singleton)
  if (!provider) {
    provider = await getCredentialProvider();
  }

  // Check if credentials are configured
  const isConfigured = await provider.isConfigured();
  if (!isConfigured) {
    if (isLocalMode()) {
      throw new Error(
        "QuickBooks credentials not configured. Run the qbo_authenticate tool to set up OAuth."
      );
    } else {
      throw new Error(
        "QuickBooks credentials not configured. Check your credential provider configuration " +
          `(current mode: ${getCredentialMode()}).`
      );
    }
  }

  // ALWAYS fetch fresh credentials from provider (like Python version)
  credentials = await provider.getCredentials();

  // Load company ID from provider if not cached
  if (!companyId) {
    companyId = await provider.getCompanyId();
  }

  // Create QuickBooks client with current tokens
  qbo = new QuickBooks(
    credentials.client_id,
    credentials.client_secret,
    credentials.access_token,
    false, // No OAuth 1.0 token secret for OAuth 2.0
    companyId,
    isSandbox(), // Use sandbox if QBO_SANDBOX=true
    false, // Debug mode off
    null,  // Use latest minor version
    "2.0", // OAuth 2.0
    credentials.refresh_token
  );

  return qbo;
}

// Refresh tokens with Intuit and persist to credential provider.
// Call this on auth errors before retrying.
export async function refreshTokens(): Promise<void> {
  if (!provider) {
    provider = await getCredentialProvider();
  }
  if (!credentials) {
    credentials = await provider.getCredentials();
  }

  // Use intuit-oauth library for refresh (works for all credential modes)
  credentials = await refreshAccessToken(credentials);
  await provider.saveCredentials(credentials);

  // Clear cached client so getClient() rebuilds with new tokens
  qbo = null;
}
