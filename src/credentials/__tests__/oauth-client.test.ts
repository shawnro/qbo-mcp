import { describe, expect, it } from "vitest";
import OAuthClient from "intuit-oauth";
import "../oauth-client.js";

describe("OAuth token request safety", () => {
  it("disables automatic replay of one-time token requests", () => {
    expect(OAuthClient.retryConfig.maxRetries).toBe(0);
  });
});