// Azure Key Vault credential provider for QuickBooks OAuth management

import type { CredentialProvider, QBCredentials } from "./types.js";

// Azure SDK types — imported lazily to avoid bundling in Lambda
import type { SecretClient } from "@azure/keyvault-secrets";

/**
 * Azure Key Vault credential provider
 * Stores all credentials (including company ID) in a single Key Vault secret.
 *
 * Constructor is cheap and side-effect-free — DefaultAzureCredential and
 * SecretClient are created lazily on first real operation.
 */
export class AzureCredentialProvider implements CredentialProvider {
  private readonly vaultUrl: string | undefined;
  private readonly secretName: string;
  private client: SecretClient | null = null;

  constructor(secretName?: string) {
    this.vaultUrl = process.env.AZURE_KEY_VAULT_URL || undefined;
    this.secretName = secretName || process.env.QBO_SECRET_NAME || "qbo-credentials";
  }

  /**
   * Lazily initialize the SecretClient on first use.
   * Throws if AZURE_KEY_VAULT_URL is not set or malformed.
   */
  private async getSecretClient(): Promise<SecretClient> {
    if (this.client) {
      return this.client;
    }

    if (!this.vaultUrl) {
      throw new Error(
        "AZURE_KEY_VAULT_URL is not set. " +
          "Set this environment variable to your Key Vault URI " +
          "(e.g. https://myvault.vault.azure.net)."
      );
    }

    const { SecretClient } = await import("@azure/keyvault-secrets");
    const { DefaultAzureCredential } = await import("@azure/identity");

    this.client = new SecretClient(this.vaultUrl, new DefaultAzureCredential());
    return this.client;
  }

  async getCredentials(): Promise<QBCredentials> {
    const client = await this.getSecretClient();
    const secret = await client.getSecret(this.secretName);

    if (!secret.value) {
      throw new Error(`Key Vault secret "${this.secretName}" has no value`);
    }

    return JSON.parse(secret.value) as QBCredentials;
  }

  async saveCredentials(credentials: QBCredentials): Promise<void> {
    const client = await this.getSecretClient();
    await client.setSecret(this.secretName, JSON.stringify(credentials));
  }

  async getCompanyId(): Promise<string> {
    // Primary: read from the credential secret
    const credentials = await this.getCredentials();
    if (credentials.company_id) {
      return credentials.company_id;
    }

    // Fallback: environment variable
    const envCompanyId = process.env.QBO_COMPANY_ID;
    if (envCompanyId) {
      return envCompanyId;
    }

    throw new Error(
      'Company ID not found. Add "company_id" to your Key Vault credential secret, ' +
        "or set the QBO_COMPANY_ID environment variable."
    );
  }

  async isConfigured(): Promise<boolean> {
    // Missing env var — not configured, not an error
    if (!this.vaultUrl) {
      return false;
    }

    try {
      const credentials = await this.getCredentials();
      // Check that company ID is resolvable (secret field or env var)
      return !!credentials.company_id || !!process.env.QBO_COMPANY_ID;
    } catch (error: unknown) {
      // Secret not found — not configured
      if (isNotFoundError(error)) {
        return false;
      }
      // Auth/RBAC failures, malformed URL, transient errors — surface to caller
      throw error;
    }
  }
}

/**
 * Check if an Azure SDK error indicates a missing secret (404).
 */
function isNotFoundError(error: unknown): boolean {
  if (error && typeof error === "object" && "statusCode" in error) {
    return (error as { statusCode: number }).statusCode === 404;
  }
  return false;
}
