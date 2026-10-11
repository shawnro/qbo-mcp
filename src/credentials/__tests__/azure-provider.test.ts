import type { SecretClient } from "@azure/keyvault-secrets";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureCredentialProvider } from "../azure-provider.js";

const complete = {
  client_id: "client",
  client_secret: "secret",
  redirect_url: "https://example.com/callback",
  access_token: "access",
  refresh_token: "refresh",
  company_id: "123",
};

function client(overrides: Record<string, unknown> = {}): SecretClient {
  return {
    getSecret: vi.fn(async () => ({ value: JSON.stringify(complete) })),
    setSecret: vi.fn(async () => ({})),
    ...overrides,
  } as unknown as SecretClient;
}

afterEach(() => {
  delete process.env.AZURE_KEY_VAULT_URL;
  delete process.env.QBO_COMPANY_ID;
});

describe("AzureCredentialProvider", () => {
  it("validates credential secrets and resolves company configuration", async () => {
    process.env.AZURE_KEY_VAULT_URL = "https://vault.example.com";
    const credentials = new AzureCredentialProvider("credentials", client({
      getSecret: vi.fn(async () => ({ value: JSON.stringify({ ...complete, ignored: true }) })),
    }));

    expect(await credentials.getCredentials()).toEqual(complete);
    expect(await credentials.isConfigured()).toBe(true);
  });

  it("returns false only for a missing vault setting or secret", async () => {
    expect(await new AzureCredentialProvider("credentials", client()).isConfigured()).toBe(false);

    process.env.AZURE_KEY_VAULT_URL = "https://vault.example.com";
    const missing = new AzureCredentialProvider("credentials", client({
      getSecret: vi.fn(async () => {
        throw Object.assign(new Error("missing"), { statusCode: 404 });
      }),
    }));
    await expect(missing.isConfigured()).resolves.toBe(false);
  });

  it("surfaces malformed credentials and operational failures", async () => {
    process.env.AZURE_KEY_VAULT_URL = "https://vault.example.com";
    const malformed = new AzureCredentialProvider("credentials", client({
      getSecret: vi.fn(async () => ({ value: JSON.stringify({ company_id: "123" }) })),
    }));
    await expect(malformed.isConfigured()).rejects.toThrow('field "client_id"');

    const forbidden = new AzureCredentialProvider("credentials", client({
      getSecret: vi.fn(async () => {
        throw Object.assign(new Error("forbidden"), { statusCode: 403 });
      }),
    }));
    await expect(forbidden.isConfigured()).rejects.toThrow("forbidden");
  });

  it("validates credentials before writing the secret", async () => {
    process.env.AZURE_KEY_VAULT_URL = "https://vault.example.com";
    const secretClient = client();
    const credentials = new AzureCredentialProvider("credentials", secretClient);

    await expect(credentials.saveCredentials({
      ...complete,
      access_token: "",
    })).rejects.toThrow('field "access_token"');
    expect(secretClient.setSecret).not.toHaveBeenCalled();
  });
});