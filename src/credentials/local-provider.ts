// Local file-based credential provider

import { promises as fs, realpathSync } from "fs";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { join, dirname, resolve, basename } from "path";
import { parseCredentialPayload } from "./types.js";
import type { CredentialProvider, QBCredentials } from "./types.js";

// Default credential file location
const DEFAULT_CREDENTIAL_PATH = join(homedir(), ".qbo-mcp", "credentials.json");

function clientCredentialsFrom(
  value: Record<string, unknown>,
  source: string
): { clientId: string; clientSecret: string } | null {
  const clientId = value.client_id;
  const clientSecret = value.client_secret;
  if (clientId === undefined && clientSecret === undefined) return null;
  if (
    typeof clientId !== "string"
    || !clientId.trim()
    || typeof clientSecret !== "string"
    || !clientSecret.trim()
  ) {
    throw new Error(`${source} must provide non-empty string client_id and client_secret fields together`);
  }
  return { clientId, clientSecret };
}

/**
 * Get the credential file path from environment or use default
 */
function getCredentialPath(): string {
  return process.env.QBO_CREDENTIAL_FILE || DEFAULT_CREDENTIAL_PATH;
}

/**
 * Local file-based credential provider
 * Stores credentials in ~/.qbo-mcp/credentials.json by default
 */
export class LocalCredentialProvider implements CredentialProvider {
  private credentialPath: string;

  constructor() {
    this.credentialPath = getCredentialPath();
  }

  getRefreshLockScope(): string {
    let canonicalPath = resolve(this.credentialPath);
    try {
      canonicalPath = realpathSync.native(canonicalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        canonicalPath = join(realpathSync.native(dirname(canonicalPath)), basename(canonicalPath));
      } catch (parentError) {
        if ((parentError as NodeJS.ErrnoException).code !== "ENOENT") throw parentError;
      }
    }
    return `local:${process.platform === "win32" ? canonicalPath.toLowerCase() : canonicalPath}`;
  }

  async getCredentials(): Promise<QBCredentials> {
    try {
      const content = await fs.readFile(this.credentialPath, "utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error(`Local credential file ${this.credentialPath} must contain valid JSON`);
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Local credential file ${this.credentialPath} must contain a JSON object`);
      }
      const stored = parsed as Record<string, unknown>;

      // Merge with environment variables (env vars take precedence for client credentials)
      return parseCredentialPayload({
        client_id: process.env.QBO_CLIENT_ID || stored.client_id,
        client_secret: process.env.QBO_CLIENT_SECRET || stored.client_secret,
        redirect_url: stored.redirect_url || "https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl",
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
        company_id: stored.company_id,
      }, `Local credential file ${this.credentialPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const missing = new Error(
          `Credentials file not found at ${this.credentialPath}. ` +
            "Run qbo_authenticate to set up OAuth credentials.",
          { cause: error }
        );
        Object.assign(missing, { code: "ENOENT" });
        throw missing;
      }
      throw error;
    }
  }

  async saveCredentials(credentials: QBCredentials): Promise<void> {
    const validated = parseCredentialPayload(credentials, "QuickBooks credentials to save");
    const dir = dirname(this.credentialPath);
    await fs.mkdir(dir, { recursive: true });
    const temporaryPath = join(dir, `.${basename(this.credentialPath)}.${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;

    try {
      handle = await fs.open(temporaryPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify(validated, null, 2), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporaryPath, this.credentialPath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async getCompanyId(): Promise<string> {
    const credentials = await this.getCredentials();

    if (!credentials.company_id) {
      throw new Error(
        "Company ID not found in credentials. " +
          "Run qbo_authenticate to complete OAuth setup."
      );
    }

    return credentials.company_id;
  }

  async isConfigured(): Promise<boolean> {
    try {
      const credentials = await this.getCredentials();
      return Boolean(credentials.company_id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  /**
   * Check if client credentials are available (for OAuth flow)
   * Client ID and secret can come from env vars or stored file
   */
  async hasClientCredentials(): Promise<boolean> {
    return (await this.getClientCredentials()) !== null;
  }

  /**
   * Get client credentials for OAuth flow
   * Returns null if not available
   */
  async getClientCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
    if (process.env.QBO_CLIENT_ID !== undefined || process.env.QBO_CLIENT_SECRET !== undefined) {
      return clientCredentialsFrom({
        client_id: process.env.QBO_CLIENT_ID,
        client_secret: process.env.QBO_CLIENT_SECRET,
      }, "QBO_CLIENT_ID and QBO_CLIENT_SECRET");
    }

    try {
      const content = await fs.readFile(this.credentialPath, "utf-8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new Error(`Local credential file ${this.credentialPath} must contain valid JSON`);
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`Local credential file ${this.credentialPath} must contain a JSON object`);
      }
      return clientCredentialsFrom(
        parsed as Record<string, unknown>,
        `Local credential file ${this.credentialPath}`
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    return null;
  }
}
