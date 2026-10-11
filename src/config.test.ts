import { describe, expect, it } from "vitest";
import {
  parseBooleanSetting,
  parseCredentialMode,
  validateRuntimeEnvironment,
} from "./config.js";

describe("runtime environment configuration", () => {
  it("uses safe documented defaults when settings are absent", () => {
    expect(parseCredentialMode({})).toBe("local");
    expect(parseBooleanSetting("QBO_SANDBOX", {})).toBe(false);
    expect(parseBooleanSetting("QBO_DISABLE_DELETE", {})).toBe(false);
  });

  it("accepts trimmed case-insensitive documented values", () => {
    expect(parseCredentialMode({ QBO_CREDENTIAL_MODE: " Azure " })).toBe("azure");
    expect(parseBooleanSetting("QBO_SANDBOX", { QBO_SANDBOX: " TRUE " })).toBe(true);
    expect(parseBooleanSetting("QBO_DISABLE_DELETE", { QBO_DISABLE_DELETE: " False " }))
      .toBe(false);
  });

  it.each(["", "awz", "filesystem"])(
    "rejects invalid credential mode %j",
    (value) => {
      expect(() => parseCredentialMode({ QBO_CREDENTIAL_MODE: value }))
        .toThrow("QBO_CREDENTIAL_MODE must be local, aws, or azure");
    }
  );

  it.each(["", "1", "yes", "tru"])("rejects invalid boolean %j", (value) => {
    expect(() => parseBooleanSetting("QBO_DISABLE_DELETE", {
      QBO_DISABLE_DELETE: value,
    })).toThrow("QBO_DISABLE_DELETE must be true or false");
  });

  it("validates every accounting runtime safety setting", () => {
    for (const name of [
      "QBO_SANDBOX",
      "QBO_INLINE_OUTPUT",
      "QBO_DISABLE_CREATE",
      "QBO_DISABLE_UPDATE",
      "QBO_DISABLE_DELETE",
    ]) {
      expect(() => validateRuntimeEnvironment({ [name]: "invalid" }))
        .toThrow(`${name} must be true or false`);
    }
  });
});