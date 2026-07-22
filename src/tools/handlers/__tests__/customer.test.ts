import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockClient,
  mockSuccess,
  mockError,
  resetMockClient,
  mockPromisify,
} from "../../../__mocks__/mock-client.js";

vi.mock("../../../client/index.js", () => ({
    promisify: mockPromisify,
    resolveCustomer: vi.fn(),
    getClient: vi.fn(),
    clearCredentialsCache: vi.fn(),
    refreshTokens: vi.fn(),
    isAuthError: vi.fn(),
    clearLookupCache: vi.fn(),
    getCompanyIdValue: vi.fn(),
}));

vi.mock("../../../utils/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/index.js")>(
    "../../../utils/index.js"
  );
  return { ...actual };
});

import { resolveCustomer } from "../../../client/index.js";
import { handleCreateCustomer, handleGetCustomer, handleEditCustomer } from "../customer.js";

const mockResolveCustomer = vi.mocked(resolveCustomer);

describe("handleCreateCustomer", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns preview in draft mode", async () => {
    const result = await handleCreateCustomer(client as never, {
      display_name: "Acme Inc",
      email: "info@acme.com",
      phone: "555-1234",
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("Acme Inc");
    expect(result.content[0].text).toContain("info@acme.com");
    expect(result.content[0].text).toContain("555-1234");
    expect(client.createCustomer).not.toHaveBeenCalled();
  });

  it("creates customer when draft=false", async () => {
    mockSuccess(client.createCustomer, { Id: "42", DisplayName: "Acme Inc" });

    const result = await handleCreateCustomer(client as never, {
      display_name: "Acme Inc",
      draft: false,
    });

    expect(client.createCustomer).toHaveBeenCalledOnce();
    expect(result.content[0].text).toContain("Customer Created");
    expect(result.content[0].text).toContain("42");
  });

  it("includes optional fields in payload", async () => {
    mockSuccess(client.createCustomer, { Id: "43", DisplayName: "Jane Doe" });

    await handleCreateCustomer(client as never, {
      display_name: "Jane Doe",
      given_name: "Jane",
      family_name: "Doe",
      company_name: "Doe Corp",
      email: "jane@doe.com",
      phone: "555-0000",
      mobile: "555-9999",
      notes: "VIP",
      taxable: false,
      draft: false,
    });

    const payload = client.createCustomer.mock.calls[0][0];
    expect(payload.DisplayName).toBe("Jane Doe");
    expect(payload.GivenName).toBe("Jane");
    expect(payload.FamilyName).toBe("Doe");
    expect(payload.CompanyName).toBe("Doe Corp");
    expect(payload.PrimaryEmailAddr).toEqual({ Address: "jane@doe.com" });
    expect(payload.PrimaryPhone).toEqual({ FreeFormNumber: "555-0000" });
    expect(payload.Mobile).toEqual({ FreeFormNumber: "555-9999" });
    expect(payload.Notes).toBe("VIP");
    expect(payload.Taxable).toBe(false);
  });

  it("builds billing address in payload", async () => {
    mockSuccess(client.createCustomer, { Id: "44", DisplayName: "Addr Test" });

    await handleCreateCustomer(client as never, {
      display_name: "Addr Test",
      bill_address: {
        line1: "123 Main St",
        city: "Portland",
        country_sub_division_code: "OR",
        postal_code: "97201",
      },
      draft: false,
    });

    const payload = client.createCustomer.mock.calls[0][0];
    expect(payload.BillAddr).toEqual({
      Line1: "123 Main St",
      City: "Portland",
      CountrySubDivisionCode: "OR",
      PostalCode: "97201",
    });
  });

  it("resolves sales term by name", async () => {
    mockSuccess(client.findTerms, {
      QueryResponse: { Term: [{ Id: "3", Name: "Net 30" }, { Id: "4", Name: "Net 60" }] },
    });
    mockSuccess(client.createCustomer, { Id: "45", DisplayName: "Term Test" });

    await handleCreateCustomer(client as never, {
      display_name: "Term Test",
      sales_term_ref: "Net 30",
      draft: false,
    });

    const payload = client.createCustomer.mock.calls[0][0];
    expect(payload.SalesTermRef).toEqual({ value: "3", name: "Net 30" });
  });

  it("throws when sales term not found", async () => {
    mockSuccess(client.findTerms, {
      QueryResponse: { Term: [{ Id: "3", Name: "Net 30" }] },
    });

    await expect(
      handleCreateCustomer(client as never, {
        display_name: "Bad Term",
        sales_term_ref: "Net 99",
        draft: false,
      })
    ).rejects.toThrow('Term not found: "Net 99"');
  });

  it("resolves parent customer for subcustomer", async () => {
    mockResolveCustomer.mockResolvedValue({ value: "10", name: "Parent Co" });
    mockSuccess(client.createCustomer, { Id: "46", DisplayName: "Child Co" });

    await handleCreateCustomer(client as never, {
      display_name: "Child Co",
      parent_ref: "Parent Co",
      job: true,
      draft: false,
    });

    const payload = client.createCustomer.mock.calls[0][0];
    expect(payload.ParentRef).toEqual({ value: "10", name: "Parent Co" });
    expect(payload.Job).toBe(true);
  });

  it("propagates API errors", async () => {
    mockError(client.createCustomer, "Duplicate Name Exists");

    await expect(
      handleCreateCustomer(client as never, {
        display_name: "Dup",
        draft: false,
      })
    ).rejects.toThrow("Duplicate Name Exists");
  });
});

