import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";

const projectRequire = createRequire(import.meta.url);
const qboRequire = createRequire(projectRequire.resolve("node-quickbooks"));
const QuickBooks = qboRequire("node-quickbooks");
const axios = qboRequire("axios");
const originalAdapter = axios.defaults.adapter;

afterEach(() => {
  axios.defaults.adapter = originalAdapter;
});

describe("node-quickbooks dependency overrides", () => {
  it("loads the overridden CommonJS dependencies", () => {
    const uuid = qboRequire("uuid");
    const underscore = qboRequire("underscore");
    const { XMLParser } = qboRequire("fast-xml-parser");

    expect(uuid.v1()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(underscore.VERSION).toBe("1.13.8");
    expect(underscore.find([{ field: "limit", value: 25 }], { field: "limit" })).toEqual({
      field: "limit",
      value: 25,
    });
    expect(underscore.extend({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });

    const parsed = new XMLParser().parse(
      "<ReconnectResponse><ErrorCode>0</ErrorCode><OAuthToken>token</OAuthToken></ReconnectResponse>",
    );
    expect(parsed).toEqual({
      ReconnectResponse: { ErrorCode: 0, OAuthToken: "token" },
    });
  });

  it("constructs queries and UUID v1 request IDs through the overridden packages", async () => {
    let capturedConfig: Record<string, any> | undefined;
    axios.defaults.adapter = async (config: Record<string, any>) => {
      capturedConfig = config;
      return {
        config,
        data: { QueryResponse: { Account: [], maxResults: 0 } },
        headers: {},
        status: 200,
        statusText: "OK",
      };
    };

    const qbo = new QuickBooks(
      "client",
      "secret",
      "access",
      false,
      "realm",
      true,
      false,
      75,
      "2.0",
      "refresh",
    );

    await new Promise<void>((resolve, reject) => {
      qbo.findAccounts(
        [
          { field: "Active", value: true },
          { field: "limit", value: 25 },
        ],
        (error: unknown) => (error ? reject(error) : resolve()),
      );
    });

    expect(capturedConfig).toBeDefined();
    expect(capturedConfig!.url).toContain(
      "/query?query=select * from account where Active %3D true startposition 1 maxresults 25",
    );
    expect(capturedConfig!.headers.Authorization).toBe("Bearer access");
    expect(capturedConfig!.headers["Request-Id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});