import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalCredentialProvider } from "../local-provider.js";
import type { QBCredentials } from "../types.js";

const roots: string[] = [];

afterEach(async () => {
  delete process.env.QBO_CREDENTIAL_FILE;
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
});