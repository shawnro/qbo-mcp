import { validateToken } from "../auth/token-validator.js";
import type { TokenValidator } from "./auth.js";
import { authorizeRequest } from "./auth.js";
import type { RemoteHttpConfigState } from "./config.js";
import { publicUrl, routePath } from "./config.js";
import { corsPreflight, withCors } from "./cors.js";
import { handleMcpRequest } from "./mcp-handler.js";
import { authorizeRedirect, oauthServerMetadata, proxyToken } from "./oauth.js";
import { configurationError, jsonResponse, methodNotAllowed, notFound } from "./responses.js";

export interface HttpAppDependencies {
  validateToken?: TokenValidator;
  fetch?: typeof fetch;
  handleMcp?: (request: Request) => Promise<Response>;
}

export function createHttpApp(
  configState: RemoteHttpConfigState,
  dependencies: HttpAppDependencies = {}
): (request: Request) => Promise<Response> {
  const validator = dependencies.validateToken ?? validateToken;
  const fetchImpl = dependencies.fetch ?? fetch;
  const mcpHandler = dependencies.handleMcp ?? handleMcpRequest;

  return async (request) => {
    if (request.method === "OPTIONS") return corsPreflight();
    if (configState.mode === "invalid") return withCors(configurationError());

    const config = configState.config;
    const path = routePath(request, config);
    if (path === null) return withCors(notFound());

    if (path === "/.well-known/oauth-authorization-server") {
      if (config.oauth.mode !== "enabled") return withCors(notFound());
      if (request.method !== "GET") return withCors(methodNotAllowed(["GET"]));
      return withCors(oauthServerMetadata(config));
    }

    if (path === "/authorize") {
      if (config.oauth.mode !== "enabled") return withCors(notFound());
      if (request.method !== "GET") return withCors(methodNotAllowed(["GET"]));
      return withCors(authorizeRedirect(request, config.oauth));
    }

    if (path === "/token") {
      if (config.oauth.mode !== "enabled") return withCors(notFound());
      if (request.method !== "POST") return withCors(methodNotAllowed(["POST"]));
      return withCors(await proxyToken(request, config.oauth, fetchImpl));
    }

    if (path !== config.mcpPath) return withCors(notFound());
    if (config.auth.mode === "invalid") return withCors(configurationError());
    if (request.method === "GET") {
      if (config.auth.mode !== "enabled") return withCors(methodNotAllowed(["POST"]));
      return withCors(jsonResponse(200, {
        resource: publicUrl(config, config.mcpPath),
        authorization_servers: config.oauth.mode === "enabled" ? [config.oauth.issuer] : [],
        scopes_supported: config.oauth.mode === "enabled" && config.oauth.scope
          ? [config.oauth.scope, "offline_access"]
          : [],
        bearer_methods_supported: ["header"],
        resource_name: config.resourceName,
      }));
    }
    if (request.method !== "POST") return withCors(methodNotAllowed(["GET", "POST"]));
    if (config.auth.mode === "enabled") {
      const authFailure = await authorizeRequest(
        request,
        config.auth.config,
        publicUrl(config, config.mcpPath),
        validator
      );
      if (authFailure) return withCors(authFailure);
    }

    try {
      return withCors(await mcpHandler(request));
    } catch {
      return withCors(jsonResponse(500, {
        error: "internal_error",
        error_description: "The MCP request could not be completed.",
      }));
    }
  };
}