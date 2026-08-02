import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockClient,
  mockSuccess,
  mockError,
  resetMockClient,
  mockPromisify,
} from "../../../__mocks__/mock-client.js";
import {
  createMockAccountCache,
  createMockDepartmentCache,
  createMockVendorCache,
} from "../../../__mocks__/mock-cache.js";

vi.mock("../../../client/index.js", () => ({
    promisify: mockPromisify,
    getAccountCache: vi.fn(),
    getDepartmentCache: vi.fn(),
    getVendorCache: vi.fn(),
    resolveVendor: vi.fn(),
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
    getQboUrl: vi.fn((_entity: string, id: string) => `https://app.qbo.intuit.com/app/bill?txnId=${id}`),
  };
});

import { handleCreateBill, handleGetBill, handleEditBill } from "../bill.js";
import {
  getAccountCache,
  getDepartmentCache,
  getVendorCache,
  resolveCustomer,
  resolveCustomerById,
} from "../../../client/index.js";

const mockGetAccountCache = vi.mocked(getAccountCache);
const mockGetDepartmentCache = vi.mocked(getDepartmentCache);
const mockGetVendorCache = vi.mocked(getVendorCache);
const mockResolveCustomer = vi.mocked(resolveCustomer);
const mockResolveCustomerById = vi.mocked(resolveCustomerById);

function createVendorCacheWithNewVendor() {
  const cache = createMockVendorCache();
  const vendor = { Id: "200", DisplayName: "New Vendor" };
  return {
    ...cache,
    items: [...cache.items, vendor],
    byId: new Map(cache.byId).set(vendor.Id, vendor),
    byName: new Map(cache.byName).set(vendor.DisplayName.toLowerCase(), vendor),
    fetchedAt: Date.now(),
  };
}

