import { describe, expect, it } from "vitest";
import { parseAuthConfig } from "./token-validator.js";

const enabledEnvironment = {
  MCP_AUTH_JWKS_URI: "https://login.example.com/keys",
  MCP_AUTH_AUDIENCE: "api://quickbooks",
  MCP_AUTH_ISSUER: "https://login.example.com/tenant/v2.0",
};

describe("parseAuthConfig", () => {
  it("requires explicit anonymous mode when JWT configuration is absent", () => {
    expect(parseAuthConfig({})).toEqual({
      mode: "invalid",
      reason: "Complete JWT authentication configuration is required",
    });
    expect(parseAuthConfig({ MCP_AUTH_DISABLED: "true" })).toEqual({ mode: "disabled" });
  });

  it.each(["MCP_AUTH_JWKS_URI", "MCP_AUTH_AUDIENCE", "MCP_AUTH_ISSUER"] as const)(
    "rejects configuration missing %s",
    (name) => {
      const environment = { ...enabledEnvironment, [name]: undefined };
      expect(parseAuthConfig(environment).mode).toBe("invalid");
    }
  );

  it("rejects contradictory disabled and JWT configuration", () => {
    expect(parseAuthConfig({ ...enabledEnvironment, MCP_AUTH_DISABLED: "true" })).toEqual({
      mode: "invalid",
      reason: "Disabled authentication conflicts with JWT configuration",
    });
  });

  it("rejects malformed flags and insecure URLs", () => {
    expect(parseAuthConfig({ MCP_AUTH_DISABLED: "yes" }).mode).toBe("invalid");
    expect(
      parseAuthConfig({ ...enabledEnvironment, MCP_AUTH_JWKS_URI: "http://login.example.com/keys" }).mode
    ).toBe("invalid");
    expect(
      parseAuthConfig({ ...enabledEnvironment, MCP_AUTH_ISSUER: "not-a-url" }).mode
    ).toBe("invalid");
  });

  it("normalizes valid enabled configuration", () => {
    expect(
      parseAuthConfig({ ...enabledEnvironment, MCP_AUTH_SCOPE: "  access_as_user  " })
    ).toEqual({
      mode: "enabled",
      config: {
        jwksUri: "https://login.example.com/keys",
        audience: "api://quickbooks",
        issuers: ["https://login.example.com/tenant/v2.0"],
        requiredScope: "access_as_user",
      },
    });
  });

  it("accepts Azure v1 and v2 issuers for a tenant", () => {
    const result = parseAuthConfig({
      ...enabledEnvironment,
      MCP_AUTH_ISSUER: "https://login.microsoftonline.com/12345678-1234-1234-1234-123456789abc/v2.0",
    });

    expect(result).toEqual({
      mode: "enabled",
      config: {
        jwksUri: "https://login.example.com/keys",
        audience: "api://quickbooks",
        issuers: [
          "https://login.microsoftonline.com/12345678-1234-1234-1234-123456789abc/v2.0",
          "https://sts.windows.net/12345678-1234-1234-1234-123456789abc/",
        ],
        requiredScope: undefined,
      },
    });
  });
});