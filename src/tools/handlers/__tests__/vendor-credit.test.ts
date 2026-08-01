// Tests for vendor credit handlers (create, get, edit)

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
    getQboUrl: vi.fn((_entity: string, id: string) => `https://app.qbo.intuit.com/app/vendorcredit?txnId=${id}`),
  };
});

import {
  handleCreateVendorCredit,
  handleGetVendorCredit,
  handleEditVendorCredit,
} from "../vendor-credit.js";
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

describe("handleCreateVendorCredit", () => {
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
    const result = await handleCreateVendorCredit(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2024-06-15",
      lines: [{ account_name: "Office Supplies", amount: 100 }],
      draft: true,
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("Office Depot");
    expect(client.createVendorCredit).not.toHaveBeenCalled();
  });

  it("creates vendor credit with draft=false", async () => {
    mockSuccess(client.createVendorCredit, { Id: "500", DocNumber: "VC-001" });

    await handleCreateVendorCredit(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2024-06-15",
      lines: [{ account_name: "Office Supplies", amount: 75.50 }],
      draft: false,
    });

    expect(client.createVendorCredit).toHaveBeenCalledOnce();
    expect(client.createVendorCredit.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail)
      .not.toHaveProperty("CustomerRef");
  });

  it("assigns a line customer/job by name without making it billable", async () => {
    mockSuccess(client.createVendorCredit, { Id: "501" });

    await handleCreateVendorCredit(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2024-06-15",
      lines: [{
        account_name: "Office Supplies",
        customer_name: "Customer One:Job One",
        amount: 75.50,
      }],
      draft: false,
    });

    const detail = client.createVendorCredit.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "300", name: "Customer One:Job One" });
    expect(detail.BillableStatus).toBe("NotBillable");
  });

  it("assigns a line customer/job by ID", async () => {
    mockSuccess(client.createVendorCredit, { Id: "502" });

    await handleCreateVendorCredit(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2024-06-15",
      lines: [{ account_name: "Cash", customer_id: "301", amount: 25 }],
      draft: false,
    });

    const detail = client.createVendorCredit.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "301", name: "Customer By ID" });
    expect(mockResolveCustomerById).toHaveBeenCalledWith(client, "301");
  });

  it("shows a line customer/job in the default draft preview", async () => {
    const result = await handleCreateVendorCredit(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2024-06-15",
      lines: [{ account_name: "Cash", customer_name: "Customer One:Job One", amount: 25 }],
    });

    expect(result.content[0].text).toContain("Customer/Job: Customer One:Job One");
    expect(client.createVendorCredit).not.toHaveBeenCalled();
  });

  it("rejects customer_name and customer_id on the same line", async () => {
    await expect(handleCreateVendorCredit(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2024-06-15",
      lines: [{
        account_name: "Cash",
        customer_name: "Customer One:Job One",
        customer_id: "301",
        amount: 25,
      }],
    })).rejects.toThrow("only one");
    expect(client.createVendorCredit).not.toHaveBeenCalled();
  });

  it("builds correct payload with VendorRef", async () => {
    mockSuccess(client.createVendorCredit, { Id: "500" });

    await handleCreateVendorCredit(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2024-06-15",
      lines: [{ account_name: "Rent Expense", amount: 200 }],
      draft: false,
    });

    const payload = client.createVendorCredit.mock.calls[0][0];
    expect(payload.VendorRef).toEqual({ value: "100", name: "Office Depot" });
    expect(payload.TxnDate).toBe("2024-06-15");
  });

  it("uses AccountBasedExpenseLineDetail", async () => {
    mockSuccess(client.createVendorCredit, { Id: "500" });

    await handleCreateVendorCredit(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2024-06-15",
      lines: [{ account_name: "Rent Expense", amount: 150, description: "Rent refund" }],
      draft: false,
    });

    const payload = client.createVendorCredit.mock.calls[0][0];
    expect(payload.Line[0].DetailType).toBe("AccountBasedExpenseLineDetail");
    expect(payload.Line[0].Amount).toBe(150);
    expect(payload.Line[0].Description).toBe("Rent refund");
    expect(payload.Line[0].AccountBasedExpenseLineDetail.AccountRef.value).toBe("3");
  });

  it("resolves department at header level", async () => {
    mockSuccess(client.createVendorCredit, { Id: "500" });

    await handleCreateVendorCredit(client as never, {
      vendor_name: "Office Depot",
      txn_date: "2024-06-15",
      department_name: "Santa Rosa",
      lines: [{ account_name: "Office Supplies", amount: 50 }],
      draft: false,
    });

    const payload = client.createVendorCredit.mock.calls[0][0];
    expect(payload.DepartmentRef.value).toBe("20");
    expect(payload.DepartmentRef.name).toBe("Santa Rosa");
  });

  it("resolves vendor by ID", async () => {
    mockSuccess(client.createVendorCredit, { Id: "500" });

    await handleCreateVendorCredit(client as never, {
      vendor_id: "101",
      txn_date: "2024-06-15",
      lines: [{ account_name: "Office Supplies", amount: 25 }],
      draft: false,
    });

    const payload = client.createVendorCredit.mock.calls[0][0];
    expect(payload.VendorRef).toEqual({ value: "101", name: "Shell Gas Station" });
  });

  it("throws when vendor not found", async () => {
    await expect(
      handleCreateVendorCredit(client as never, {
        vendor_name: "Nobody Inc",
        txn_date: "2024-06-15",
        lines: [{ account_name: "Office Supplies", amount: 25 }],
      })
    ).rejects.toThrow('Vendor not found: "Nobody Inc"');
  });

  it("throws when neither vendor_name nor vendor_id", async () => {
    await expect(
      handleCreateVendorCredit(client as never, {
        txn_date: "2024-06-15",
        lines: [{ account_name: "Office Supplies", amount: 25 }],
      } as never)
    ).rejects.toThrow("Either vendor_name or vendor_id is required");
  });

  it("throws when line missing account", async () => {
    await expect(
      handleCreateVendorCredit(client as never, {
        vendor_name: "Office Depot",
        txn_date: "2024-06-15",
        lines: [{ amount: 50 } as never],
      })
    ).rejects.toThrow("account_id or account_name");
  });

  it("validates amount precision", async () => {
    await expect(
      handleCreateVendorCredit(client as never, {
        vendor_name: "Office Depot",
        txn_date: "2024-06-15",
        lines: [{ account_name: "Cash", amount: 10.001 }],
      })
    ).rejects.toThrow();
  });

  it("propagates API errors", async () => {
    mockError(client.createVendorCredit, "Business validation error");

    await expect(
      handleCreateVendorCredit(client as never, {
        vendor_name: "Office Depot",
        txn_date: "2024-06-15",
        lines: [{ account_name: "Cash", amount: 50 }],
        draft: false,
      })
    ).rejects.toThrow("Business validation error");
  });
});