describe("handleCreateBill", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockGetAccountCache.mockResolvedValue(createMockAccountCache() as never);
    mockGetDepartmentCache.mockResolvedValue(createMockDepartmentCache() as never);
    mockGetVendorCache.mockResolvedValue(createMockVendorCache() as never);
    mockResolveCustomer.mockResolvedValue({ value: "300", name: "Customer One:Job One" });
    mockResolveCustomerById.mockResolvedValue({ value: "301", name: "Customer By ID" });
  });

  it("returns preview in draft mode", async () => {
    const result = await handleCreateBill(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2026-03-01",
      lines: [{ account_name: "Office Supplies", amount: 150, description: "Paper" }],
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("Office Depot");
    expect(result.content[0].text).toContain("$150.00");
    expect(client.createBill).not.toHaveBeenCalled();
  });

  it("returns preview with stale vendor cache in default draft mode", async () => {
    mockGetVendorCache
      .mockResolvedValueOnce(createMockVendorCache() as never)
      .mockResolvedValueOnce(createVendorCacheWithNewVendor() as never);

    const result = await handleCreateBill(client as never, {
      vendor_name: "New Vendor",
      txn_date: "2026-01-01",
      lines: [{ account_name: "Cash", amount: 10 }],
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("New Vendor");
    expect(client.createBill).not.toHaveBeenCalled();
    expect(mockGetVendorCache).toHaveBeenCalledTimes(2);
    expect(mockGetVendorCache).toHaveBeenLastCalledWith(client, { forceRefresh: true });
  });

  it("creates bill with minimal fields when draft=false", async () => {
    mockSuccess(client.createBill, { Id: "500", DocNumber: "B-001" });

    const result = await handleCreateBill(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2026-03-01",
      draft: false,
      lines: [{ account_name: "Office Supplies", amount: 75 }],
    });

    expect(result.content[0].text).toContain("Bill Created");
    expect(client.createBill).toHaveBeenCalledOnce();
    expect(mockGetVendorCache).toHaveBeenCalledOnce();
    expect(mockGetVendorCache).toHaveBeenCalledWith(client);
  });

  it("refreshes a stale vendor cache and creates by vendor name", async () => {
    mockGetVendorCache
      .mockResolvedValueOnce(createMockVendorCache() as never)
      .mockResolvedValueOnce(createVendorCacheWithNewVendor() as never);
    mockSuccess(client.createBill, { Id: "504" });

    await handleCreateBill(client as never, {
      vendor_name: "New Vendor",
      txn_date: "2026-01-01",
      draft: false,
      lines: [{ account_name: "Cash", amount: 10 }],
    });

    const payload = client.createBill.mock.calls[0][0];
    expect(payload.VendorRef).toEqual({ value: "200", name: "New Vendor" });
    expect(mockGetVendorCache).toHaveBeenCalledTimes(2);
    expect(mockGetVendorCache).toHaveBeenLastCalledWith(client, { forceRefresh: true });
  });

  it("refreshes a stale vendor cache and creates by vendor ID", async () => {
    mockGetVendorCache
      .mockResolvedValueOnce(createMockVendorCache() as never)
      .mockResolvedValueOnce(createVendorCacheWithNewVendor() as never);
    mockSuccess(client.createBill, { Id: "505" });

    await handleCreateBill(client as never, {
      vendor_id: "200",
      txn_date: "2026-01-01",
      draft: false,
      lines: [{ account_name: "Cash", amount: 10 }],
    });

    const payload = client.createBill.mock.calls[0][0];
    expect(payload.VendorRef).toEqual({ value: "200", name: "New Vendor" });
    expect(mockGetVendorCache).toHaveBeenCalledTimes(2);
    expect(mockGetVendorCache).toHaveBeenLastCalledWith(client, { forceRefresh: true });
  });

  it("creates with all optional fields", async () => {
    mockSuccess(client.createBill, { Id: "501" });

    await handleCreateBill(client as never, {
      vendor_name: "Shell Gas Station",
      txn_date: "2026-04-01",
      due_date: "2026-05-01",
      department_name: "Santa Rosa",
      ap_account: "Accounts Payable",
      memo: "April utilities",
      doc_number: "SHELL-2026-04",
      draft: false,
      lines: [{ account_name: "Rent Expense", amount: 200, description: "Gas bill" }],
    });

    const payload = client.createBill.mock.calls[0][0];
    expect(payload.DueDate).toBe("2026-05-01");
    expect(payload.DepartmentRef).toEqual({ value: "20", name: "Santa Rosa" });
    expect(payload.APAccountRef).toEqual({ value: "4", name: "Accounts Payable" });
    expect(payload.PrivateNote).toBe("April utilities");
    expect(payload.DocNumber).toBe("SHELL-2026-04");
  });

  it("builds correct payload with VendorRef and AccountBasedExpenseLineDetail", async () => {
    mockSuccess(client.createBill, { Id: "502" });

    await handleCreateBill(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2026-01-01",
      draft: false,
      lines: [{ account_name: "Office Supplies", amount: 99.99, description: "Toner" }],
    });

    const payload = client.createBill.mock.calls[0][0];
    expect(payload.VendorRef).toEqual({ value: "100", name: "Office Depot" });
    expect(payload.Line[0].DetailType).toBe("AccountBasedExpenseLineDetail");
    expect(payload.Line[0].AccountBasedExpenseLineDetail.AccountRef).toEqual({
      value: "5",
      name: "Office Supplies",
    });
    expect(payload.Line[0].AccountBasedExpenseLineDetail.BillableStatus).toBe("NotBillable");
    expect(payload.Line[0].Amount).toBe(99.99);
  });

  it("assigns a line customer/job by name without making it billable", async () => {
    mockSuccess(client.createBill, { Id: "506" });

    await handleCreateBill(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2026-01-01",
      draft: false,
      lines: [{
        account_name: "Office Supplies",
        customer_name: "Customer One:Job One",
        amount: 25,
      }],
    });

    const detail = client.createBill.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "300", name: "Customer One:Job One" });
    expect(detail.BillableStatus).toBe("NotBillable");
    expect(mockResolveCustomer).toHaveBeenCalledWith(client, "Customer One:Job One");
  });

  it("assigns a line customer/job by ID", async () => {
    mockSuccess(client.createBill, { Id: "507" });

    await handleCreateBill(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2026-01-01",
      draft: false,
      lines: [{ account_name: "Cash", customer_id: "301", amount: 10 }],
    });

    const detail = client.createBill.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "301", name: "Customer By ID" });
    expect(mockResolveCustomerById).toHaveBeenCalledWith(client, "301");
  });

  it("shows a line customer/job in the default draft preview", async () => {
    const result = await handleCreateBill(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2026-01-01",
      lines: [{ account_name: "Cash", customer_name: "Customer One:Job One", amount: 10 }],
    });

    expect(result.content[0].text).toContain("Customer/Job: Customer One:Job One");
    expect(client.createBill).not.toHaveBeenCalled();
  });

  it("deduplicates repeated line customer lookups and preserves line order", async () => {
    mockSuccess(client.createBill, { Id: "508" });

    await handleCreateBill(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2026-01-01",
      draft: false,
      lines: [
        { account_name: "Cash", customer_name: "Customer One:Job One", amount: 10 },
        { account_name: "Tips", customer_name: "customer one:job one", amount: 20 },
      ],
    });

    const payload = client.createBill.mock.calls[0][0];
    expect(payload.Line.map((line: { AccountBasedExpenseLineDetail: { AccountRef: { value: string } } }) =>
      line.AccountBasedExpenseLineDetail.AccountRef.value
    )).toEqual(["1", "2"]);
    expect(mockResolveCustomer).toHaveBeenCalledOnce();
  });

  it("rejects customer_name and customer_id on the same line", async () => {
    await expect(handleCreateBill(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2026-01-01",
      lines: [{
        account_name: "Cash",
        customer_name: "Customer One:Job One",
        customer_id: "301",
        amount: 10,
      }],
    })).rejects.toThrow("only one");
    expect(client.createBill).not.toHaveBeenCalled();
  });

  it("omits optional fields from payload when not provided", async () => {
    mockSuccess(client.createBill, { Id: "503" });

    await handleCreateBill(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2026-01-01",
      draft: false,
      lines: [{ account_name: "Cash", amount: 10 }],
    });

    const payload = client.createBill.mock.calls[0][0];
    expect(payload).not.toHaveProperty("DueDate");
    expect(payload).not.toHaveProperty("DepartmentRef");
    expect(payload).not.toHaveProperty("APAccountRef");
    expect(payload).not.toHaveProperty("DocNumber");
    expect(payload).not.toHaveProperty("PrivateNote");
    expect(payload.Line[0].AccountBasedExpenseLineDetail).not.toHaveProperty("CustomerRef");
  });

  it("throws when vendor not found", async () => {
    await expect(
      handleCreateBill(client as never, {
        vendor_name: "Nonexistent Vendor",
        txn_date: "2026-01-01",
        lines: [{ account_name: "Cash", amount: 10 }],
      })
    ).rejects.toThrow('Vendor not found: "Nonexistent Vendor"');
    expect(mockGetVendorCache).toHaveBeenCalledTimes(2);
    expect(mockGetVendorCache).toHaveBeenLastCalledWith(client, { forceRefresh: true });
  });

  it("throws when neither vendor_name nor vendor_id provided", async () => {
    await expect(
      handleCreateBill(client as never, {
        txn_date: "2026-01-01",
        lines: [{ account_name: "Cash", amount: 10 }],
      })
    ).rejects.toThrow("vendor_name or vendor_id");
  });

  it("throws when account not found in line", async () => {
    await expect(
      handleCreateBill(client as never, {
        vendor_name: "Office Depot",
        txn_date: "2026-01-01",
        lines: [{ account_name: "Nonexistent Account", amount: 50 }],
      })
    ).rejects.toThrow('Account not found: "Nonexistent Account"');
  });

  it("propagates API errors", async () => {
    mockError(client.createBill, "Business Validation Error");

    await expect(
      handleCreateBill(client as never, {
        vendor_name: "Office Depot",
        txn_date: "2026-01-01",
        draft: false,
        lines: [{ account_name: "Cash", amount: 10 }],
      })
    ).rejects.toThrow("Business Validation Error");
  });

  it("creates bill with multiple lines and correct total", async () => {
    mockSuccess(client.createBill, { Id: "504" });

    const result = await handleCreateBill(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2026-03-15",
      draft: false,
      lines: [
        { account_name: "Office Supplies", amount: 75.50, description: "Paper" },
        { account_name: "Rent Expense", amount: 200, description: "Storage" },
        { account_name: "Cash", amount: 24.50 },
      ],
    });

    const payload = client.createBill.mock.calls[0][0];
    expect(payload.Line).toHaveLength(3);
    expect(payload.Line[0].Amount).toBe(75.50);
    expect(payload.Line[1].Amount).toBe(200);
    expect(payload.Line[2].Amount).toBe(24.50);
    expect(result.content[0].text).toContain("$300.00");
  });
});

