import { createHash } from "node:crypto";
import type { CredentialProvider, QBCredentials } from "../credentials/types.js";
import { refreshAccessToken } from "../credentials/oauth-client.js";
import type { RefreshCoordinator } from "./refresh-coordinator.js";

export function credentialFingerprint(credentials: QBCredentials): string {
  return createHash("sha256")
    .update(credentials.access_token)
    .update("\0")
    .update(credentials.refresh_token)
    .digest("hex");
}

export interface RefreshCredentialsOptions {
  provider: CredentialProvider;
  coordinator: RefreshCoordinator;
  attemptJournal?: RefreshAttemptJournal;
  failedCredentialFingerprint: string;
  refresh?: (credentials: QBCredentials) => Promise<QBCredentials>;
  saveAttempts?: number;
}

export interface RefreshAttemptJournal {
  assertResolved(currentCredentialFingerprint: string): Promise<void>;
  begin(credentialFingerprint: string): Promise<void>;
  complete(): Promise<void>;
}

export async function refreshCredentialsAfterAuthError(
  options: RefreshCredentialsOptions
): Promise<QBCredentials> {
  return options.coordinator.run(async () => {
    const current = await options.provider.getCredentials();
    const currentFingerprint = credentialFingerprint(current);
    await options.attemptJournal?.assertResolved(currentFingerprint);
    if (currentFingerprint !== options.failedCredentialFingerprint) return current;

    await options.attemptJournal?.begin(currentFingerprint);
    const refreshed = await (options.refresh ?? refreshAccessToken)(current);
    const saveAttempts = options.saveAttempts ?? 2;
    let lastError: unknown;
    for (let attempt = 0; attempt < saveAttempts; attempt++) {
      try {
        await options.provider.saveCredentials(refreshed);
        await options.attemptJournal?.complete();
        return refreshed;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error("Refreshed QuickBooks credentials could not be persisted", {
      cause: lastError,
    });
  });
}