import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCredentialProvider } = vi.hoisted(() => ({
  createCredentialProvider: vi.fn(),
}));
vi.mock("../credentials/index.js", () => ({ createCredentialProvider }));

import { clearHostedRuntimeForTests, getHostedCompanyRuntime } from "./factory.js";

function provider(configured: boolean) {
  return {
    isConfigured: vi.fn().mockResolvedValue(configured),
    getCompanyId: vi.fn().mockResolvedValue("123"),
    getCredentials: vi.fn(),
    saveCredentials: vi.fn(),
  };
}

describe("hosted runtime initialization", () => {
  beforeEach(() => {
    clearHostedRuntimeForTests();
    createCredentialProvider.mockReset();
    process.env.QBO_CREDENTIAL_MODE = "local";
  });

  it("does not permanently cache a rejected initialization", async () => {
    createCredentialProvider
      .mockResolvedValueOnce(provider(false))
      .mockResolvedValueOnce(provider(true));

    await expect(getHostedCompanyRuntime()).rejects.toThrow("not configured");
    await expect(getHostedCompanyRuntime()).resolves.toMatchObject({ companyId: "123" });
    expect(createCredentialProvider).toHaveBeenCalledTimes(2);
  });
});
