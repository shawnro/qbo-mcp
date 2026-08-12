import { describe, expect, it } from "vitest";
import { parseRemoteHttpConfig, publicUrl, routePath } from "./config.js";

const authenticatedEnvironment = {
  MCP_PUBLIC_BASE_URL: "https://mcp.example.com/prod/",
  MCP_SINGLE_REPLICA: "true",
  MCP_AUTH_JWKS_URI: "https://login.example.com/keys",
  MCP_AUTH_AUDIENCE: "api://quickbooks",
  MCP_AUTH_ISSUER: "https://login.example.com/tenant/v2.0",
};

describe("parseRemoteHttpConfig", () => {
  it("requires a safe canonical HTTPS base URL", () => {
    expect(parseRemoteHttpConfig({ MCP_AUTH_DISABLED: "true" }).mode).toBe("invalid");
    expect(parseRemoteHttpConfig({
      MCP_PUBLIC_BASE_URL: "http://mcp.example.com",
      MCP_AUTH_DISABLED: "true",
    }).mode).toBe("invalid");
    expect(parseRemoteHttpConfig({
      MCP_PUBLIC_BASE_URL: "https://user:pass@mcp.example.com",
      MCP_AUTH_DISABLED: "true",
    }).mode).toBe("invalid");
  });

  it("normalizes the base URL and supports explicit anonymous mode", () => {
    expect(parseRemoteHttpConfig({
      MCP_PUBLIC_BASE_URL: "https://mcp.example.com/prod/",
      MCP_SINGLE_REPLICA: "true",
      MCP_AUTH_DISABLED: "true",
    })).toMatchObject({
      mode: "valid",
      config: {
        publicBaseUrl: "https://mcp.example.com/prod",
        auth: { mode: "disabled" },
        oauth: { mode: "disabled" },
      },
    });
  });

  it("keeps OAuth proxy configuration separate and rejects conflicts", () => {
    expect(parseRemoteHttpConfig({
      MCP_PUBLIC_BASE_URL: "https://mcp.example.com",
      MCP_SINGLE_REPLICA: "true",
      MCP_AUTH_DISABLED: "true",
      MCP_AUTH_SERVER_URL: "https://login.example.com/tenant/v2.0",
    }).mode).toBe("invalid");

    expect(parseRemoteHttpConfig({
      ...authenticatedEnvironment,
      MCP_AUTH_SCOPE: "access_as_user",
      MCP_AUTH_SERVER_URL: "https://login.example.com/tenant/v2.0",
    })).toMatchObject({
      mode: "valid",
      config: {
        oauth: {
          mode: "enabled",
          authorizationEndpoint: "https://login.example.com/tenant/oauth2/v2.0/authorize",
          tokenEndpoint: "https://login.example.com/tenant/oauth2/v2.0/token",
          scope: "api://quickbooks/access_as_user",
        },
      },
    });
  });

  it("requires an explicit single-replica acknowledgement", () => {
    expect(parseRemoteHttpConfig({
      MCP_PUBLIC_BASE_URL: "https://mcp.example.com",
      MCP_AUTH_DISABLED: "true",
    })).toEqual({
      mode: "invalid",
      reason: "MCP_SINGLE_REPLICA=true is required until distributed token refresh coordination is configured",
    });
  });

  it("promotes invalid authentication to invalid hosted configuration", () => {
    expect(parseRemoteHttpConfig({
      MCP_PUBLIC_BASE_URL: "https://mcp.example.com",
      MCP_SINGLE_REPLICA: "true",
      MCP_AUTH_JWKS_URI: "https://login.example.com/keys",
    })).toEqual({
      mode: "invalid",
      reason: "Complete JWT authentication configuration is required",
    });
  });

  it("constructs and recognizes routes from trusted configuration", () => {
    const state = parseRemoteHttpConfig(authenticatedEnvironment);
    if (state.mode !== "valid") throw new Error("Expected valid configuration");

    expect(publicUrl(state.config, "/qb/mcp")).toBe("https://mcp.example.com/prod/qb/mcp");
    expect(routePath(new Request("https://attacker.example/prod/qb/mcp"), state.config)).toBe("/qb/mcp");
    expect(routePath(new Request("https://attacker.example/other/qb/mcp"), state.config)).toBeNull();
  });
});