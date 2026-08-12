import { validateToken } from "../auth/token-validator.js";
import type { AuthConfig } from "../auth/token-validator.js";
import type { QboPrincipal } from "../runtime/types.js";
import { jsonResponse } from "./responses.js";

export type TokenValidator = typeof validateToken;

export type AuthorizationResult =
  | { authorized: true; principal: QboPrincipal }
  | { authorized: false; response: Response };

export function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

export function unauthorized(resourceUrl: string, description: string): Response {
  const response = jsonResponse(401, {
    error: "unauthorized",
    error_description: description,
    resource_metadata: resourceUrl,
  });
  response.headers.set("WWW-Authenticate", `Bearer resource_metadata="${resourceUrl}"`);
  return response;
}

export async function authorizeRequest(
  request: Request,
  config: AuthConfig,
  resourceUrl: string,
  validator: TokenValidator
): Promise<AuthorizationResult> {
  const token = extractBearerToken(request);
  if (!token) {
    return { authorized: false, response: unauthorized(resourceUrl, "Bearer token required") };
  }
  const result = await validator(token, config);
  if (!result.valid) {
    return { authorized: false, response: unauthorized(resourceUrl, "Bearer token is invalid") };
  }

  const principalId = typeof result.claims.oid === "string"
    ? result.claims.oid
    : typeof result.claims.sub === "string"
      ? result.claims.sub
      : null;
  if (!principalId) {
    return { authorized: false, response: unauthorized(resourceUrl, "Bearer token has no subject") };
  }

  return {
    authorized: true,
    principal: { kind: "authenticated", id: principalId },
  };
}