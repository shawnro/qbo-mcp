import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalCredentialProvider } from "../local-provider.js";
import type { QBCredentials } from "../types.js";

const roots: string[] = [];

afterEach(async () => {
  delete process.env.QBO_CREDENTIAL_FILE;
  delete process.env.QBO_CLIENT_ID;
  delete process.env.QBO_CLIENT_SECRET;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixturePath(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), "qbo-local-provider-test-"));
  roots.push(root);
  return join(root, "credentials.json");
}

function credentials(accessToken: string): QBCredentials {
  return {
    client_id: "client",
    client_secret: "secret",
    redirect_url: "http://localhost/callback",
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    company_id: "123",
  };
}

describe("LocalCredentialProvider", () => {
  it("atomically replaces credentials without leaving temporary files", async () => {
    const credentialPath = await fixturePath();
    process.env.QBO_CREDENTIAL_FILE = credentialPath;
    const provider = new LocalCredentialProvider();

    await provider.saveCredentials(credentials("first"));
    await provider.saveCredentials(credentials("second"));

    expect(await provider.getCredentials()).toEqual(credentials("second"));
    expect(await fs.readdir(join(credentialPath, ".."))).toEqual(["credentials.json"]);
  });

  it("derives its refresh scope from the normalized credential path", async () => {
    const credentialPath = await fixturePath();
    process.env.QBO_CREDENTIAL_FILE = credentialPath;

    const expectedPath = process.platform === "win32"
      ? resolve(credentialPath).toLowerCase()
      : resolve(credentialPath);
    expect(new LocalCredentialProvider().getRefreshLockScope()).toBe(`local:${expectedPath}`);
  });

  it("returns false only when the credential file is missing", async () => {
    const credentialPath = await fixturePath();
    process.env.QBO_CREDENTIAL_FILE = credentialPath;

    expect(await new LocalCredentialProvider().isConfigured()).toBe(false);
  });

  it.each([
    ["malformed JSON", '{"client_id":', "must contain valid JSON"],
    ["non-object JSON", "null", "must contain a JSON object"],
    ["incomplete credentials", JSON.stringify({ client_id: "client" }), 'field "client_secret"'],
  ])("surfaces %s instead of reporting not configured", async (_label, content, message) => {
    const credentialPath = await fixturePath();
    process.env.QBO_CREDENTIAL_FILE = credentialPath;
    await fs.writeFile(credentialPath, content);

    await expect(new LocalCredentialProvider().isConfigured()).rejects.toThrow(message);
  });

  it("validates credentials before writing", async () => {
    const credentialPath = await fixturePath();
    process.env.QBO_CREDENTIAL_FILE = credentialPath;

    await expect(new LocalCredentialProvider().saveCredentials({
      ...credentials("access"),
      refresh_token: "",
    })).rejects.toThrow('field "refresh_token"');
    await expect(fs.access(credentialPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("validates partial client credentials used for OAuth bootstrap", async () => {
    const credentialPath = await fixturePath();
    process.env.QBO_CREDENTIAL_FILE = credentialPath;
    const provider = new LocalCredentialProvider();

    expect(await provider.hasClientCredentials()).toBe(false);
    await fs.writeFile(credentialPath, JSON.stringify({
      client_id: "client",
      client_secret: "secret",
    }));
    expect(await provider.hasClientCredentials()).toBe(true);
    expect(await provider.getClientCredentials()).toEqual({
      clientId: "client",
      clientSecret: "secret",
    });
  });

  it.each([
    ["type confusion", { client_id: 123, client_secret: true }],
    ["missing client secret", { client_id: "client" }],
    ["blank client ID", { client_id: " ", client_secret: "secret" }],
  ])("surfaces malformed OAuth bootstrap credentials: %s", async (_label, stored) => {
    const credentialPath = await fixturePath();
    process.env.QBO_CREDENTIAL_FILE = credentialPath;
    await fs.writeFile(credentialPath, JSON.stringify(stored));
    const provider = new LocalCredentialProvider();

    await expect(provider.hasClientCredentials()).rejects.toThrow(
      "must provide non-empty string client_id and client_secret fields together"
    );
    await expect(provider.getClientCredentials()).rejects.toThrow(
      "must provide non-empty string client_id and client_secret fields together"
    );
  });

  it("validates and prioritizes environment client credentials", async () => {
    const credentialPath = await fixturePath();
    process.env.QBO_CREDENTIAL_FILE = credentialPath;
    await fs.writeFile(credentialPath, JSON.stringify({
      client_id: "file-client",
      client_secret: "file-secret",
    }));
    const provider = new LocalCredentialProvider();

    process.env.QBO_CLIENT_ID = "env-client";
    await expect(provider.getClientCredentials()).rejects.toThrow(
      "QBO_CLIENT_ID and QBO_CLIENT_SECRET"
    );

    process.env.QBO_CLIENT_SECRET = "env-secret";
    expect(await provider.getClientCredentials()).toEqual({
      clientId: "env-client",
      clientSecret: "env-secret",
    });
  });
});