describe("handleGetBill", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns formatted bill with SyncToken", async () => {
    mockSuccess(client.getBill, {
      Id: "500",
      SyncToken: "2",
      TxnDate: "2026-03-01",
      VendorRef: { value: "100", name: "Office Depot" },
      TotalAmt: 150,
      Line: [],
    });

    const result = await handleGetBill(client as never, { id: "500" });
    expect(result.content[0].text).toContain("SyncToken: 2");
    expect(result.content[0].text).toContain("Office Depot");
  });

  it("shows line customer/job and billable status", async () => {
    mockSuccess(client.getBill, {
      Id: "500",
      SyncToken: "2",
      TxnDate: "2026-03-01",
      VendorRef: { value: "100", name: "Office Depot" },
      TotalAmt: 25,
      Line: [{
        Id: "1",
        Amount: 25,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "5", name: "Office Supplies" },
          CustomerRef: { value: "300", name: "Customer One:Job One" },
          BillableStatus: "NotBillable",
        },
      }],
    });

    const result = await handleGetBill(client as never, { id: "500" });
    expect(result.content[0].text).toContain("Customer/Job: Customer One:Job One");
    expect(result.content[0].text).toContain("NotBillable");
  });

  it("propagates API errors", async () => {
    mockError(client.getBill, "Object Not Found");
    await expect(handleGetBill(client as never, { id: "999" })).rejects.toThrow("Object Not Found");
  });
});

