import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  mockError,
  mockPromisify,
  mockSuccess,
  resetMockClient,
} from "../../../__mocks__/mock-client.js";

vi.mock("../../../client/index.js", () => ({
  promisify: mockPromisify,
  clearVendorCache: vi.fn(),
}));

vi.mock("../../../utils/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/index.js")>(
    "../../../utils/index.js"
  );
  return {
    ...actual,
    outputReport: vi.fn((_type: string, _data: unknown, summary: string) => ({
      content: [{ type: "text", text: summary }],
    })),
  };
});

import { clearVendorCache } from "../../../client/index.js";
import { outputReport } from "../../../utils/index.js";
import {
  handleCreateVendor,
  handleDeactivateVendor,
  handleEditVendor,
  handleGetVendor,
} from "../vendor.js";

const mockClearVendorCache = vi.mocked(clearVendorCache);
const mockOutputReport = vi.mocked(outputReport);

const existingVendor = {
  Id: "42",
  SyncToken: "3",
  DisplayName: "Acme Supplies",
  GivenName: "Alex",
  FamilyName: "Vendor",
  CompanyName: "Acme LLC",
  PrintOnCheckName: "Acme",
  PrimaryEmailAddr: { Address: "books@acme.test" },
  PrimaryPhone: { FreeFormNumber: "555-1000" },
  Mobile: { FreeFormNumber: "555-2000" },
  Fax: { FreeFormNumber: "555-3000" },
  WebAddr: { URI: "https://acme.test" },
  BillAddr: {
    Line1: "123 Main St",
    City: "Portland",
    CountrySubDivisionCode: "OR",
    PostalCode: "97201",
  },
  Vendor1099: true,
  AcctNum: "V-100",
  TermRef: { value: "3", name: "Net 30" },
  Active: true,
  Balance: 250.5,
  CurrencyRef: { value: "USD", name: "United States Dollar" },
  MetaData: {
    CreateTime: "2026-01-01T00:00:00Z",
    LastUpdatedTime: "2026-02-01T00:00:00Z",
  },
};

