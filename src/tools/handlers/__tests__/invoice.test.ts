import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockClient,
  mockSuccess,
  mockError,
  resetMockClient,
  mockPromisify,
} from "../../../__mocks__/mock-client.js";
import {
  createMockDepartmentCache,
} from "../../../__mocks__/mock-cache.js";

vi.mock("../../../client/index.js", () => ({
    promisify: mockPromisify,
    getAccountCache: vi.fn(),
    getDepartmentCache: vi.fn(),
    resolveItem: vi.fn(),
    resolveCustomer: vi.fn(),
    resolveCustomerById: vi.fn(),
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
  return {
    ...actual,
    outputReport: vi.fn((_type: string, _data: unknown, summary: string) => ({
      content: [{ type: "text", text: summary }],
    })),
    getQboUrl: vi.fn((_entity: string, id: string) => `https://app.qbo.intuit.com/app/invoice?txnId=${id}`),
  };
});

import { handleCreateInvoice, handleGetInvoice, handleEditInvoice } from "../invoice.js";
import { getDepartmentCache, resolveItem, resolveCustomer, resolveCustomerById } from "../../../client/index.js";

const mockGetDepartmentCache = vi.mocked(getDepartmentCache);
const mockResolveItem = vi.mocked(resolveItem);
const mockResolveCustomer = vi.mocked(resolveCustomer);
const mockResolveCustomerById = vi.mocked(resolveCustomerById);

describe("handleCreateInvoice", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockGetDepartmentCache.mockResolvedValue(createMockDepartmentCache() as never);
    mockResolveCustomer.mockResolvedValue({ value: "200", name: "Acme Corp" });
    mockResolveCustomerById.mockResolvedValue({ value: "201", name: "Customer By ID" });
    mockResolveItem.mockResolvedValue({ value: "300", name: "Consulting Services" });
  });

  it("returns preview in draft mode", async () => {
    const result = await handleCreateInvoice(client as never, {
      txn_date: "2026-04-01",
      customer_name: "Acme Corp",
      lines: [{ item_name: "Consulting Services", amount: 500 }],
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("Acme Corp");
    expect(client.createInvoice).not.toHaveBeenCalled();
  });

  it("creates invoice with minimal fields", async () => {
    mockSuccess(client.createInvoice, { Id: "700", DocNumber: "INV-001" });

    const result = await handleCreateInvoice(client as never, {
      txn_date: "2026-04-01",
      customer_name: "Acme Corp",
      draft: false,
      lines: [{ item_name: "Consulting Services", amount: 500 }],
    });

    expect(result.content[0].text).toContain("Invoice Created");
    expect(client.createInvoice).toHaveBeenCalledOnce();
  });

  it("creates with all optional fields", async () => {
    mockSuccess(client.createInvoice, { Id: "701" });
    // Mock findTerms for sales term resolution (called with just callback, no criteria)
    mockSuccess(client.findTerms, { QueryResponse: { Term: [{ Id: "50", Name: "Net 30" }] } });

    await handleCreateInvoice(client as never, {
      txn_date: "2026-04-01",
      customer_name: "Acme Corp",
      due_date: "2026-05-01",
      department_name: "Santa Rosa",
      memo: "April consulting",
      customer_memo: "Thank you for your business",
      bill_email: "billing@acme.com",
      sales_term_ref: "Net 30",
      allow_online_credit_card_payment: true,
      allow_online_ach_payment: true,
      doc_number: "INV-701",
      draft: false,
      lines: [{ item_name: "Consulting Services", qty: 10, unit_price: 150 }],
    });

    const payload = client.createInvoice.mock.calls[0][0];
    expect(payload.DueDate).toBe("2026-05-01");
    expect(payload.DepartmentRef).toEqual({ value: "20", name: "Santa Rosa" });
    expect(payload.PrivateNote).toBe("April consulting");
    expect(payload.CustomerMemo).toEqual({ value: "Thank you for your business" });
    expect(payload.BillEmail).toEqual({ Address: "billing@acme.com" });
    expect(payload.AllowOnlineCreditCardPayment).toBe(true);
    expect(payload.AllowOnlineACHPayment).toBe(true);
    expect(payload.DocNumber).toBe("INV-701");
  });

  it("builds SalesItemLineDetail payload (not account-based)", async () => {
    mockSuccess(client.createInvoice, { Id: "702" });

    await handleCreateInvoice(client as never, {
      txn_date: "2026-04-01",
      customer_name: "Acme Corp",
      draft: false,
      lines: [{ item_name: "Consulting Services", qty: 5, unit_price: 200 }],
    });

    const payload = client.createInvoice.mock.calls[0][0];
    const line = payload.Line[0];
    expect(line.DetailType).toBe("SalesItemLineDetail");
    expect(line.SalesItemLineDetail.ItemRef).toEqual({ value: "300", name: "Consulting Services" });
    expect(line.SalesItemLineDetail.Qty).toBe(5);
    expect(line.SalesItemLineDetail.UnitPrice).toBe(200);
    expect(line.Amount).toBe(1000);
  });

  it("computes unit_price from amount when qty provided", async () => {
    mockSuccess(client.createInvoice, { Id: "703" });

    await handleCreateInvoice(client as never, {
      txn_date: "2026-04-01",
      customer_name: "Acme Corp",
      draft: false,
      lines: [{ item_name: "Consulting Services", amount: 1000, qty: 4 }],
    });

    const payload = client.createInvoice.mock.calls[0][0];
    const line = payload.Line[0];
    expect(line.Amount).toBe(1000);
    expect(line.SalesItemLineDetail.Qty).toBe(4);
    expect(line.SalesItemLineDetail.UnitPrice).toBe(250); // 1000/4
  });

  it("resolves customer name to CustomerRef", async () => {
    mockSuccess(client.createInvoice, { Id: "704" });

    await handleCreateInvoice(client as never, {
      txn_date: "2026-04-01",
      customer_name: "Acme Corp",
      draft: false,
      lines: [{ item_name: "Consulting Services", amount: 100 }],
    });

    const payload = client.createInvoice.mock.calls[0][0];
    expect(payload.CustomerRef).toEqual({ value: "200", name: "Acme Corp" });
    expect(mockResolveCustomer).toHaveBeenCalledWith(expect.anything(), "Acme Corp");
  });

  it("resolves an uncached customer ID to CustomerRef", async () => {
    mockSuccess(client.createInvoice, { Id: "705" });

    await handleCreateInvoice(client as never, {
      txn_date: "2026-04-01",
      customer_id: "201",
      draft: false,
      lines: [{ item_name: "Consulting Services", amount: 100 }],
    });

    const payload = client.createInvoice.mock.calls[0][0];
    expect(payload.CustomerRef).toEqual({ value: "201", name: "Customer By ID" });
    expect(mockResolveCustomerById).toHaveBeenCalledWith(expect.anything(), "201");
    expect(mockResolveCustomer).not.toHaveBeenCalled();
  });

  it("uses item_id directly without a name lookup", async () => {
    mockSuccess(client.createInvoice, { Id: "706" });

    await handleCreateInvoice(client as never, {
      txn_date: "2026-04-01",
      customer_id: "201",
      draft: false,
      lines: [{ item_id: "301", amount: 100 }],
    });

    const payload = client.createInvoice.mock.calls[0][0];
    expect(payload.Line[0].SalesItemLineDetail.ItemRef).toEqual({ value: "301" });
    expect(mockResolveItem).not.toHaveBeenCalled();
  });

  it("rejects item_name combined with item_id", async () => {
    await expect(handleCreateInvoice(client as never, {
      txn_date: "2026-04-01",
      customer_id: "201",
      lines: [{ item_name: "Consulting Services", item_id: "301", amount: 100 }],
    })).rejects.toThrow("Provide only one of item_name or item_id per line");
  });

  it("throws when customer not found", async () => {
    mockResolveCustomer.mockRejectedValue(new Error("Customer not found: Unknown"));

    await expect(
      handleCreateInvoice(client as never, {
        txn_date: "2026-04-01",
        customer_name: "Unknown",
        lines: [{ item_name: "Consulting Services", amount: 100 }],
      })
    ).rejects.toThrow("Customer not found");
  });

  it("throws when item not found", async () => {
    mockResolveItem.mockRejectedValue(new Error("Item not found: Bad Item"));

    await expect(
      handleCreateInvoice(client as never, {
        txn_date: "2026-04-01",
        customer_name: "Acme Corp",
        lines: [{ item_name: "Bad Item", amount: 100 }],
      })
    ).rejects.toThrow("Item not found");
  });

  it("throws when neither customer_name nor customer_id", async () => {
    await expect(
      handleCreateInvoice(client as never, {
        txn_date: "2026-04-01",
        lines: [{ item_name: "Consulting Services", amount: 100 }],
      })
    ).rejects.toThrow("customer");
  });

  it("throws when both customer_name and customer_id are provided", async () => {
    await expect(
      handleCreateInvoice(client as never, {
        txn_date: "2026-04-01",
        customer_name: "Acme Corp",
        customer_id: "201",
        lines: [{ item_name: "Consulting Services", amount: 100 }],
      })
    ).rejects.toThrow("exactly one");
    expect(mockResolveCustomer).not.toHaveBeenCalled();
    expect(mockResolveCustomerById).not.toHaveBeenCalled();
  });

  it("throws when sales term not found", async () => {
    mockSuccess(client.findTerms, {
      QueryResponse: { Term: [{ Id: "50", Name: "Net 30" }, { Id: "51", Name: "Due on receipt" }] },
    });

    await expect(
      handleCreateInvoice(client as never, {
        txn_date: "2026-04-01",
        customer_name: "Acme Corp",
        sales_term_ref: "Net 60",
        draft: false,
        lines: [{ item_name: "Consulting Services", amount: 100 }],
      })
    ).rejects.toThrow(/Term not found: "Net 60".*Available:.*Net 30/);
  });

  it("propagates API errors", async () => {
    mockError(client.createInvoice, "Duplicate DocNumber");

    await expect(
      handleCreateInvoice(client as never, {
        txn_date: "2026-04-01",
        customer_name: "Acme Corp",
        draft: false,
        lines: [{ item_name: "Consulting Services", amount: 100 }],
      })
    ).rejects.toThrow("Duplicate DocNumber");
  });
});

