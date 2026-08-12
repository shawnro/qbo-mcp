import { createHash } from "node:crypto";
import QuickBooks from "node-quickbooks";
import type { CredentialProvider, QBCredentials } from "../credentials/types.js";
import { refreshAccessToken } from "../credentials/oauth-client.js";
import { clearLookupCache, createLookupCache } from "../client/cache.js";
import type { QboLookupCache } from "../client/cache.js";
import type { QboClientAttempt, QboCompanyKey, QboCompanyRuntime } from "./types.js";
import { InProcessRefreshCoordinator } from "./refresh-coordinator.js";
import type { RefreshCoordinator } from "./refresh-coordinator.js";

export interface CompanyRuntimeOptions {
  companyKey: QboCompanyKey;
  companyId: string;
  provider: CredentialProvider;
  sandbox: boolean;
  refreshCoordinator?: RefreshCoordinator;
  refresh?: (credentials: QBCredentials) => Promise<QBCredentials>;
  saveAttempts?: number;
}

function credentialFingerprint(credentials: QBCredentials): string {
  return createHash("sha256")
    .update(credentials.access_token)
    .update("\0")
    .update(credentials.refresh_token)
    .digest("hex");
}

export class DefaultQboCompanyRuntime implements QboCompanyRuntime {
  readonly companyKey: QboCompanyKey;
  readonly companyId: string;
  readonly lookupCache: QboLookupCache;
  private readonly provider: CredentialProvider;
  private readonly sandbox: boolean;
  private readonly coordinator: RefreshCoordinator;
  private readonly refresh: (credentials: QBCredentials) => Promise<QBCredentials>;
  private readonly saveAttempts: number;

  constructor(options: CompanyRuntimeOptions) {
    this.companyKey = options.companyKey;
    this.companyId = options.companyId;
    this.lookupCache = createLookupCache();
    this.provider = options.provider;
    this.sandbox = options.sandbox;
    this.coordinator = options.refreshCoordinator ?? new InProcessRefreshCoordinator();
    this.refresh = options.refresh ?? refreshAccessToken;
    this.saveAttempts = options.saveAttempts ?? 2;
  }

  async createClientAttempt(): Promise<QboClientAttempt> {
    const credentials = await this.provider.getCredentials();
    return {
      client: new QuickBooks(
        credentials.client_id,
        credentials.client_secret,
        credentials.access_token,
        false,
        this.companyId,
        this.sandbox,
        false,
        null,
        "2.0",
        credentials.refresh_token
      ),
      credentialFingerprint: credentialFingerprint(credentials),
    };
  }

  async refreshAfterAuthError(failedCredentialFingerprint: string): Promise<void> {
    await this.coordinator.run(async () => {
      const current = await this.provider.getCredentials();
      if (credentialFingerprint(current) !== failedCredentialFingerprint) return;

      const refreshed = await this.refresh(current);
      let lastError: unknown;
      for (let attempt = 0; attempt < this.saveAttempts; attempt++) {
        try {
          await this.provider.saveCredentials(refreshed);
          return;
        } catch (error) {
          lastError = error;
        }
      }
      throw new Error("Refreshed QuickBooks credentials could not be persisted", {
        cause: lastError,
      });
    });
  }

  clearCaches(): void {
    clearLookupCache(this.lookupCache);
  }
}