describe("handleGetCustomer", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns formatted customer details", async () => {
    mockSuccess(client.getCustomer, {
      Id: "42",
      SyncToken: "0",
      DisplayName: "Acme Inc",
      CompanyName: "Acme Inc",
      PrimaryEmailAddr: { Address: "info@acme.com" },
      PrimaryPhone: { FreeFormNumber: "555-1234" },
      Active: true,
      Balance: 500.00,
      BillAddr: { Line1: "123 Main St", City: "Portland", CountrySubDivisionCode: "OR" },
    });

    const result = await handleGetCustomer(client as never, { id: "42" });

    expect(result.content[0].text).toContain("Acme Inc");
    expect(result.content[0].text).toContain("info@acme.com");
    expect(result.content[0].text).toContain("555-1234");
    expect(result.content[0].text).toContain("$500.00");
    expect(result.content[0].text).toContain("123 Main St");
  });

  it("handles customer with no optional fields", async () => {
    mockSuccess(client.getCustomer, {
      Id: "99",
      SyncToken: "0",
      DisplayName: "Bare Minimum",
      Active: true,
      Balance: 0,
    });

    const result = await handleGetCustomer(client as never, { id: "99" });

    expect(result.content[0].text).toContain("Bare Minimum");
    expect(result.content[0].text).toContain("(none)");
  });

  it("propagates API errors", async () => {
    mockError(client.getCustomer, "Not Found");

    await expect(
      handleGetCustomer(client as never, { id: "999" })
    ).rejects.toThrow("Not Found");
  });
});

describe("handleEditCustomer", () => {
  let client: ReturnType<typeof createMockClient>;

  const existingCustomer = {
    Id: "42",
    SyncToken: "3",
    DisplayName: "Old Name",
    Active: true,
    Balance: 0,
  };

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockSuccess(client.getCustomer, existingCustomer);
  });

  it("returns preview in draft mode", async () => {
    const result = await handleEditCustomer(client as never, {
      id: "42",
      display_name: "New Name",
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("Old Name");
    expect(result.content[0].text).toContain("New Name");
    expect(client.updateCustomer).not.toHaveBeenCalled();
  });

  it("sends sparse update when draft=false", async () => {
    mockSuccess(client.updateCustomer, { Id: "42", SyncToken: "4", DisplayName: "New Name" });

    const result = await handleEditCustomer(client as never, {
      id: "42",
      display_name: "New Name",
      email: "new@acme.com",
      draft: false,
    });

    const payload = client.updateCustomer.mock.calls[0][0];
    expect(payload.Id).toBe("42");
    expect(payload.SyncToken).toBe("3");
    expect(payload.sparse).toBe(true);
    expect(payload.DisplayName).toBe("New Name");
    expect(payload.PrimaryEmailAddr).toEqual({ Address: "new@acme.com" });
    expect(result.content[0].text).toContain("updated successfully");
  });

  it("propagates API errors", async () => {
    mockError(client.updateCustomer, "Stale Object");

    await expect(
      handleEditCustomer(client as never, {
        id: "42",
        display_name: "Conflict",
        draft: false,
      })
    ).rejects.toThrow("Stale Object");
  });
});
