// AWS Lambda adapter for the provider-neutral QuickBooks MCP HTTP application.

import { createHttpApp } from "./http/app.js";
import { parseRemoteHttpConfig } from "./http/config.js";
import type { RemoteHttpConfigState } from "./http/config.js";
import { setExecutionEnvironment, setOutputMode } from "./utils/output.js";

setOutputMode("http");
setExecutionEnvironment("lambda");

export interface APIGatewayEvent {
  httpMethod?: string;
  path?: string;
  rawQueryString?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext?: {
    http?: { method: string; path: string };
    stage?: string;
  };
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  warmer?: boolean;
}

export interface APIGatewayResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: boolean;
}

function getMethodAndPath(event: APIGatewayEvent): { method: string; path: string } {
  return {
    method: event.httpMethod ?? event.requestContext?.http?.method ?? "GET",
    path: event.path ?? event.requestContext?.http?.path ?? "/",
  };
}

function queryString(event: APIGatewayEvent): string {
  if (event.rawQueryString) return event.rawQueryString;
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(event.queryStringParameters ?? {})) {
    if (value !== undefined) params.set(name, value);
  }
  return params.toString();
}

function requestUrl(configState: RemoteHttpConfigState, path: string, query: string): string {
  if (configState.mode === "invalid") {
    return `https://invalid.local${path}${query ? `?${query}` : ""}`;
  }

  const baseUrl = configState.config.publicBaseUrl;
  const basePath = new URL(`${baseUrl}/`).pathname.replace(/\/$/, "");
  const normalizedPath = basePath && path.startsWith(`${basePath}/`)
    ? path.slice(basePath.length)
    : path;
  return `${baseUrl}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}${
    query ? `?${query}` : ""
  }`;
}

export function toWebRequest(
  event: APIGatewayEvent,
  configState: RemoteHttpConfigState
): Request {
  const { method, path } = getMethodAndPath(event);
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(name, value);
  }

  let body: string | undefined;
  if (event.body !== undefined && method !== "GET" && method !== "HEAD") {
    body = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
  }

  return new Request(requestUrl(configState, path, queryString(event)), {
    method,
    headers,
    body,
  });
}

export async function toGatewayResult(response: Response): Promise<APIGatewayResult> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return {
    statusCode: response.status,
    headers,
    body: await response.text(),
    isBase64Encoded: false,
  };
}

export function createLambdaHandler(
  configState: RemoteHttpConfigState = parseRemoteHttpConfig(),
  app: (request: Request) => Promise<Response> = createHttpApp(configState, {
    executionEnvironment: "lambda",
  })
): (event: APIGatewayEvent) => Promise<APIGatewayResult> {
  return async (event) => {
    if (event.warmer === true) {
      return { statusCode: 200, headers: {}, body: "warmer", isBase64Encoded: false };
    }
    return toGatewayResult(await app(toWebRequest(event, configState)));
  };
}

export const handler = createLambdaHandler();