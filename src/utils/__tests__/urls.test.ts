import { describe, expect, it } from "vitest";
import { getQboUrl } from "../urls.js";

describe("getQboUrl", () => {
  it("builds a vendor detail URL with nameId", () => {
    expect(getQboUrl("vendor", "42"))
      .toBe("https://app.qbo.intuit.com/app/vendordetail?nameId=42");
  });

  it("keeps transaction URLs on txnId", () => {
    expect(getQboUrl("bill", "42"))
      .toBe("https://app.qbo.intuit.com/app/bill?txnId=42");
  });

  it("returns null for unsupported entity types", () => {
    expect(getQboUrl("unknown", "42")).toBeNull();
  });
});