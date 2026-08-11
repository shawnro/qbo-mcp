import { describe, expect, it, vi } from "vitest";
import type { RemoteHttpConfigState } from "./http/config.js";
import { createLambdaHandler, toGatewayResult, toWebRequest } from "./lambda.js";

const config: RemoteHttpConfigState = {
  mode: "valid",
  config: {
    publicBaseUrl: "https://api.example.com/prod",
    mcpPath: "/qb/mcp",
    resourceName: "QBO",
    auth: { mode: "disabled" },
    oauth: { mode: "disabled" },
  },
};

describe("AWS Lambda adapter", () => {
  it("converts REST API v1 events using the canonical URL and query", async () => {
    const request = toWebRequest({
      httpMethod: "POST",
      path: "/qb/mcp",
      headers: { Host: "spoofed.example", "Content-Type": "application/json" },
      queryStringParameters: { page: "2", empty: undefined },
      body: '{"ok":true}',
    }, config);

    expect(request.url).toBe("https://api.example.com/prod/qb/mcp?page=2");
    expect(await request.text()).toBe('{"ok":true}');
  });

  it("converts HTTP API v2 raw query strings and base64 bodies", async () => {
    const request = toWebRequest({
      rawQueryString: "scope=a%20b&state=1",
      requestContext: { http: { method: "POST", path: "/prod/token" } },
      body: Buffer.from("grant_type=refresh_token").toString("base64"),
      isBase64Encoded: true,
    }, config);

    expect(request.url).toBe("https://api.example.com/prod/token?scope=a%20b&state=1");
    expect(await request.text()).toBe("grant_type=refresh_token");
  });

  it("converts Web responses without adding adapter policy", async () => {
    const result = await toGatewayResult(new Response("body", {
      status: 201,
      headers: { "X-Test": "value" },
    }));
    expect(result).toMatchObject({ statusCode: 201, body: "body", isBase64Encoded: false });
    expect(result.headers["x-test"]).toBe("value");
  });

  it("short-circuits warmers and delegates normal events", async () => {
    const app = vi.fn(async () => new Response("handled", { status: 202 }));
    const handler = createLambdaHandler(config, app);

    expect(await handler({ warmer: true })).toMatchObject({ statusCode: 200, body: "warmer" });
    expect(app).not.toHaveBeenCalled();

    expect(await handler({ httpMethod: "GET", path: "/unknown" })).toMatchObject({
      statusCode: 202,
      body: "handled",
    });
    expect(app).toHaveBeenCalledOnce();
  });
});