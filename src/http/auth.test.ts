import { describe, expect, it, vi } from "vitest";
import { authorizeRequest, extractBearerToken } from "./auth.js";

const config = {
  jwksUri: "https://login.example.com/keys",
  audience: "api://quickbooks",
  issuers: ["https://login.example.com/tenant/v2.0"],
};

describe("hosted authorization identity", () => {
  it("normalizes oid without retaining unrestricted claims", async () => {
    const validator = vi.fn(async () => ({
      valid: true as const,
      claims: { oid: "principal-1", sub: "fallback", secret_claim: "discarded" },
    }));
    const result = await authorizeRequest(
      new Request("https://mcp.example.com/qb/mcp", {
        headers: { Authorization: "Bearer token" },
      }),
      config,
      "https://mcp.example.com/qb/mcp",
      validator
    );

    expect(result).toEqual({
      authorized: true,
      principal: { kind: "authenticated", id: "principal-1" },
    });
  });

  it("uses sub when oid is absent and rejects tokens without either identity", async () => {
    const subResult = await authorizeRequest(
      new Request("https://mcp.example.com/qb/mcp", {
        headers: { Authorization: "Bearer token" },
      }),
      config,
      "https://mcp.example.com/qb/mcp",
      async () => ({ valid: true, claims: { sub: "subject-1" } })
    );
    expect(subResult).toMatchObject({
      authorized: true,
      principal: { kind: "authenticated", id: "subject-1" },
    });

    const missingResult = await authorizeRequest(
      new Request("https://mcp.example.com/qb/mcp", {
        headers: { Authorization: "Bearer token" },
      }),
      config,
      "https://mcp.example.com/qb/mcp",
      async () => ({ valid: true, claims: {} })
    );
    expect(missingResult.authorized).toBe(false);
    if (!missingResult.authorized) expect(missingResult.response.status).toBe(401);
  });

  it("rejects malformed bearer syntax", () => {
    expect(extractBearerToken(new Request("https://mcp.example.com"))).toBeNull();
    expect(extractBearerToken(new Request("https://mcp.example.com", {
      headers: { Authorization: "Bearer token extra" },
    }))).toBeNull();
  });
});