describe("handleGetInvoice", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns formatted invoice with SyncToken", async () => {
    mockSuccess(client.getInvoice, {
      Id: "700",
      SyncToken: "4",
      TxnDate: "2026-04-01",
      CustomerRef: { value: "200", name: "Acme Corp" },
      TotalAmt: 500,
      Line: [],
    });

    const result = await handleGetInvoice(client as never, { id: "700" });
    expect(result.content[0].text).toContain("SyncToken: 4");
    expect(result.content[0].text).toContain("Acme Corp");
  });

  it("propagates API errors", async () => {
    mockError(client.getInvoice, "Object Not Found");
    await expect(handleGetInvoice(client as never, { id: "999" })).rejects.toThrow("Object Not Found");
  });
});

describe("handleEditInvoice", () => {
  let client: ReturnType<typeof createMockClient>;

  const existingInvoice = {
    Id: "700",
    SyncToken: "4",
    TxnDate: "2026-04-01",
    DueDate: "2026-05-01",
    DocNumber: "INV-001",
    PrivateNote: "Original",
    CustomerRef: { value: "200", name: "Acme Corp" },
    DepartmentRef: { value: "10" },
    TotalAmt: 500,
    Line: [
      {
        Id: "1",
        Amount: 500,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: { ItemRef: { value: "300", name: "Consulting" }, Qty: 5, UnitPrice: 100 },
      },
    ],
  };

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockGetDepartmentCache.mockResolvedValue(createMockDepartmentCache() as never);
    mockResolveCustomer.mockResolvedValue({ value: "200", name: "Acme Corp" });
    mockResolveItem.mockResolvedValue({ value: "300", name: "Consulting Services" });
    mockSuccess(client.getInvoice, existingInvoice);
  });

  it("sparse update for header-only changes", async () => {
    mockSuccess(client.updateInvoice, { Id: "700", SyncToken: "5" });

    await handleEditInvoice(client as never, {
      id: "700",
      memo: "Updated memo",
      draft: false,
    });

    const payload = client.updateInvoice.mock.calls[0][0];
    expect(payload.sparse).toBe(true);
    expect(payload.PrivateNote).toBe("Updated memo");
  });

  it("full update when lines are modified", async () => {
    mockSuccess(client.updateInvoice, { Id: "700", SyncToken: "5" });

    await handleEditInvoice(client as never, {
      id: "700",
      draft: false,
      lines: [{ line_id: "1", amount: 600 }],
    });

    const payload = client.updateInvoice.mock.calls[0][0];
    expect(payload.sparse).toBe(false);
  });

  it("uses item_id directly when adding a line", async () => {
    mockSuccess(client.updateInvoice, { Id: "700", SyncToken: "5" });

    await handleEditInvoice(client as never, {
      id: "700",
      draft: false,
      lines: [{ item_id: "301", amount: 25 }],
    });

    const payload = client.updateInvoice.mock.calls[0][0];
    expect(payload.Line[1].SalesItemLineDetail.ItemRef).toEqual({ value: "301" });
    expect(mockResolveItem).not.toHaveBeenCalled();
  });

  it("propagates API errors", async () => {
    mockError(client.updateInvoice, "Stale SyncToken");
    await expect(
      handleEditInvoice(client as never, { id: "700", memo: "x", draft: false })
    ).rejects.toThrow("Stale SyncToken");
  });

  it("deletes a line when delete=true", async () => {
    const twoLineInvoice = {
      ...existingInvoice,
      Line: [
        { Id: "1", Amount: 300, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "300", name: "Consulting" }, Qty: 3, UnitPrice: 100 } },
        { Id: "2", Amount: 200, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "300", name: "Consulting" }, Qty: 2, UnitPrice: 100 } },
      ],
    };
    mockSuccess(client.getInvoice, twoLineInvoice);
    mockSuccess(client.updateInvoice, { Id: "700", SyncToken: "5" });

    await handleEditInvoice(client as never, {
      id: "700",
      lines: [{ line_id: "2", delete: true }],
      draft: false,
    });

    const payload = client.updateInvoice.mock.calls[0][0];
    expect(payload.Line).toHaveLength(1);
    expect(payload.Line[0].Id).toBe("1");
  });

  it("throws when line_id not found", async () => {
    await expect(
      handleEditInvoice(client as never, {
        id: "700",
        lines: [{ line_id: "nonexistent", amount: 100 }],
        draft: false,
      })
    ).rejects.toThrow('Line ID nonexistent not found in invoice');
  });
});
