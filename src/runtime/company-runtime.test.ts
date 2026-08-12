import { describe, expect, it, vi } from "vitest";
import type { CredentialProvider, QBCredentials } from "../credentials/types.js";
import { DefaultQboCompanyRuntime } from "./company-runtime.js";
import { companyKey } from "./types.js";

function credentials(accessToken: string, refreshToken = `refresh-${accessToken}`): QBCredentials {
  return {
    client_id: "client",
    client_secret: "secret",
    redirect_url: "http://localhost/callback",
    access_token: accessToken,
    refresh_token: refreshToken,
  };
}

function provider(initial: QBCredentials): CredentialProvider & { current: QBCredentials } {
  return {
    current: initial,
    async getCredentials() { return this.current; },
    async saveCredentials(value) { this.current = value; },
    async getCompanyId() { return "123"; },
    async isConfigured() { return true; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("DefaultQboCompanyRuntime refresh isolation", () => {
  it("single-flights concurrent refreshes for one company", async () => {
    const stored = provider(credentials("old"));
    const gate = deferred<QBCredentials>();
    const refresh = vi.fn(() => gate.promise);
    const runtime = new DefaultQboCompanyRuntime({
      companyKey: companyKey("company-a"), companyId: "123", provider: stored,
      sandbox: true, refresh,
    });
    const failed = (await runtime.createClientAttempt()).credentialFingerprint;

    const first = runtime.refreshAfterAuthError(failed);
    const second = runtime.refreshAfterAuthError(failed);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    gate.resolve(credentials("new"));
    await Promise.all([first, second]);

    expect(refresh).toHaveBeenCalledOnce();
    expect(stored.current.access_token).toBe("new");
  });

  it("skips refresh when credentials advanced while waiting", async () => {
    const stored = provider(credentials("old"));
    const gate = deferred<QBCredentials>();
    const refresh = vi.fn(() => gate.promise);
    const runtime = new DefaultQboCompanyRuntime({
      companyKey: companyKey("company-a"), companyId: "123", provider: stored,
      sandbox: true, refresh,
    });
    const failed = (await runtime.createClientAttempt()).credentialFingerprint;
    const first = runtime.refreshAfterAuthError(failed);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const waiter = runtime.refreshAfterAuthError(failed);
    gate.resolve(credentials("new"));
    await Promise.all([first, waiter]);

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not share refresh state between companies", async () => {
    const gateA = deferred<QBCredentials>();
    const gateB = deferred<QBCredentials>();
    const refreshA = vi.fn(() => gateA.promise);
    const refreshB = vi.fn(() => gateB.promise);
    const providerA = provider(credentials("a-old"));
    const providerB = provider(credentials("b-old"));
    const runtimeA = new DefaultQboCompanyRuntime({
      companyKey: companyKey("company-a"), companyId: "a", provider: providerA,
      sandbox: true, refresh: refreshA,
    });
    const runtimeB = new DefaultQboCompanyRuntime({
      companyKey: companyKey("company-b"), companyId: "b", provider: providerB,
      sandbox: true, refresh: refreshB,
    });

    const pendingA = runtimeA.refreshAfterAuthError((await runtimeA.createClientAttempt()).credentialFingerprint);
    const pendingB = runtimeB.refreshAfterAuthError((await runtimeB.createClientAttempt()).credentialFingerprint);
    await vi.waitFor(() => {
      expect(refreshA).toHaveBeenCalledOnce();
      expect(refreshB).toHaveBeenCalledOnce();
    });
    gateA.resolve(credentials("a-new"));
    gateB.resolve(credentials("b-new"));
    await Promise.all([pendingA, pendingB]);
  });

  it("retries persistence with the same refreshed snapshot without refreshing twice", async () => {
    const stored = provider(credentials("old"));
    const save = vi.spyOn(stored, "saveCredentials")
      .mockRejectedValueOnce(new Error("temporary save failure"))
      .mockImplementationOnce(async (value) => { stored.current = value; });
    const refreshed = credentials("new");
    const refresh = vi.fn().mockResolvedValue(refreshed);
    const runtime = new DefaultQboCompanyRuntime({
      companyKey: companyKey("company-a"), companyId: "123", provider: stored,
      sandbox: true, refresh, saveAttempts: 2,
    });

    await runtime.refreshAfterAuthError((await runtime.createClientAttempt()).credentialFingerprint);

    expect(refresh).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0]).toBe(refreshed);
    expect(save.mock.calls[1][0]).toBe(refreshed);
  });

  it("fails after bounded persistence retries without another Intuit refresh", async () => {
    const stored = provider(credentials("old"));
    vi.spyOn(stored, "saveCredentials").mockRejectedValue(new Error("save failed"));
    const refresh = vi.fn().mockResolvedValue(credentials("new"));
    const runtime = new DefaultQboCompanyRuntime({
      companyKey: companyKey("company-a"), companyId: "123", provider: stored,
      sandbox: true, refresh, saveAttempts: 2,
    });

    await expect(runtime.refreshAfterAuthError(
      (await runtime.createClientAttempt()).credentialFingerprint
    )).rejects.toThrow("could not be persisted");
    expect(refresh).toHaveBeenCalledOnce();
    expect(stored.saveCredentials).toHaveBeenCalledTimes(2);
  });
});
