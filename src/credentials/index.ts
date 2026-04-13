// Credential provider factory and exports

export type { QBCredentials, CredentialProvider, CredentialMode } from "./types.js";
export { getCredentialMode } from "./types.js";
export { AWSCredentialProvider } from "./aws-provider.js";
export { LocalCredentialProvider } from "./local-provider.js";

import { getCredentialMode } from "./types.js";
import type { CredentialProvider } from "./types.js";
import { AWSCredentialProvider } from "./aws-provider.js";
import { LocalCredentialProvider } from "./local-provider.js";

// Singleton provider instance
let providerInstance: CredentialProvider | null = null;

/**
 * Get the credential provider based on QBO_CREDENTIAL_MODE environment variable
 * - "aws": Uses AWS Secrets Manager and SSM Parameter Store
 * - "azure": Uses Azure Key Vault (lazily loaded to avoid Lambda bundling)
 * - "local" (default): Uses local file storage at ~/.quickbooks-mcp/credentials.json
 */
export async function getCredentialProvider(): Promise<CredentialProvider> {
  if (!providerInstance) {
    const mode = getCredentialMode();
    if (mode === "aws") {
      providerInstance = new AWSCredentialProvider();
    } else if (mode === "azure") {
      const { AzureCredentialProvider } = await import("./azure-provider.js");
      providerInstance = new AzureCredentialProvider();
    } else {
      providerInstance = new LocalCredentialProvider();
    }
  }
  return providerInstance;
}

/**
 * Clear the cached provider instance (for testing or credential mode changes)
 */
export function clearProviderCache(): void {
  providerInstance = null;
}

/**
 * Check if we're using local credential mode
 */
export function isLocalMode(): boolean {
  return getCredentialMode() === "local";
}

/**
 * Check if we're using AWS credential mode
 */
export function isAWSMode(): boolean {
  return getCredentialMode() === "aws";
}

/**
 * Check if we're using Azure credential mode
 */
export function isAzureMode(): boolean {
  return getCredentialMode() === "azure";
}
