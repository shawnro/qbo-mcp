import { describe, expect, it } from "vitest";
import { isAuthError } from "../auth.js";

describe("isAuthError", () => {
  it.each([401, 403])("recognizes nested HTTP %s", (status) => {
    expect(isAuthError({ response: { status } })).toBe(true);
  });

  it("falls back to nested status when a top-level status is malformed", () => {
    expect(isAuthError({ statusCode: "ECONNRESET", response: { status: "401" } })).toBe(true);
  });

  it.each(["3200", "401"])("recognizes nested QBO auth code %s", (code) => {
    expect(isAuthError({
      response: {
        status: 400,
        data: { Fault: { Error: [{ Code: code, Message: "Authentication failed" }] } },
      },
    })).toBe(true);
  });

  it("does not classify a nested QBO validation fault as auth", () => {
    expect(isAuthError({
      response: {
        status: 400,
        data: { Fault: { Error: [{ Code: "2050", Message: "Invalid length" }] } },
      },
    })).toBe(false);
  });

  it("considers an HTTP auth status even when the QBO code is not an auth code", () => {
    expect(isAuthError({
      response: {
        status: 401,
        data: { Fault: { Error: [{ Code: "9999", Message: "Request rejected" }] } },
      },
    })).toBe(true);
  });

  it("retains safe message heuristics", () => {
    expect(isAuthError(new Error("Token expired while calling QBO"))).toBe(true);
    expect(isAuthError(new Error("Business validation failed"))).toBe(false);
  });
});