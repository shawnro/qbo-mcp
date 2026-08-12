import { describe, expect, it, vi } from "vitest";
import type { RemoteHttpConfigState } from "./config.js";
import { createHttpApp } from "./app.js";
import type { HttpAppDependencies } from "./app.js";
import { companyKey } from "../runtime/types.js";
import type { QboCompanyRuntime } from "../runtime/types.js";
import { createLookupCache } from "../client/cache.js";

const runtime: QboCompanyRuntime = {
  companyKey: companyKey("test-company"),
  companyId: "123",
  lookupCache: createLookupCache(),
  createClientAttempt: vi.fn(),
  refreshAfterAuthError: vi.fn(),
  clearCaches: vi.fn(),
};

function createTestApp(
  config: RemoteHttpConfigState,
  dependencies: Omit<HttpAppDependencies, "executionEnvironment"> & {
    executionEnvironment?: HttpAppDependencies["executionEnvironment"];
  } = {}
) {
  return createHttpApp(config, {
    getRuntime: async () => runtime,
    createRequestId: () => "request-1",
    ...dependencies,
    executionEnvironment: dependencies.executionEnvironment ?? "lambda",
  });
}

const anonymousConfig: RemoteHttpConfigState = {
  mode: "valid",
  config: {
    publicBaseUrl: "https://mcp.example.com",
    mcpPath: "/qb/mcp",
    resourceName: "QuickBooks MCP Server",
    auth: { mode: "disabled" },
    oauth: { mode: "disabled" },
  },
};

const authenticatedConfig: RemoteHttpConfigState = {
  mode: "valid",
  config: {
    publicBaseUrl: "https://mcp.example.com/prod",
    mcpPath: "/qb/mcp",
    resourceName: "Example QBO",
    auth: {
      mode: "enabled",
      config: {
        jwksUri: "https://login.example.com/keys",
        audience: "api://quickbooks",
        issuers: ["https://login.example.com/tenant/v2.0"],
        requiredScope: "access_as_user",
      },
    },
    oauth: {
      mode: "enabled",
      issuer: "https://login.example.com/tenant/v2.0",
      authorizationEndpoint: "https://login.example.com/tenant/oauth2/v2.0/authorize",
      tokenEndpoint: "https://login.example.com/tenant/oauth2/v2.0/token",
      scope: "api://quickbooks/access_as_user",
    },
  },
};

