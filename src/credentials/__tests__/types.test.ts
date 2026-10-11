import { describe, expect, it } from "vitest";
import { parseCredentialJson, parseCredentialPayload } from "../types.js";

const complete = {
  client_id: "client",
  client_secret: "secret",
  redirect_url: "https://example.com/callback",
  access_token: "access",
  refresh_token: "refresh",
  company_id: "123",
};

describe("credential payload validation", () => {
  it("returns the complete supported credential shape", () => {
    expect(parseCredentialPayload({ ...complete, ignored_metadata: "value" })).toEqual(complete);
  });

  it.each([null, [], "credentials", 42])("rejects non-object payload %j", (value) => {
    expect(() => parseCredentialPayload(value, "Test credentials"))
      .toThrow("Test credentials must be a JSON object");
  });

  it.each([
    "client_id",
    "client_secret",
    "redirect_url",
    "access_token",
    "refresh_token",
  ] as const)("requires non-empty %s", (field) => {
    expect(() => parseCredentialPayload({ ...complete, [field]: " " }, "Test credentials"))
      .toThrow(`Test credentials field "${field}" must be a non-empty string`);
  });

  it("validates an optional company ID", () => {
    const { company_id: _companyId, ...withoutCompany } = complete;
    expect(parseCredentialPayload(withoutCompany)).toEqual(withoutCompany);
    expect(() => parseCredentialPayload({ ...complete, company_id: "" }))
      .toThrow('field "company_id" must be a non-empty string when provided');
  });

  it("reports malformed JSON without including its contents", () => {
    const secretContent = '{"client_secret":"do-not-echo"';
    expect(() => parseCredentialJson(secretContent, "Test credentials"))
      .toThrow("Test credentials must contain valid JSON");
    try {
      parseCredentialJson(secretContent, "Test credentials");
    } catch (error) {
      expect((error as Error).message).not.toContain("do-not-echo");
    }
  });
});