describe("handleCreateVendor", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns a draft preview without writing or invalidating cache", async () => {
    const result = await handleCreateVendor(client as never, {
      display_name: "Acme Supplies",
      email: "books@acme.test",
    });

    expect(result.content[0].text).toContain("DRAFT - Vendor Preview");
    expect(result.content[0].text).toContain("Acme Supplies");
    expect(result.content[0].text).toContain("books@acme.test");
    expect(client.createVendor).not.toHaveBeenCalled();
    expect(mockClearVendorCache).not.toHaveBeenCalled();
  });

  it("creates a vendor with all supported fields", async () => {
    mockSuccess(client.findTerms, {
      QueryResponse: { Term: [{ Id: "3", Name: "Net 30" }] },
    });
    mockSuccess(client.createVendor, {
      Id: "42",
      SyncToken: "0",
      DisplayName: "Acme Supplies",
    });
    mockSuccess(client.updateVendor, {
      Id: "42",
      SyncToken: "1",
      DisplayName: "Acme Supplies",
      TermRef: { value: "3", name: "Net 30" },
    });

    const result = await handleCreateVendor(client as never, {
      display_name: "Acme Supplies",
      title: "Ms.",
      given_name: "Alex",
      middle_name: "Q",
      family_name: "Vendor",
      suffix: "Jr.",
      company_name: "Acme LLC",
      print_on_check_name: "Acme",
      email: "books@acme.test",
      phone: "555-1000",
      mobile: "555-2000",
      fax: "555-3000",
      web_address: "https://acme.test",
      bill_address: {
        line1: "123 Main St",
        city: "Portland",
        country_sub_division_code: "OR",
        postal_code: "97201",
      },
      vendor_1099: true,
      account_number: "V-100",
      terms_ref: "Net 30",
      draft: false,
    });

    const payload = client.createVendor.mock.calls[0][0];
    expect(payload).toMatchObject({
      DisplayName: "Acme Supplies",
      Title: "Ms.",
      GivenName: "Alex",
      MiddleName: "Q",
      FamilyName: "Vendor",
      Suffix: "Jr.",
      CompanyName: "Acme LLC",
      PrintOnCheckName: "Acme",
      PrimaryEmailAddr: { Address: "books@acme.test" },
      PrimaryPhone: { FreeFormNumber: "555-1000" },
      Mobile: { FreeFormNumber: "555-2000" },
      Fax: { FreeFormNumber: "555-3000" },
      WebAddr: { URI: "https://acme.test" },
      BillAddr: {
        Line1: "123 Main St",
        City: "Portland",
        CountrySubDivisionCode: "OR",
        PostalCode: "97201",
      },
      Vendor1099: true,
      AcctNum: "V-100",
    });
    expect(client.updateVendor.mock.calls[0][0]).toEqual({
      Id: "42",
      SyncToken: "0",
      sparse: true,
      TermRef: { value: "3", name: "Net 30" },
    });
    expect(mockClearVendorCache).toHaveBeenCalledOnce();
    expect(result.content[0].text).toContain("Vendor Created");
    expect(result.content[0].text).toContain("SyncToken: 1");
    expect(result.content[0].text).toContain("vendordetail?nameId=42");
  });

  it("requires a non-empty display name", async () => {
    await expect(handleCreateVendor(client as never, { display_name: "   " }))
      .rejects.toThrow("display_name is required");
    expect(client.createVendor).not.toHaveBeenCalled();
  });

  it.each([
    ["display_name", "A".repeat(501), "500 characters"],
    ["title", "A".repeat(17), "16 characters"],
    ["given_name", "A".repeat(101), "100 characters"],
    ["account_number", "A".repeat(101), "100 characters"],
  ] as const)("validates the %s limit", async (field, value, message) => {
    await expect(handleCreateVendor(client as never, {
      display_name: "Acme",
      [field]: value,
    })).rejects.toThrow(message);
  });

  it.each(["Bad:Name", "Bad\tName", "Bad\nName"])(
    "rejects QBO-forbidden display name characters in %j",
    async (displayName) => {
      await expect(handleCreateVendor(client as never, { display_name: displayName }))
        .rejects.toThrow("cannot contain a colon, tab, or newline");
    }
  );

  it("validates email locally", async () => {
    await expect(handleCreateVendor(client as never, {
      display_name: "Acme",
      email: "not-an-email",
    })).rejects.toThrow("email must contain a valid address");
  });

  it("rejects empty optional values instead of treating them as clears", async () => {
    await expect(handleCreateVendor(client as never, {
      display_name: "Acme",
      email: "",
    })).rejects.toThrow("email cannot be empty");
    await expect(handleCreateVendor(client as never, {
      display_name: "Acme",
      bill_address: {},
    })).rejects.toThrow("bill_address cannot be empty");
  });

  it("does not invalidate cache when QBO creation fails", async () => {
    mockError(client.createVendor, "Duplicate Name Exists");

    await expect(handleCreateVendor(client as never, {
      display_name: "Acme Supplies",
      draft: false,
    })).rejects.toThrow("Duplicate Name Exists");
    expect(mockClearVendorCache).not.toHaveBeenCalled();
  });

  it("reports partial success and invalidates cache when terms update fails", async () => {
    mockSuccess(client.findTerms, {
      QueryResponse: { Term: [{ Id: "3", Name: "Net 30" }] },
    });
    mockSuccess(client.createVendor, {
      Id: "42",
      SyncToken: "0",
      DisplayName: "Acme Supplies",
    });
    mockError(client.updateVendor, "Terms update failed");

    const result = await handleCreateVendor(client as never, {
      display_name: "Acme Supplies",
      terms_ref: "Net 30",
      draft: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(
      "Vendor Acme Supplies (ID: 42) was created, but default terms could not be applied"
    );
    expect(result.content[0].text).toContain("Use edit_vendor to apply terms");
    expect(mockClearVendorCache).toHaveBeenCalledOnce();
  });
});

