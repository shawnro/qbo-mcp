import {
  createCredentialProvider,
  getActiveProfile,
  getActiveProfileName,
  getCredentialMode,
  hasProfiles,
} from "../credentials/index.js";
import { parseBooleanSetting } from "../config.js";
import { clearLookupCache, createLookupCache } from "../client/cache.js";
import type { QboLookupCache } from "../client/cache.js";
import { DefaultQboCompanyRuntime } from "./company-runtime.js";
import {
  createFileRefreshAttemptJournal,
  createFileRefreshCoordinator,
} from "./file-refresh-coordinator.js";
import { companyKey } from "./types.js";
import type { QboClientAttempt, QboCompanyKey, QboCompanyRuntime } from "./types.js";

interface LocalRuntimeSelection {
  cacheKey: string;
  companyKeyPrefix: string;
  mode: string;
  secretName?: string;
  companyId?: string;
}

export class LocalQboCompanyRuntime implements QboCompanyRuntime {
  private readonly fallbackLookupCache = createLookupCache();
  private readonly runtimes = new Map<string, Promise<QboCompanyRuntime>>();
  private current: QboCompanyRuntime | undefined;

  get companyKey(): QboCompanyKey {
    return this.current?.companyKey ?? companyKey("local:uninitialized");
  }

  get companyId(): string {
    return this.current?.companyId ?? "";
  }

  get lookupCache(): QboLookupCache {
    return this.current?.lookupCache ?? this.fallbackLookupCache;
  }

  async createClientAttempt(): Promise<QboClientAttempt> {
    const runtime = await this.getActiveRuntime();
    this.current = runtime;
    return runtime.createClientAttempt();
  }

  async refreshAfterAuthError(failedCredentialFingerprint: string): Promise<void> {
    const runtime = this.current ?? await this.getActiveRuntime();
    await runtime.refreshAfterAuthError(failedCredentialFingerprint);
  }

  clearCaches(): void {
    for (const runtime of this.runtimes.values()) {
      void runtime.then((resolved) => resolved.clearCaches(), () => undefined);
    }
    this.runtimes.clear();
    this.current = undefined;
    clearLookupCache(this.fallbackLookupCache);
  }

  private async getActiveRuntime(): Promise<QboCompanyRuntime> {
    const selection = activeSelection();
    let runtime = this.runtimes.get(selection.cacheKey);
    if (!runtime) {
      const initializing = createRuntime(selection);
      const guarded = initializing.catch((error) => {
        if (this.runtimes.get(selection.cacheKey) === guarded) {
          this.runtimes.delete(selection.cacheKey);
        }
        throw error;
      });
      runtime = guarded;
      this.runtimes.set(selection.cacheKey, guarded);
    }
    return runtime;
  }
}

function activeSelection(): LocalRuntimeSelection {
  if (hasProfiles()) {
    const name = getActiveProfileName();
    const profile = getActiveProfile();
    if (!name || !profile) throw new Error("Profiles loaded but no active profile set.");
    return {
      cacheKey: `profile:${name}:${profile.mode}:${profile.secret_name ?? "default"}:${profile.company_id ?? "provider"}`,
      companyKeyPrefix: `local:${name}`,
      mode: profile.mode,
      secretName: profile.secret_name,
      companyId: profile.company_id,
    };
  }

  const mode = getCredentialMode();
  const secretName = process.env.QBO_SECRET_NAME;
  return {
    cacheKey: `single:${mode}:${secretName ?? "default"}`,
    companyKeyPrefix: `local:single:${mode}:${secretName ?? "default"}`,
    mode,
    secretName,
  };
}

async function createRuntime(selection: LocalRuntimeSelection): Promise<QboCompanyRuntime> {
  const provider = await createCredentialProvider(selection.mode, selection.secretName);
  if (!await provider.isConfigured()) {
    throw new Error(selection.mode === "local"
      ? "QuickBooks credentials not configured. Run the qbo_authenticate tool to set up OAuth."
      : `QuickBooks credentials not configured. Check your credential provider configuration (current mode: ${selection.mode}).`);
  }
  const companyId = selection.companyId ?? await provider.getCompanyId();
  return new DefaultQboCompanyRuntime({
    companyKey: companyKey(`${selection.companyKeyPrefix}:${companyId}`),
    companyId,
    provider,
    sandbox: parseBooleanSetting("QBO_SANDBOX"),
    refreshCoordinator: createFileRefreshCoordinator(provider),
    refreshAttemptJournal: createFileRefreshAttemptJournal(provider),
  });
}