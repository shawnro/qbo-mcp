import { afterEach, describe, expect, it, vi } from "vitest";
import OAuthClient from "intuit-oauth";
import { exchangeCodeForTokens } from "../oauth-client.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OAuth token request safety", () => {
  it("disables automatic replay of one-time token requests", () => {
    expect(OAuthClient.retryConfig.maxRetries).toBe(0);
  });

  it("preserves CommonJS query-string handling for authorization URLs", () => {
    const client = new OAuthClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      environment: "sandbox",
      redirectUri: "https://example.com/callback",
    });

    const authorizationUrl = new URL(client.authorizeUri({
      scope: ["com.intuit.quickbooks.accounting"],
      state: "state with spaces",
    }));

    expect(authorizationUrl.searchParams.get("client_id")).toBe("client-id");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe("https://example.com/callback");
    expect(authorizationUrl.searchParams.get("scope")).toBe("com.intuit.quickbooks.accounting");
    expect(authorizationUrl.searchParams.get("state")).toBe("state with spaces");
  });

  it("encodes local callback values before intuit-oauth parses them", async () => {
    const createToken = vi.spyOn(OAuthClient.prototype, "createToken").mockResolvedValue({
      getToken: () => ({
        access_token: "access-token",
        refresh_token: "refresh-token",
      }),
    } as never);

    await exchangeCodeForTokens(
      "client-id",
      "client-secret",
      "%ZZ&realmId=attacker",
      "123&code=attacker"
    );

    expect(createToken).toHaveBeenCalledOnce();
    expect(createToken.mock.calls[0][0]).toBe(
      "https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl?" +
      "code=%25ZZ%26realmId%3Dattacker&realmId=123%26code%3Dattacker"
    );
  });
});