describe("handleGetVendor", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns complete formatted vendor details", async () => {
    mockSuccess(client.getVendor, {
      ...existingVendor,
      TaxIdentifier: "XXXXX6789",
      VendorPaymentBankDetail: { BankAccountName: "Sensitive Account" },
    });

    const result = await handleGetVendor(client as never, { id: "42" });
    const text = result.content[0].text;

    expect(client.getVendor).toHaveBeenCalledWith("42", expect.any(Function));
    expect(text).toContain("SyncToken: 3");
    expect(text).toContain("Acme Supplies");
    expect(text).toContain("books@acme.test");
    expect(text).toContain("123 Main St");
    expect(text).toContain("Net 30");
    expect(text).toContain("1099 Vendor: true");
    expect(text).toContain("Balance: $250.50");
    expect(text).toContain("United States Dollar");
    expect(text).toContain("vendordetail?nameId=42");
    const reportData = mockOutputReport.mock.calls[0][1] as Record<string, unknown>;
    expect(reportData).not.toHaveProperty("TaxIdentifier");
    expect(reportData).not.toHaveProperty("VendorPaymentBankDetail");
    expect(reportData).toMatchObject({
      Id: "42",
      SyncToken: "3",
      DisplayName: "Acme Supplies",
      AcctNum: "V-100",
    });
  });

  it("formats a minimal vendor", async () => {
    mockSuccess(client.getVendor, {
      Id: "43",
      SyncToken: "0",
      DisplayName: "Minimal Vendor",
      Active: true,
    });

    const result = await handleGetVendor(client as never, { id: "43" });
    expect(result.content[0].text).toContain("Minimal Vendor");
    expect(result.content[0].text).toContain("Email: (none)");
    expect(result.content[0].text).toContain("Balance: $0.00");
  });

  it("propagates QBO read errors", async () => {
    mockError(client.getVendor, "Object Not Found");
    await expect(handleGetVendor(client as never, { id: "999" }))
      .rejects.toThrow("Object Not Found");
  });
});

describe("handleEditVendor", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockSuccess(client.getVendor, existingVendor);
  });

  it("returns a draft diff without updating or invalidating cache", async () => {
    const result = await handleEditVendor(client as never, {
      id: "42",
      display_name: "Acme Wholesale",
      email: "new@acme.test",
    });

    expect(result.content[0].text).toContain("DRAFT - Vendor Edit Preview");
    expect(result.content[0].text).toContain("Acme Supplies → Acme Wholesale");
    expect(result.content[0].text).toContain("books@acme.test → new@acme.test");
    expect(client.updateVendor).not.toHaveBeenCalled();
    expect(mockClearVendorCache).not.toHaveBeenCalled();
  });

  it("uses the latest fetched SyncToken in a sparse update", async () => {
    mockSuccess(client.updateVendor, {
      Id: "42",
      SyncToken: "4",
      DisplayName: "Acme Supplies",
    });

    const result = await handleEditVendor(client as never, {
      id: "42",
      email: "new@acme.test",
      active: true,
      draft: false,
    });

    expect(client.getVendor).toHaveBeenCalledOnce();
    const payload = client.updateVendor.mock.calls[0][0];
    expect(payload).toEqual({
      Id: "42",
      SyncToken: "3",
      sparse: true,
      PrimaryEmailAddr: { Address: "new@acme.test" },
      Active: true,
    });
    expect(payload).not.toHaveProperty("DisplayName");
    expect(payload).not.toHaveProperty("CompanyName");
    expect(mockClearVendorCache).toHaveBeenCalledOnce();
    expect(result.content[0].text).toContain("New SyncToken: 4");
  });

  it("resolves and assigns payment terms", async () => {
    mockSuccess(client.findTerms, {
      QueryResponse: { Term: [{ Id: "4", Name: "Net 60" }] },
    });
    mockSuccess(client.updateVendor, {
      Id: "42",
      SyncToken: "4",
      DisplayName: "Acme Supplies",
    });

    await handleEditVendor(client as never, {
      id: "42",
      terms_ref: "Net 60",
      draft: false,
    });

    expect(client.updateVendor.mock.calls[0][0].TermRef)
      .toEqual({ value: "4", name: "Net 60" });
  });

  it("uses sandbox-verified empty values for clear directives", async () => {
    mockSuccess(client.updateVendor, {
      Id: "42",
      SyncToken: "4",
      DisplayName: "Acme Supplies",
    });

    await handleEditVendor(client as never, {
      id: "42",
      clear_email: true,
      clear_phone: true,
      clear_mobile: true,
      clear_fax: true,
      clear_web_address: true,
      clear_bill_address: true,
      clear_terms: true,
      clear_account_number: true,
      draft: false,
    });

    expect(client.updateVendor.mock.calls[0][0]).toMatchObject({
      PrimaryEmailAddr: {},
      PrimaryPhone: {},
      Mobile: {},
      Fax: {},
      WebAddr: {},
      BillAddr: {},
      TermRef: { value: "" },
      AcctNum: "",
    });
  });

  it.each([
    ["email", "clear_email", "a@b.test"],
    ["phone", "clear_phone", "555-1000"],
    ["mobile", "clear_mobile", "555-2000"],
    ["fax", "clear_fax", "555-3000"],
    ["web_address", "clear_web_address", "https://acme.test"],
    ["bill_address", "clear_bill_address", { line1: "123 Main" }],
    ["terms_ref", "clear_terms", "Net 30"],
    ["account_number", "clear_account_number", "V-100"],
  ] as const)("rejects %s with its clear directive", async (field, clearField, value) => {
    await expect(handleEditVendor(client as never, {
      id: "42",
      [field]: value,
      [clearField]: true,
    })).rejects.toThrow("together");
    expect(client.getVendor).not.toHaveBeenCalled();
  });

  it("rejects an edit with no change directives before reading QBO", async () => {
    await expect(handleEditVendor(client as never, { id: "42" }))
      .rejects.toThrow("At least one vendor change is required");
    expect(client.getVendor).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only display name before reading QBO", async () => {
    await expect(handleEditVendor(client as never, {
      id: "42",
      display_name: "   ",
    })).rejects.toThrow("display_name is required");
    expect(client.getVendor).not.toHaveBeenCalled();
  });

  it("does not invalidate cache when the update fails", async () => {
    mockError(client.updateVendor, "Stale Object");

    await expect(handleEditVendor(client as never, {
      id: "42",
      company_name: "New Company",
      draft: false,
    })).rejects.toThrow("Stale Object");
    expect(mockClearVendorCache).not.toHaveBeenCalled();
  });
});

