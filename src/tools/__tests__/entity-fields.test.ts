import { describe, expect, it } from "vitest";
import { createMockClient, mockSuccess } from "../../__mocks__/mock-client.js";
import {
  buildQBAddress,
  formatAddress,
  resolveTermRef,
} from "../entity-fields.js";

describe("buildQBAddress", () => {
  it("maps all supported address fields to QBO casing", () => {
    expect(buildQBAddress({
      line1: "123 Main St",
      line2: "Suite 200",
      line3: "Attention: Books",
      line4: "Building A",
      line5: "Floor 2",
      city: "Portland",
      country_sub_division_code: "OR",
      postal_code: "97201",
      country: "USA",
      lat: "45.5152",
      long: "-122.6784",
    })).toEqual({
      Line1: "123 Main St",
      Line2: "Suite 200",
      Line3: "Attention: Books",
      Line4: "Building A",
      Line5: "Floor 2",
      City: "Portland",
      CountrySubDivisionCode: "OR",
      PostalCode: "97201",
      Country: "USA",
      Lat: "45.5152",
      Long: "-122.6784",
    });
  });

  it("omits empty input fields", () => {
    expect(buildQBAddress({ line1: "", city: "Portland" })).toEqual({ City: "Portland" });
  });
});

describe("formatAddress", () => {
  it("formats street, locality, and country lines", () => {
    expect(formatAddress({
      Line1: "123 Main St",
      City: "Portland",
      CountrySubDivisionCode: "OR",
      PostalCode: "97201",
      Country: "USA",
    }, "Billing Address")).toEqual([
      "Billing Address:",
      "  123 Main St",
      "  Portland, OR 97201",
      "  USA",
    ]);
  });

  it("formats missing and empty addresses as none", () => {
    expect(formatAddress(undefined, "Billing Address")).toEqual(["Billing Address: (none)"]);
    expect(formatAddress({}, "Billing Address")).toEqual(["Billing Address: (none)"]);
  });
});

describe("resolveTermRef", () => {
  it("resolves an exact case-insensitive term name", async () => {
    const client = createMockClient();
    mockSuccess(client.findTerms, {
      QueryResponse: { Term: [{ Id: "3", Name: "Net 30" }, { Id: "4", Name: "Net 60" }] },
    });

    await expect(resolveTermRef(client as never, "net 30"))
      .resolves.toEqual({ value: "3", name: "Net 30" });
  });

  it("resolves a term ID", async () => {
    const client = createMockClient();
    mockSuccess(client.findTerms, {
      QueryResponse: { Term: [{ Id: "3", Name: "Net 30" }] },
    });

    await expect(resolveTermRef(client as never, "3"))
      .resolves.toEqual({ value: "3", name: "Net 30" });
  });

  it("lists available terms when resolution fails", async () => {
    const client = createMockClient();
    mockSuccess(client.findTerms, {
      QueryResponse: { Term: [{ Id: "3", Name: "Net 30" }, { Id: "4", Name: "Net 60" }] },
    });

    await expect(resolveTermRef(client as never, "Net 99"))
      .rejects.toThrow('Term not found: "Net 99". Available: Net 30, Net 60');
  });
});
