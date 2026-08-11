import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthConfig {
  jwksUri: string;
  audience: string;
  issuers: string[];
  requiredScope?: string;
}

export type AuthConfigState =
  | { mode: "enabled"; config: AuthConfig }
  | { mode: "disabled" }
  | { mode: "invalid"; reason: string };

type AuthEnvironment = Record<string, string | undefined>;

function parseHttpsUrl(value: string, name: string): URL | string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return `${name} must use HTTPS`;
    if (url.username || url.password) return `${name} must not include credentials`;
    if (url.search || url.hash) return `${name} must not include a query or fragment`;
    return url;
  } catch {
    return `${name} must be a valid absolute URL`;
  }
}

/**
 * Parse remote resource-server authentication without silently disabling it.
 */
export function parseAuthConfig(env: AuthEnvironment = process.env): AuthConfigState {
  const jwksUri = env.MCP_AUTH_JWKS_URI?.trim();
  const audience = env.MCP_AUTH_AUDIENCE?.trim();
  const issuer = env.MCP_AUTH_ISSUER?.trim();
  const requiredScope = env.MCP_AUTH_SCOPE?.trim();
  const disabled = env.MCP_AUTH_DISABLED;
  const configuredValues = [jwksUri, audience, issuer, requiredScope].filter(Boolean);

  if (disabled !== undefined && disabled !== "true" && disabled !== "false") {
    return { mode: "invalid", reason: "MCP_AUTH_DISABLED must be true or false" };
  }

  if (disabled === "true") {
    if (configuredValues.length > 0) {
      return { mode: "invalid", reason: "Disabled authentication conflicts with JWT configuration" };
    }
    return { mode: "disabled" };
  }

  if (!jwksUri || !audience || !issuer) {
    return { mode: "invalid", reason: "Complete JWT authentication configuration is required" };
  }

  const parsedJwksUri = parseHttpsUrl(jwksUri, "MCP_AUTH_JWKS_URI");
  if (typeof parsedJwksUri === "string") {
    return { mode: "invalid", reason: parsedJwksUri };
  }

  const parsedIssuer = parseHttpsUrl(issuer, "MCP_AUTH_ISSUER");
  if (typeof parsedIssuer === "string") {
    return { mode: "invalid", reason: parsedIssuer };
  }

  // Azure AD v1 tokens use sts.windows.net issuer, v2 uses login.microsoftonline.com.
  // Accept both by extracting the tenant ID and building both issuer URLs.
  const tenantMatch = parsedIssuer.href.match(/([0-9a-f-]{36})/i);
  const issuers = tenantMatch
    ? [
        `https://login.microsoftonline.com/${tenantMatch[1]}/v2.0`,
        `https://sts.windows.net/${tenantMatch[1]}/`,
      ]
    : [parsedIssuer.href.replace(/\/$/, "")];

  return {
    mode: "enabled",
    config: {
      jwksUri: parsedJwksUri.href,
      audience,
      issuers,
      requiredScope: requiredScope || undefined,
    },
  };
}

// JWKS keyset — cached at module level across warm Lambda invocations.
// jose handles key rotation automatically.
let jwksCache: { uri: string; keyset: ReturnType<typeof createRemoteJWKSet> } | null = null;

function getJWKS(jwksUri: string) {
  if (!jwksCache || jwksCache.uri !== jwksUri) {
    jwksCache = {
      uri: jwksUri,
      keyset: createRemoteJWKSet(new URL(jwksUri)),
    };
  }
  return jwksCache.keyset;
}

export type TokenResult =
  | { valid: true; claims: Record<string, unknown> }
  | { valid: false; error: string };

/**
 * Validate a Bearer JWT token against the configured JWKS, audience, issuer,
 * and optionally a required scope.
 */
export async function validateToken(
  token: string,
  config: AuthConfig
): Promise<TokenResult> {
  try {
    const jwks = getJWKS(config.jwksUri);
    const { payload } = await jwtVerify(token, jwks, {
      audience: config.audience,
      issuer: config.issuers,
    });

    // Check required scope if configured
    if (config.requiredScope) {
      const scp = payload.scp as string | string[] | undefined;
      const scopes = Array.isArray(scp) ? scp : typeof scp === "string" ? scp.split(" ") : [];
      if (!scopes.includes(config.requiredScope)) {
        return { valid: false, error: `Missing required scope: ${config.requiredScope}` };
      }
    }

    return { valid: true, claims: payload as Record<string, unknown> };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, error: message };
  }
}