describe("handleEditBill", () => {
  let client: ReturnType<typeof createMockClient>;

  const existingBill = {
    Id: "500",
    SyncToken: "2",
    TxnDate: "2026-03-01",
    DueDate: "2026-04-01",
    DocNumber: "B-001",
    PrivateNote: "Original",
    VendorRef: { value: "100", name: "Office Depot" },
    DepartmentRef: { value: "10", name: "Main Office" },
    APAccountRef: { value: "4", name: "Accounts Payable" },
    SalesTermRef: { value: "3", name: "Net 30" },
    CurrencyRef: { value: "USD", name: "United States Dollar" },
    ExchangeRate: 1,
    IncludeInAnnualTPAR: false,
    LinkedTxn: [{ TxnId: "900", TxnType: "BillPaymentCheck", TxnLineId: "1" }],
    TotalAmt: 150,
    Line: [
      {
        Id: "1",
        Amount: 150,
        DetailType: "AccountBasedExpenseLineDetail",
        Description: "Supplies",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "5", name: "Office Supplies" },
          CustomerRef: { value: "299", name: "Original Customer:Original Job" },
          BillableStatus: "NotBillable",
          TaxCodeRef: { value: "NON" },
        },
      },
    ],
  };

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockGetAccountCache.mockResolvedValue(createMockAccountCache() as never);
    mockGetDepartmentCache.mockResolvedValue(createMockDepartmentCache() as never);
    mockGetVendorCache.mockResolvedValue(createMockVendorCache() as never);
    mockResolveCustomer.mockResolvedValue({ value: "300", name: "Customer One:Job One" });
    mockResolveCustomerById.mockResolvedValue({ value: "301", name: "Customer By ID" });
    mockSuccess(client.getBill, existingBill);
  });

  it("sparse update when no line changes", async () => {
    mockSuccess(client.updateBill, { Id: "500", SyncToken: "3" });

    await handleEditBill(client as never, {
      id: "500",
      memo: "Updated memo",
      draft: false,
    });

    const payload = client.updateBill.mock.calls[0][0];
    expect(payload.sparse).toBe(true);
    expect(payload.PrivateNote).toBe("Updated memo");
    expect(payload.VendorRef).toEqual({ value: "100", name: "Office Depot" });
  });

  it("full update when lines are modified", async () => {
    mockSuccess(client.updateBill, { Id: "500", SyncToken: "3" });

    await handleEditBill(client as never, {
      id: "500",
      draft: false,
      lines: [{ line_id: "1", amount: 200 }],
    });

    const payload = client.updateBill.mock.calls[0][0];
    expect(payload.sparse).toBe(false);
    expect(payload.Line).toBeDefined();
    expect(payload.Line[0].AccountBasedExpenseLineDetail).toMatchObject({
      CustomerRef: { value: "299", name: "Original Customer:Original Job" },
      BillableStatus: "NotBillable",
      TaxCodeRef: { value: "NON" },
    });
    expect(payload.APAccountRef).toEqual(existingBill.APAccountRef);
    expect(payload.SalesTermRef).toEqual(existingBill.SalesTermRef);
    expect(payload.CurrencyRef).toEqual(existingBill.CurrencyRef);
    expect(payload.ExchangeRate).toBe(1);
    expect(payload.IncludeInAnnualTPAR).toBe(false);
    expect(payload.LinkedTxn).toEqual(existingBill.LinkedTxn);
  });

  it("changes an existing line customer/job by name", async () => {
    mockSuccess(client.updateBill, { Id: "500", SyncToken: "3" });

    await handleEditBill(client as never, {
      id: "500",
      draft: false,
      lines: [{ line_id: "1", customer_name: "Customer One:Job One" }],
    });

    const detail = client.updateBill.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "300", name: "Customer One:Job One" });
    expect(detail.BillableStatus).toBe("NotBillable");
    expect(detail.TaxCodeRef).toEqual({ value: "NON" });
  });

  it("changes an existing line customer/job by ID", async () => {
    mockSuccess(client.updateBill, { Id: "500", SyncToken: "3" });

    await handleEditBill(client as never, {
      id: "500",
      draft: false,
      lines: [{ line_id: "1", customer_id: "301" }],
    });

    const detail = client.updateBill.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "301", name: "Customer By ID" });
  });

  it("clears a customer/job from a NotBillable line", async () => {
    mockSuccess(client.updateBill, { Id: "500", SyncToken: "3" });

    await handleEditBill(client as never, {
      id: "500",
      draft: false,
      lines: [{ line_id: "1", clear_customer: true }],
    });

    const detail = client.updateBill.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail).not.toHaveProperty("CustomerRef");
    expect(detail.BillableStatus).toBe("NotBillable");
  });

  it("adds a new NotBillable line with a customer/job", async () => {
    mockSuccess(client.updateBill, { Id: "500", SyncToken: "3" });

    await handleEditBill(client as never, {
      id: "500",
      draft: false,
      lines: [{ account_name: "Cash", amount: 10, customer_name: "Customer One:Job One" }],
    });

    const detail = client.updateBill.mock.calls[0][0].Line[1].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "300", name: "Customer One:Job One" });
    expect(detail.BillableStatus).toBe("NotBillable");
  });

  it("shows the changed customer/job in draft without updating", async () => {
    const result = await handleEditBill(client as never, {
      id: "500",
      lines: [{ line_id: "1", customer_name: "Customer One:Job One" }],
    });

    expect(result.content[0].text).toContain("Customer/Job: Customer One:Job One");
    expect(client.updateBill).not.toHaveBeenCalled();
  });

  it.each([
    ["HasBeenBilled", { customer_name: "Customer One:Job One" }, "after the line has been billed"],
    ["Billable", { clear_customer: true }, "while the line is Billable"],
  ] as const)("protects %s customer/job state", async (status, change, message) => {
    mockSuccess(client.getBill, {
      ...existingBill,
      Line: [{
        ...existingBill.Line[0],
        AccountBasedExpenseLineDetail: {
          ...existingBill.Line[0].AccountBasedExpenseLineDetail,
          BillableStatus: status,
        },
      }],
    });

    await expect(handleEditBill(client as never, {
      id: "500",
      draft: false,
      lines: [{ line_id: "1", ...change }],
    })).rejects.toThrow(message);
    expect(client.updateBill).not.toHaveBeenCalled();
  });

  it("rejects customer mutation on an item-based line", async () => {
    mockSuccess(client.getBill, {
      ...existingBill,
      Line: [{
        Id: "2",
        Amount: 50,
        DetailType: "ItemBasedExpenseLineDetail",
        ItemBasedExpenseLineDetail: { ItemRef: { value: "10", name: "Widget" } },
      }],
    });

    await expect(handleEditBill(client as never, {
      id: "500",
      draft: false,
      lines: [{ line_id: "2", customer_name: "Customer One:Job One" }],
    })).rejects.toThrow("account-based lines");
    expect(client.updateBill).not.toHaveBeenCalled();
  });

  it("propagates API errors", async () => {
    mockError(client.updateBill, "Stale Object");
    await expect(
      handleEditBill(client as never, { id: "500", memo: "x", draft: false })
    ).rejects.toThrow("Stale Object");
  });

  it("deletes a line when delete=true", async () => {
    const twoLineBill = {
      ...existingBill,
      Line: [
        { Id: "1", Amount: 100, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "5", name: "Office Supplies" } } },
        { Id: "2", Amount: 50, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "1", name: "Cash" } } },
      ],
    };
    mockSuccess(client.getBill, twoLineBill);
    mockSuccess(client.updateBill, { Id: "500", SyncToken: "3" });

    await handleEditBill(client as never, {
      id: "500",
      lines: [{ line_id: "1", delete: true }],
      draft: false,
    });

    const payload = client.updateBill.mock.calls[0][0];
    expect(payload.Line).toHaveLength(1);
    expect(payload.Line[0].Id).toBe("2");
  });

  it("rejects delete combined with customer assignment", async () => {
    await expect(handleEditBill(client as never, {
      id: "500",
      lines: [{ line_id: "1", delete: true, customer_name: "Customer One:Job One" }],
      draft: false,
    })).rejects.toThrow("delete cannot be combined with customer/job");
    expect(client.updateBill).not.toHaveBeenCalled();
  });

  it("throws when line_id not found", async () => {
    await expect(
      handleEditBill(client as never, {
        id: "500",
        lines: [{ line_id: "nonexistent", amount: 100 }],
        draft: false,
      })
    ).rejects.toThrow('Line ID nonexistent not found in bill');
  });
});
