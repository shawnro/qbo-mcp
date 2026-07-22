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
import { getAccountCache, getDepartmentCache, getVendorCache } from "../../../client/index.js";

const mockGetAccountCache = vi.mocked(getAccountCache);
const mockGetDepartmentCache = vi.mocked(getDepartmentCache);
const mockGetVendorCache = vi.mocked(getVendorCache);

describe("handleCreateBill", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockGetAccountCache.mockResolvedValue(createMockAccountCache() as never);
    mockGetDepartmentCache.mockResolvedValue(createMockDepartmentCache() as never);
    mockGetVendorCache.mockResolvedValue(createMockVendorCache() as never);
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
  });

  it("throws when vendor not found", async () => {
    await expect(
      handleCreateBill(client as never, {
        vendor_name: "Nonexistent Vendor",
        txn_date: "2026-01-01",
        lines: [{ account_name: "Cash", amount: 10 }],
      })
    ).rejects.toThrow('Vendor not found: "Nonexistent Vendor"');
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
    TotalAmt: 150,
    Line: [
      {
        Id: "1",
        Amount: 150,
        DetailType: "AccountBasedExpenseLineDetail",
        Description: "Supplies",
        AccountBasedExpenseLineDetail: { AccountRef: { value: "5", name: "Office Supplies" } },
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
