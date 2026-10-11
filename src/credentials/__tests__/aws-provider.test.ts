import { SSMClient } from "@aws-sdk/client-ssm";
import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { describe, expect, it, vi } from "vitest";
import { AWSCredentialProvider } from "../aws-provider.js";

const complete = {
  client_id: "client",
  client_secret: "secret",
  redirect_url: "https://example.com/callback",
  access_token: "access",
  refresh_token: "refresh",
};

function provider(
  sendSecret: (command: unknown) => Promise<unknown>,
  sendParameter: (command: unknown) => Promise<unknown> = async () => ({
    Parameter: { Value: "123" },
  })
): AWSCredentialProvider {
  return new AWSCredentialProvider({
    secretsClient: { send: sendSecret } as unknown as SecretsManagerClient,
    ssmClient: { send: sendParameter } as unknown as SSMClient,
  });
}

describe("AWSCredentialProvider", () => {
  it("validates credential secrets and resolves company configuration", async () => {
    const credentials = provider(async (command) => {
      expect(command).toBeInstanceOf(GetSecretValueCommand);
      return { SecretString: JSON.stringify({ ...complete, ignored: true }) };
    });

    expect(await credentials.getCredentials()).toEqual(complete);
    expect(await credentials.isConfigured()).toBe(true);
  });

  it("returns false only for missing AWS resources", async () => {
    const missingSecret = provider(async () => {
      throw Object.assign(new Error("missing"), { name: "ResourceNotFoundException" });
    });
    await expect(missingSecret.isConfigured()).resolves.toBe(false);

    const missingParameter = provider(
      async () => ({ SecretString: JSON.stringify(complete) }),
      async () => {
        throw Object.assign(new Error("missing"), { name: "ParameterNotFound" });
      }
    );
    await expect(missingParameter.isConfigured()).resolves.toBe(false);
  });

  it("surfaces malformed credentials and operational failures", async () => {
    const malformed = provider(async () => ({ SecretString: JSON.stringify({ client_id: "x" }) }));
    await expect(malformed.isConfigured()).rejects.toThrow('field "client_secret"');

    const unavailable = provider(async () => {
      throw Object.assign(new Error("service unavailable"), { name: "ServiceUnavailable" });
    });
    await expect(unavailable.isConfigured()).rejects.toThrow("service unavailable");
  });

  it("surfaces an empty secret value as malformed configuration", async () => {
    const empty = provider(async () => ({ SecretString: "" }));
    await expect(empty.isConfigured()).rejects.toThrow("Secret value is empty");
  });

  it("validates credentials before writing a secret version", async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(PutSecretValueCommand);
      return {};
    });
    const credentials = provider(send);

    await expect(credentials.saveCredentials({
      ...complete,
      refresh_token: "",
    })).rejects.toThrow('field "refresh_token"');
    expect(send).not.toHaveBeenCalled();
  });
});