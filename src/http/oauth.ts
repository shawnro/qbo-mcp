import type { OAuthConfigState, RemoteHttpConfig } from "./config.js";
import { publicUrl } from "./config.js";
import { jsonResponse } from "./responses.js";

type EnabledOAuthConfig = Extract<OAuthConfigState, { mode: "enabled" }>;

function replaceScope(params: URLSearchParams, config: EnabledOAuthConfig): void {
  if (!config.scope) return;
  const requested = params.get("scope")?.split(" ") ?? [];
  const scope = requested.includes("offline_access")
    ? `${config.scope} offline_access`
    : config.scope;
  params.set("scope", scope);
}

export function oauthServerMetadata(config: RemoteHttpConfig): Response {
  if (config.oauth.mode !== "enabled") throw new Error("OAuth is not enabled");
  return jsonResponse(200, {
    issuer: config.oauth.issuer,
    authorization_endpoint: publicUrl(config, "/authorize"),
    token_endpoint: publicUrl(config, "/token"),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: config.oauth.scope ? [config.oauth.scope, "offline_access"] : [],
  });
}

export function authorizeRedirect(request: Request, config: EnabledOAuthConfig): Response {
  const params = new URL(request.url).searchParams;
  if (params.get("prompt") === "consent") params.set("prompt", "select_account");
  replaceScope(params, config);
  if (!params.has("scope") && config.scope) {
    params.set("scope", `${config.scope} offline_access`);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: `${config.authorizationEndpoint}?${params.toString()}` },
  });
}

export async function proxyToken(
  request: Request,
  config: EnabledOAuthConfig,
  fetchImpl: typeof fetch
): Promise<Response> {
  const params = new URLSearchParams(await request.text());
  replaceScope(params, config);
  try {
    const upstream = await fetchImpl(config.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch {
    return jsonResponse(502, {
      error: "oauth_upstream_error",
      error_description: "The authorization server could not be reached.",
    });
  }
}