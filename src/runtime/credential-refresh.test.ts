import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CredentialProvider, QBCredentials } from "../credentials/types.js";
import {
  credentialFingerprint,
  refreshCredentialsAfterAuthError,
} from "./credential-refresh.js";
import {
  FileRefreshAttemptJournal,
  FileRefreshCoordinator,
  IndeterminateCredentialRefreshError,
} from "./file-refresh-coordinator.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), "qbo-refresh-integration-test-"));
  roots.push(root);
  return root;
}

function credentials(accessToken: string): QBCredentials {
  return {
    client_id: "client",
    client_secret: "secret",
    redirect_url: "http://localhost/callback",
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
  };
}

function sharedProvider(
  state: { current: QBCredentials },
  scope = "test:shared-grant"
): CredentialProvider {
  return {
    getRefreshLockScope: () => scope,
    getCredentials: async () => state.current,
    saveCredentials: async (value) => { state.current = value; },
    getCompanyId: async () => "123",
    isConfigured: async () => true,
  };
}

describe("refreshCredentialsAfterAuthError", () => {
  it("refreshes one credential generation exactly once across coordinators", async () => {
    const rootDir = await temporaryRoot();
    const state = { current: credentials("old") };
    const failedCredentialFingerprint = credentialFingerprint(state.current);
    const refresh = vi.fn().mockResolvedValue(credentials("new"));
    const options = { rootDir, pollIntervalMs: 5, waitTimeoutMs: 1_000 };

    const results = await Promise.all([
      refreshCredentialsAfterAuthError({
        provider: sharedProvider(state),
        coordinator: new FileRefreshCoordinator("test:shared-grant", options),
        failedCredentialFingerprint,
        refresh,
      }),
      refreshCredentialsAfterAuthError({
        provider: sharedProvider(state),
        coordinator: new FileRefreshCoordinator("test:shared-grant", options),
        failedCredentialFingerprint,
        refresh,
      }),
    ]);

    expect(refresh).toHaveBeenCalledOnce();
    expect(state.current).toEqual(credentials("new"));
    expect(results).toEqual([credentials("new"), credentials("new")]);
  });

  it("does not serialize refreshes for unrelated credential stores", async () => {
    const rootDir = await temporaryRoot();
    const firstState = { current: credentials("first-old") };
    const secondState = { current: credentials("second-old") };
    let active = 0;
    let maximumActive = 0;
    const refresh = async (current: QBCredentials) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return credentials(`${current.access_token}-new`);
    };

    await Promise.all([
      refreshCredentialsAfterAuthError({
        provider: sharedProvider(firstState, "test:first"),
        coordinator: new FileRefreshCoordinator("test:first", { rootDir }),
        failedCredentialFingerprint: credentialFingerprint(firstState.current),
        refresh,
      }),
      refreshCredentialsAfterAuthError({
        provider: sharedProvider(secondState, "test:second"),
        coordinator: new FileRefreshCoordinator("test:second", { rootDir }),
        failedCredentialFingerprint: credentialFingerprint(secondState.current),
        refresh,
      }),
    ]);

    expect(maximumActive).toBe(2);
  });

  it("recovers when persistence succeeded but its acknowledgement was lost", async () => {
    const rootDir = await temporaryRoot();
    const state = { current: credentials("old") };
    const failedCredentialFingerprint = credentialFingerprint(state.current);
    const stored = sharedProvider(state);
    const save = vi.spyOn(stored, "saveCredentials").mockImplementation(async (value) => {
      state.current = value;
      throw new Error("synthetic lost acknowledgement");
    });
    const refresh = vi.fn().mockResolvedValue(credentials("new"));
    const coordinator = new FileRefreshCoordinator("test:shared-grant", { rootDir });

    await expect(refreshCredentialsAfterAuthError({
      provider: stored,
      coordinator,
      failedCredentialFingerprint,
      refresh,
    })).rejects.toThrow("could not be persisted");
    expect(save).toHaveBeenCalledTimes(2);

    await expect(refreshCredentialsAfterAuthError({
      provider: stored,
      coordinator,
      failedCredentialFingerprint,
      refresh,
    })).resolves.toEqual(credentials("new"));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not replay an ambiguous refresh attempt", async () => {
    const rootDir = await temporaryRoot();
    const state = { current: credentials("old") };
    const failedCredentialFingerprint = credentialFingerprint(state.current);
    const refresh = vi.fn().mockRejectedValue(new Error("synthetic ambiguous response"));
    const coordinator = new FileRefreshCoordinator("test:shared-grant", { rootDir });
    const attemptJournal = new FileRefreshAttemptJournal("test:shared-grant", { rootDir });
    const options = {
      provider: sharedProvider(state),
      coordinator,
      attemptJournal,
      failedCredentialFingerprint,
      refresh,
    };

    await expect(refreshCredentialsAfterAuthError(options)).rejects.toThrow(
      "synthetic ambiguous response"
    );
    await expect(refreshCredentialsAfterAuthError(options)).rejects.toBeInstanceOf(
      IndeterminateCredentialRefreshError
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("lets reauthentication replace a refresh that acquired the lock first", async () => {
    const rootDir = await temporaryRoot();
    const state = { current: credentials("old") };
    const provider = sharedProvider(state);
    const failedCredentialFingerprint = credentialFingerprint(state.current);
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const refresh = vi.fn(async () => {
      await refreshGate;
      return credentials("refreshed");
    });
    const firstCoordinator = new FileRefreshCoordinator("test:shared-grant", { rootDir });
    const secondCoordinator = new FileRefreshCoordinator("test:shared-grant", {
      rootDir,
      pollIntervalMs: 5,
    });

    const refreshing = refreshCredentialsAfterAuthError({
      provider,
      coordinator: firstCoordinator,
      failedCredentialFingerprint,
      refresh,
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const reauthenticating = secondCoordinator.run(async () => {
      state.current = credentials("reauthenticated");
    });
    releaseRefresh();
    await Promise.all([refreshing, reauthenticating]);

    expect(state.current).toEqual(credentials("reauthenticated"));
  });

  it("skips refresh when reauthentication acquired the lock first", async () => {
    const rootDir = await temporaryRoot();
    const state = { current: credentials("old") };
    const provider = sharedProvider(state);
    const failedCredentialFingerprint = credentialFingerprint(state.current);
    let releaseReauthentication!: () => void;
    const reauthenticationGate = new Promise<void>((resolve) => {
      releaseReauthentication = resolve;
    });
    const firstCoordinator = new FileRefreshCoordinator("test:shared-grant", { rootDir });
    const secondCoordinator = new FileRefreshCoordinator("test:shared-grant", {
      rootDir,
      pollIntervalMs: 5,
    });
    let reauthenticationStarted = false;
    const reauthenticating = firstCoordinator.run(async () => {
      reauthenticationStarted = true;
      await reauthenticationGate;
      state.current = credentials("reauthenticated");
    });
    await vi.waitFor(() => expect(reauthenticationStarted).toBe(true));
    const refresh = vi.fn().mockResolvedValue(credentials("refreshed"));
    const refreshing = refreshCredentialsAfterAuthError({
      provider,
      coordinator: secondCoordinator,
      failedCredentialFingerprint,
      refresh,
    });
    releaseReauthentication();
    await Promise.all([reauthenticating, refreshing]);

    expect(refresh).not.toHaveBeenCalled();
    expect(state.current).toEqual(credentials("reauthenticated"));
  });
});