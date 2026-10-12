import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  activeName: "alpha",
  configured: true,
  createCredentialProvider: vi.fn(),
  profiles: {
    alpha: { mode: "local", company_id: "100" },
    beta: { mode: "local", company_id: "200" },
  } as Record<string, { mode: "local"; company_id: string }>,
}));

vi.mock("../credentials/index.js", () => ({
  createCredentialProvider: state.createCredentialProvider,
  getActiveProfile: () => state.profiles[state.activeName],
  getActiveProfileName: () => state.activeName,
  getCredentialMode: () => "local",
  hasProfiles: () => true,
  isLocalMode: () => true,
}));

import { LocalQboCompanyRuntime } from "./local-company-runtime.js";

function provider() {
  return {
    getRefreshLockScope: () => `test:${state.activeName}`,
    isConfigured: vi.fn(async () => state.configured),
    getCompanyId: vi.fn(async () => state.profiles[state.activeName].company_id),
    getCredentials: vi.fn(async () => ({
      client_id: "client",
      client_secret: "secret",
      redirect_url: "http://localhost/callback",
      access_token: `access-${state.activeName}`,
      refresh_token: `refresh-${state.activeName}`,
      company_id: state.profiles[state.activeName].company_id,
    })),
    saveCredentials: vi.fn(),
  };
}

describe("LocalQboCompanyRuntime", () => {
  beforeEach(() => {
    state.activeName = "alpha";
    state.configured = true;
    state.createCredentialProvider.mockReset();
    state.createCredentialProvider.mockImplementation(async () => provider());
  });

  it("rebinds to the active profile without sharing lookup caches", async () => {
    const runtime = new LocalQboCompanyRuntime();

    await runtime.createClientAttempt();
    const alphaCache = runtime.lookupCache;
    expect(runtime.companyId).toBe("100");

    state.activeName = "beta";
    await runtime.createClientAttempt();

    expect(runtime.companyId).toBe("200");
    expect(runtime.lookupCache).not.toBe(alphaCache);
    expect(state.createCredentialProvider).toHaveBeenCalledTimes(2);
  });

  it("retries initialization after credentials become configured", async () => {
    const runtime = new LocalQboCompanyRuntime();
    state.configured = false;

    await expect(runtime.createClientAttempt()).rejects.toThrow("not configured");
    state.configured = true;
    await expect(runtime.createClientAttempt()).resolves.toBeDefined();

    expect(state.createCredentialProvider).toHaveBeenCalledTimes(2);
  });

  it("recreates the active runtime after cache invalidation", async () => {
    const runtime = new LocalQboCompanyRuntime();
    await runtime.createClientAttempt();
    const firstCache = runtime.lookupCache;

    runtime.clearCaches();
    await runtime.createClientAttempt();

    expect(runtime.lookupCache).not.toBe(firstCache);
    expect(state.createCredentialProvider).toHaveBeenCalledTimes(2);
  });
});