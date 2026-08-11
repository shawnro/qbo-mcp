import { parseAuthConfig } from "../auth/token-validator.js";
import type { AuthConfigState } from "../auth/token-validator.js";

type Environment = Record<string, string | undefined>;

export type OAuthConfigState =
  | {
      mode: "enabled";
      issuer: string;
      authorizationEndpoint: string;
      tokenEndpoint: string;
      scope?: string;
    }
  | { mode: "disabled" };

export interface RemoteHttpConfig {
  publicBaseUrl: string;
  mcpPath: string;
  resourceName: string;
  auth: AuthConfigState;
  oauth: OAuthConfigState;
}

export type RemoteHttpConfigState =
  | { mode: "valid"; config: RemoteHttpConfig }
  | { mode: "invalid"; reason: string };

function parsePublicBaseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      return null;
    }
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseOAuthConfig(
  env: Environment,
  auth: AuthConfigState
): OAuthConfigState | { mode: "invalid"; reason: string } {
  const serverUrl = env.MCP_AUTH_SERVER_URL?.trim();
  if (!serverUrl) return { mode: "disabled" };
  if (auth.mode !== "enabled") {
    return { mode: "invalid", reason: "OAuth proxy requires enabled JWT authentication" };
  }

  let issuer: URL;
  try {
    issuer = new URL(serverUrl);
    if (
      issuer.protocol !== "https:" ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash
    ) {
      return { mode: "invalid", reason: "MCP_AUTH_SERVER_URL must be a safe HTTPS URL" };
    }
  } catch {
    return { mode: "invalid", reason: "MCP_AUTH_SERVER_URL must be a valid absolute URL" };
  }

  const tenantBase = issuer.href.replace(/\/v2\.0\/?$/, "").replace(/\/$/, "");
  const scope = auth.config.requiredScope
    ? `${auth.config.audience}/${auth.config.requiredScope}`
    : undefined;
  return {
    mode: "enabled",
    issuer: issuer.href.replace(/\/$/, ""),
    authorizationEndpoint: `${tenantBase}/oauth2/v2.0/authorize`,
    tokenEndpoint: `${tenantBase}/oauth2/v2.0/token`,
    scope,
  };
}

export function parseRemoteHttpConfig(env: Environment = process.env): RemoteHttpConfigState {
  const publicBaseUrl = parsePublicBaseUrl(env.MCP_PUBLIC_BASE_URL?.trim());
  if (!publicBaseUrl) {
    return { mode: "invalid", reason: "MCP_PUBLIC_BASE_URL must be a safe HTTPS URL" };
  }

  const auth = parseAuthConfig(env);
  if (auth.mode === "invalid") {
    return { mode: "invalid", reason: auth.reason };
  }
  const oauth = parseOAuthConfig(env, auth);
  if (oauth.mode === "invalid") return oauth;

  return {
    mode: "valid",
    config: {
      publicBaseUrl,
      mcpPath: "/qb/mcp",
      resourceName: env.MCP_RESOURCE_NAME?.trim() || "QuickBooks MCP Server",
      auth,
      oauth,
    },
  };
}

export function publicUrl(config: RemoteHttpConfig, path: string): string {
  return `${config.publicBaseUrl}${path}`;
}

export function routePath(request: Request, config: RemoteHttpConfig): string | null {
  const requestPath = new URL(request.url).pathname;
  const basePath = new URL(`${config.publicBaseUrl}/`).pathname.replace(/\/$/, "");
  if (!basePath) return requestPath;
  if (requestPath === basePath) return "/";
  if (!requestPath.startsWith(`${basePath}/`)) return null;
  return requestPath.slice(basePath.length);
}