describe("HTTP application", () => {
  const mcpRequest = (method: string, params: Record<string, unknown> = {}) =>
    new Request("https://mcp.example.com/qb/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });

  it("fails closed with a bounded configuration response", async () => {
    const app = createTestApp({ mode: "invalid", reason: "secret configuration detail" });
    const response = await app(new Request("https://anything.example/qb/mcp", { method: "POST" }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret configuration detail");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("supports explicit anonymous MCP without advertising OAuth", async () => {
    const handleMcp = vi.fn(async () => new Response("mcp", { status: 200 }));
    const app = createTestApp(anonymousConfig, { handleMcp });

    expect((await app(new Request("https://mcp.example.com/authorize"))).status).toBe(404);
    expect((await app(new Request("https://mcp.example.com/qb/mcp"))).status).toBe(405);
    const response = await app(new Request("https://mcp.example.com/qb/mcp", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(handleMcp).toHaveBeenCalledOnce();
  });

  it("requires and validates bearer tokens without exposing validator details", async () => {
    const validateToken = vi.fn(async () => ({ valid: false as const, error: "JWKS secret detail" }));
    const handleMcp = vi.fn(async () => new Response("mcp"));
    const app = createTestApp(authenticatedConfig, { validateToken, handleMcp });

    const missing = await app(new Request("https://mcp.example.com/prod/qb/mcp", { method: "POST" }));
    expect(missing.status).toBe(401);

    const invalid = await app(new Request("https://mcp.example.com/prod/qb/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer bad-token" },
    }));
    expect(invalid.status).toBe(401);
    expect(await invalid.text()).not.toContain("JWKS secret detail");
    expect(handleMcp).not.toHaveBeenCalled();
  });

  it("uses canonical metadata URLs instead of request host headers", async () => {
    const app = createTestApp(authenticatedConfig);
    const response = await app(new Request("https://spoofed.example/prod/qb/mcp"));
    const body = await response.json() as { resource: string };
    expect(body.resource).toBe("https://mcp.example.com/prod/qb/mcp");
  });

  it("delegates authenticated requests and bounds MCP failures", async () => {
    const validateToken = vi.fn(async () => ({
      valid: true as const,
      claims: { oid: "principal-1" },
    }));
    const success = createTestApp(authenticatedConfig, {
      validateToken,
      handleMcp: async () => new Response("ok"),
    });
    expect((await success(new Request("https://mcp.example.com/prod/qb/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" },
    }))).status).toBe(200);

    const failure = createTestApp(authenticatedConfig, {
      validateToken,
      handleMcp: async () => { throw new Error("sensitive failure"); },
    });
    const response = await failure(new Request("https://mcp.example.com/prod/qb/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" },
    }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("sensitive failure");
  });

  it("proxies OAuth requests and preserves upstream non-success responses", async () => {
    let proxiedBody: BodyInit | null | undefined;
    const fetchImpl: typeof fetch = vi.fn(async (_input, init) => {
      proxiedBody = init?.body;
      return new Response('{"error":"invalid_grant"}', {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    });
    const app = createTestApp(authenticatedConfig, { fetch: fetchImpl });
    const response = await app(new Request("https://mcp.example.com/prod/token", {
      method: "POST",
      body: "grant_type=authorization_code&scope=offline_access",
    }));
    expect(response.status).toBe(400);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(proxiedBody).toContain("api%3A%2F%2Fquickbooks%2Faccess_as_user+offline_access");
  });

  it("returns exact route and method errors with CORS", async () => {
    const app = createTestApp(anonymousConfig);
    expect((await app(new Request("https://mcp.example.com/unknown"))).status).toBe(404);
    const response = await app(new Request("https://mcp.example.com/qb/mcp", { method: "DELETE" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
    expect((await app(new Request("https://mcp.example.com/anything", { method: "OPTIONS" }))).status).toBe(204);
  });

  it("runs the real stateless MCP transport with hosted capabilities", async () => {
    const app = createTestApp(anonymousConfig);
    const initialize = await app(mcpRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    }));
    expect(initialize.status).toBe(200);
    expect(await initialize.json()).toMatchObject({ jsonrpc: "2.0", id: 1 });

    const list = await app(mcpRequest("tools/list"));
    const listBody = await list.json() as { result: { tools: Array<{ name: string }> } };
    const names = listBody.result.tools.map((tool) => tool.name);
    expect(names).not.toContain("qbo_authenticate");
    expect(names).not.toContain("list_qbo_profiles");
    expect(names).not.toContain("switch_qbo_profile");
    const attachable = listBody.result.tools.find((tool) => tool.name === "create_attachable") as {
      inputSchema?: { properties?: Record<string, unknown> };
    };
    expect(attachable.inputSchema?.properties).not.toHaveProperty("file_path");

    const call = await app(mcpRequest("tools/call", {
      name: "switch_qbo_profile",
      arguments: { profile: "other" },
    }));
    const callBody = await call.json() as { result: { isError?: boolean } };
    expect(callBody.result.isError).toBe(true);
  });

  it("propagates normalized principal and immutable runtime context", async () => {
    const handleMcp = vi.fn(async (_request, context) => {
      expect(context).toMatchObject({
        requestId: "request-1",
        principal: { kind: "authenticated", id: "principal-1" },
        transport: "http",
        output: { mode: "http", executionEnvironment: "lambda" },
        runtime,
      });
      expect(Object.isFrozen(context)).toBe(true);
      return new Response("ok");
    });
    const app = createTestApp(authenticatedConfig, {
      validateToken: async () => ({ valid: true, claims: { oid: "principal-1" } }),
      handleMcp,
    });

    const response = await app(new Request("https://mcp.example.com/prod/qb/mcp", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" },
    }));
    expect(response.status).toBe(200);
    expect(handleMcp).toHaveBeenCalledOnce();
  });

  it("uses the host adapter execution environment in request context", async () => {
    const handleMcp = vi.fn(async (_request, context) => {
      expect(context.output).toEqual({ mode: "http", executionEnvironment: "node" });
      return new Response("ok");
    });
    const app = createTestApp(anonymousConfig, {
      executionEnvironment: "node",
      handleMcp,
    });

    const response = await app(new Request("https://mcp.example.com/qb/mcp", {
      method: "POST",
    }));
    expect(response.status).toBe(200);
    expect(handleMcp).toHaveBeenCalledOnce();
  });
});