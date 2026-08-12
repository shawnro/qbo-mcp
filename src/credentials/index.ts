// Credential provider factory and exports

export type { QBCredentials, CredentialProvider, CredentialMode } from "./types.js";
export { getCredentialMode } from "./types.js";
export { AWSCredentialProvider } from "./aws-provider.js";
export { LocalCredentialProvider } from "./local-provider.js";
export {
  loadProfiles,
  hasProfiles,
  listProfiles,
  getActiveProfileName,
  getActiveProfile,
  getProfile,
  setActiveProfile,
} from "./profiles.js";
export type { QBProfile, QBProfileConfig, QBUploadRoot } from "./profiles.js";

import { getCredentialMode } from "./types.js";
import type { CredentialProvider } from "./types.js";
import type { QBProfile } from "./profiles.js";
import { AWSCredentialProvider } from "./aws-provider.js";
import { LocalCredentialProvider } from "./local-provider.js";
import {
  hasProfiles,
  getActiveProfile,
  getActiveProfileName,
  getProfile,
  setActiveProfile,
} from "./profiles.js";
import { runLocalOperation } from "../runtime/local-operation-coordinator.js";

// Singleton provider instance
let providerInstance: CredentialProvider | null = null;

/**
 * Create a credential provider for a given mode and optional config.
 */
export async function createCredentialProvider(
  mode: string,
  secretName?: string
): Promise<CredentialProvider> {
  if (mode === "aws") {
    return new AWSCredentialProvider({ secretName });
  } else if (mode === "azure") {
    const { AzureCredentialProvider } = await import("./azure-provider.js");
    return new AzureCredentialProvider(secretName);
  } else {
    return new LocalCredentialProvider();
  }
}

/**
 * Get the credential provider.
 * If profiles are loaded, creates a provider based on the active profile.
 * Otherwise falls back to env-var-based mode selection (backward compat).
 */
export async function getCredentialProvider(): Promise<CredentialProvider> {
  if (!providerInstance) {
    if (hasProfiles()) {
      const profile = getActiveProfile();
      if (!profile) {
        throw new Error("Profiles loaded but no active profile set.");
      }
      providerInstance = await createCredentialProvider(profile.mode, profile.secret_name);
    } else {
      providerInstance = await createCredentialProvider(getCredentialMode());
    }
  }
  return providerInstance;
}

/**
 * Resolve the effective company ID.
 * Priority: profile override > provider's getCompanyId() (which checks secret payload > env var)
 */
export async function resolveCompanyId(): Promise<string> {
  if (hasProfiles()) {
    const profile = getActiveProfile();
    if (profile?.company_id) {
      return profile.company_id;
    }
  }

  const provider = await getCredentialProvider();
  return provider.getCompanyId();
}

/**
 * Clear the cached provider instance (for testing or credential mode changes)
 */
export function clearProviderCache(): void {
  providerInstance = null;
}

/**
 * Switch the active profile. Clears provider singleton so the next
 * getCredentialProvider() call creates a fresh provider for the new profile.
 * Returns the previous profile name for rollback support.
 */
export function switchProfile(name: string): string {
  const previousName = getActiveProfileName();
  setActiveProfile(name); // throws if profile doesn't exist
  clearProviderCache();
  return previousName || name;
}

export async function switchProfileAtomically<T>(
  name: string,
  validate: (profile: QBProfile) => Promise<T>,
  activate: () => void
): Promise<{ previousName: string; value: T }> {
  const run = async () => {
    const profile = getProfile(name);
    const previousName = getActiveProfileName() ?? name;
    const value = await validate(profile);

    setActiveProfile(name);
    clearProviderCache();
    activate();
    return { previousName, value };
  };

  return runLocalOperation(run);
}

/**
 * Check if we're using local credential mode
 */
export function isLocalMode(): boolean {
  if (hasProfiles()) {
    const profile = getActiveProfile();
    return profile?.mode === "local";
  }
  return getCredentialMode() === "local";
}

/**
 * Check if we're using AWS credential mode
 */
export function isAWSMode(): boolean {
  if (hasProfiles()) {
    const profile = getActiveProfile();
    return profile?.mode === "aws";
  }
  return getCredentialMode() === "aws";
}

/**
 * Check if we're using Azure credential mode
 */
export function isAzureMode(): boolean {
  if (hasProfiles()) {
    const profile = getActiveProfile();
    return profile?.mode === "azure";
  }
  return getCredentialMode() === "azure";
}
