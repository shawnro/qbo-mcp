import { validateToken } from "../auth/token-validator.js";
import type { AuthConfig } from "../auth/token-validator.js";
import { jsonResponse } from "./responses.js";

export type TokenValidator = typeof validateToken;

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
): Promise<Response | null> {
  const token = extractBearerToken(request);
  if (!token) return unauthorized(resourceUrl, "Bearer token required");
  const result = await validator(token, config);
  if (!result.valid) return unauthorized(resourceUrl, "Bearer token is invalid");
  return null;
}