import { describe, expect, it } from "vitest";
import { formatQBOError } from "../errors.js";

describe("formatQBOError", () => {
  it("formats a direct QBO Fault with actionable fields", () => {
    const result = formatQBOError({
      Fault: {
        Error: [{
          Code: "2050",
          Message: "String length specified does not match the supported length",
          Detail: "The string supplied is too long",
          Element: "DocNumber",
        }],
      },
    });

    expect(result).toBe(
      "QBO error 2050: String length specified does not match the supported length — " +
      "The string supplied is too long (DocNumber)"
    );
  });

  it("unwraps a QBO Fault from an Axios response", () => {
    const result = formatQBOError({
      response: {
        status: 400,
        data: {
          Fault: { Error: [{ code: "6000", message: "Business Validation Error" }] },
        },
      },
    });

    expect(result).toBe("QBO error 6000: Business Validation Error");
  });

  it("supports lowercase legacy Fault fields", () => {
    const result = formatQBOError({
      fault: {
        error: [{
          code: "3200",
          message: "Authentication failed",
          detail: "Token expired",
          element: "Authorization",
        }],
      },
    });

    expect(result).toBe(
      "QBO error 3200: Authentication failed — Token expired (Authorization)"
    );
  });

  it("preserves a plain Error message", () => {
    expect(formatQBOError(new Error("Invalid account"))).toBe("Invalid account");
  });

  it("formats a network error using safe status, code, and message fields", () => {
    const error = Object.assign(new Error("Gateway timeout"), {
      code: "ETIMEDOUT",
      response: { status: 504 },
    });

    expect(formatQBOError(error)).toBe("HTTP 504: Gateway timeout");
  });

  it("formats an error code when no HTTP status is available", () => {
    const error = Object.assign(new Error("Connection reset"), { code: "ECONNRESET" });
    expect(formatQBOError(error)).toBe("Error ECONNRESET: Connection reset");
  });

  it("uses a bounded fallback for unknown objects", () => {
    expect(formatQBOError({ unexpected: true })).toBe("Unknown error");
  });

  it("never exposes Axios credentials or request metadata", () => {
    const error = Object.assign(new Error("Request failed"), {
      response: {
        status: 400,
        headers: { cookie: "session=synthetic-cookie-secret" },
        data: {
          Fault: {
            Error: [{ Code: "2050", Message: "Invalid value", Element: "DocNumber" }],
          },
        },
      },
      config: {
        headers: { Authorization: "Bearer synthetic-access-token" },
        data: { refresh_token: "synthetic-refresh-token" },
      },
      request: { clientSecret: "synthetic-client-secret" },
    });

    const result = formatQBOError(error);
    expect(result).toBe("QBO error 2050: Invalid value (DocNumber)");
    expect(result).not.toContain("synthetic-access-token");
    expect(result).not.toContain("synthetic-refresh-token");
    expect(result).not.toContain("synthetic-cookie-secret");
    expect(result).not.toContain("synthetic-client-secret");
  });

  it("bounds fields and total output", () => {
    const result = formatQBOError({
      Fault: {
        Error: [{
          Code: "6000",
          Message: "M".repeat(5_000),
          Detail: "D".repeat(5_000),
          Element: "E".repeat(5_000),
        }],
      },
    });

    expect(result.length).toBeLessThanOrEqual(2_000);
    expect(result).toContain("…");
  });
});