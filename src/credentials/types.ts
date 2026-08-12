// Credential provider types for QuickBooks OAuth management

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

/**
 * Abstract credential provider interface
 * Implemented by AWS and Local providers
 */
export interface CredentialProvider {
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
 * Credential mode - determines which provider to use
 */
export type CredentialMode = "local" | "aws" | "azure";

/**
 * Get credential mode from environment
 * Defaults to "local" if not specified
 */
export function getCredentialMode(
  env: Record<string, string | undefined> = process.env
): CredentialMode {
  const mode = env.QBO_CREDENTIAL_MODE?.toLowerCase();
  if (mode === "aws") {
    return "aws";
  }
  if (mode === "azure") {
    return "azure";
  }
  return "local";
}