describe("handleDeactivateVendor", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("shows a draft warning with balance and does not update", async () => {
    mockSuccess(client.getVendor, existingVendor);

    const result = await handleDeactivateVendor(client as never, { id: "42" });

    expect(result.content[0].text).toContain("DRAFT - Vendor Deactivation Preview");
    expect(result.content[0].text).toContain("Balance: $250.50");
    expect(result.content[0].text).toContain("Historical transactions will remain unchanged");
    expect(result.content[0].text).toContain("active=true");
    expect(client.updateVendor).not.toHaveBeenCalled();
    expect(mockClearVendorCache).not.toHaveBeenCalled();
  });

  it("deactivates with the latest fetched SyncToken", async () => {
    mockSuccess(client.getVendor, existingVendor);
    mockSuccess(client.updateVendor, {
      Id: "42",
      SyncToken: "4",
      DisplayName: "Acme Supplies",
      Active: false,
    });

    const result = await handleDeactivateVendor(client as never, {
      id: "42",
      draft: false,
    });

    expect(client.updateVendor.mock.calls[0][0]).toEqual({
      Id: "42",
      SyncToken: "3",
      sparse: true,
      Active: false,
    });
    expect(mockClearVendorCache).toHaveBeenCalledOnce();
    expect(result.content[0].text).toContain("deactivated successfully");
    expect(result.content[0].text).toContain("New SyncToken: 4");
  });

  it("returns an explicit no-op when already inactive", async () => {
    mockSuccess(client.getVendor, { ...existingVendor, Active: false });

    const result = await handleDeactivateVendor(client as never, {
      id: "42",
      draft: false,
    });

    expect(result.content[0].text).toContain("already inactive");
    expect(result.content[0].text).toContain("No changes were made");
    expect(client.updateVendor).not.toHaveBeenCalled();
    expect(mockClearVendorCache).not.toHaveBeenCalled();
  });

  it("does not invalidate cache when deactivation fails", async () => {
    mockSuccess(client.getVendor, existingVendor);
    mockError(client.updateVendor, "Stale Object");

    await expect(handleDeactivateVendor(client as never, {
      id: "42",
      draft: false,
    })).rejects.toThrow("Stale Object");
    expect(mockClearVendorCache).not.toHaveBeenCalled();
  });
});
