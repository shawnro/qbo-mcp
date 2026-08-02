import { describe, expect, it } from "vitest";
import { buildQueryErrorMessage } from "../filterable-fields.js";

describe("buildQueryErrorMessage", () => {
  it("formats fallback errors without serializing request metadata", () => {
    const result = buildQueryErrorMessage("Customer", undefined, undefined, undefined, {
      Fault: { Error: [] },
      config: {
        headers: { Authorization: "Bearer synthetic-access-token" },
        data: { refresh_token: "synthetic-refresh-token" },
      },
      request: { cookie: "synthetic-cookie-secret" },
    });

    expect(result).toContain("Raw error: QBO error");
    expect(result).not.toContain("synthetic-access-token");
    expect(result).not.toContain("synthetic-refresh-token");
    expect(result).not.toContain("synthetic-cookie-secret");
    expect(result).not.toContain("Authorization");
  });

  it("preserves a string fallback", () => {
    const result = buildQueryErrorMessage(
      "Customer",
      undefined,
      undefined,
      undefined,
      "Unexpected query failure"
    );

    expect(result).toContain("Raw error: Unexpected query failure");
  });
});