describe("handleGetVendorCredit", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns formatted vendor credit with SyncToken", async () => {
    mockSuccess(client.getVendorCredit, {
      Id: "500",
      SyncToken: "3",
      TxnDate: "2024-06-15",
      VendorRef: { value: "100", name: "Office Depot" },
      TotalAmt: 200,
      Line: [],
    });

    const result = await handleGetVendorCredit(client as never, { id: "500" });
    expect(result.content[0].text).toContain("Office Depot");
    expect(client.getVendorCredit).toHaveBeenCalledOnce();
  });

  it("shows line customer/job and billable status", async () => {
    mockSuccess(client.getVendorCredit, {
      Id: "500",
      SyncToken: "3",
      TxnDate: "2024-06-15",
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

    const result = await handleGetVendorCredit(client as never, { id: "500" });
    expect(result.content[0].text).toContain("Customer/Job: Customer One:Job One");
    expect(result.content[0].text).toContain("NotBillable");
  });

  it("propagates API errors", async () => {
    mockError(client.getVendorCredit, "Object Not Found");
    await expect(
      handleGetVendorCredit(client as never, { id: "999" })
    ).rejects.toThrow("Object Not Found");
  });
});

describe("handleEditVendorCredit", () => {
  let client: ReturnType<typeof createMockClient>;

  const existingVC = {
    Id: "500",
    SyncToken: "3",
    VendorRef: { value: "100", name: "Office Depot" },
    APAccountRef: { value: "4", name: "Accounts Payable" },
    CurrencyRef: { value: "USD", name: "United States Dollar" },
    ExchangeRate: 1,
    IncludeInAnnualTPAR: false,
    LinkedTxn: [{ TxnId: "902", TxnType: "ReimburseCharge", TxnLineId: "1" }],
    TxnDate: "2024-06-15",
    TotalAmt: 200,
    Line: [
      {
        Id: "1",
        Amount: 200,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "3", name: "Rent Expense" },
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
    mockSuccess(client.getVendorCredit, existingVC);
  });

  it("sparse update for header-only changes", async () => {
    mockSuccess(client.updateVendorCredit, { Id: "500", SyncToken: "4" });

    await handleEditVendorCredit(client as never, {
      id: "500",
      memo: "Updated memo",
      draft: false,
    });

    expect(client.updateVendorCredit).toHaveBeenCalledOnce();
    const payload = client.updateVendorCredit.mock.calls[0][0];
    expect(payload.sparse).toBe(true);
    expect(payload.PrivateNote).toBe("Updated memo");
    expect(payload.VendorRef).toEqual({ value: "100", name: "Office Depot" });
  });

  it("full update when lines are modified", async () => {
    mockSuccess(client.updateVendorCredit, { Id: "500", SyncToken: "4" });

    await handleEditVendorCredit(client as never, {
      id: "500",
      lines: [{ line_id: "1", amount: 300 }],
      draft: false,
    });

    expect(client.getVendorCredit).toHaveBeenCalledOnce();
    expect(client.updateVendorCredit).toHaveBeenCalledOnce();
    const payload = client.updateVendorCredit.mock.calls[0][0];
    expect(payload.sparse).toBe(false);
    expect(payload.Line[0].AccountBasedExpenseLineDetail).toMatchObject({
      CustomerRef: { value: "299", name: "Original Customer:Original Job" },
      BillableStatus: "NotBillable",
      TaxCodeRef: { value: "NON" },
    });
    expect(payload.APAccountRef).toEqual(existingVC.APAccountRef);
    expect(payload.CurrencyRef).toEqual(existingVC.CurrencyRef);
    expect(payload.ExchangeRate).toBe(1);
    expect(payload.IncludeInAnnualTPAR).toBe(false);
    expect(payload.LinkedTxn).toEqual(existingVC.LinkedTxn);
  });

  it("changes an existing line customer/job", async () => {
    mockSuccess(client.updateVendorCredit, { Id: "500", SyncToken: "4" });

    await handleEditVendorCredit(client as never, {
      id: "500",
      lines: [{ line_id: "1", customer_name: "Customer One:Job One" }],
      draft: false,
    });

    const detail = client.updateVendorCredit.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "300", name: "Customer One:Job One" });
    expect(detail.BillableStatus).toBe("NotBillable");
    expect(detail.TaxCodeRef).toEqual({ value: "NON" });
  });

  it("clears a customer/job from a NotBillable line", async () => {
    mockSuccess(client.updateVendorCredit, { Id: "500", SyncToken: "4" });

    await handleEditVendorCredit(client as never, {
      id: "500",
      lines: [{ line_id: "1", clear_customer: true }],
      draft: false,
    });

    const detail = client.updateVendorCredit.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail).not.toHaveProperty("CustomerRef");
    expect(detail.BillableStatus).toBe("NotBillable");
  });

  it("adds a new NotBillable line with a customer/job by ID", async () => {
    mockSuccess(client.updateVendorCredit, { Id: "500", SyncToken: "4" });

    await handleEditVendorCredit(client as never, {
      id: "500",
      lines: [{ account_name: "Cash", amount: 25, customer_id: "301" }],
      draft: false,
    });

    const detail = client.updateVendorCredit.mock.calls[0][0].Line[1].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "301", name: "Customer By ID" });
    expect(detail.BillableStatus).toBe("NotBillable");
  });

  it("shows the changed customer/job in draft without updating", async () => {
    const result = await handleEditVendorCredit(client as never, {
      id: "500",
      lines: [{ line_id: "1", customer_name: "Customer One:Job One" }],
    });

    expect(result.content[0].text).toContain("Customer/Job: Customer One:Job One");
    expect(client.updateVendorCredit).not.toHaveBeenCalled();
  });

  it("rejects conflicting customer edit inputs", async () => {
    await expect(handleEditVendorCredit(client as never, {
      id: "500",
      lines: [{
        line_id: "1",
        customer_name: "Customer One:Job One",
        clear_customer: true,
      }],
      draft: false,
    })).rejects.toThrow("cannot be combined");
    expect(client.updateVendorCredit).not.toHaveBeenCalled();
  });

  it("rejects clearing a customer on a new line", async () => {
    await expect(handleEditVendorCredit(client as never, {
      id: "500",
      lines: [{ account_name: "Cash", amount: 25, clear_customer: true }],
      draft: false,
    })).rejects.toThrow("New lines cannot clear");
    expect(client.updateVendorCredit).not.toHaveBeenCalled();
  });

  it("deletes a line when delete=true", async () => {
    const twoLineVC = {
      ...existingVC,
      Line: [
        { Id: "1", Amount: 150, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "3", name: "Rent Expense" } } },
        { Id: "2", Amount: 50, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "5", name: "Office Supplies" } } },
      ],
    };
    mockSuccess(client.getVendorCredit, twoLineVC);
    mockSuccess(client.updateVendorCredit, { Id: "500", SyncToken: "4" });

    await handleEditVendorCredit(client as never, {
      id: "500",
      lines: [{ line_id: "1", delete: true }],
      draft: false,
    });

    const payload = client.updateVendorCredit.mock.calls[0][0];
    expect(payload.Line).toHaveLength(1);
    expect(payload.Line[0].Id).toBe("2");
  });

  it("rejects delete combined with customer clearing", async () => {
    await expect(handleEditVendorCredit(client as never, {
      id: "500",
      lines: [{ line_id: "1", delete: true, clear_customer: true }],
      draft: false,
    })).rejects.toThrow("delete cannot be combined with customer/job");
    expect(client.updateVendorCredit).not.toHaveBeenCalled();
  });

  it("throws when line_id not found", async () => {
    await expect(
      handleEditVendorCredit(client as never, {
        id: "500",
        lines: [{ line_id: "nonexistent", amount: 100 }],
        draft: false,
      })
    ).rejects.toThrow('Line ID nonexistent not found in vendor credit');
  });
});
