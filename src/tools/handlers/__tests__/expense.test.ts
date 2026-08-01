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
    getQboUrl: vi.fn((_entity: string, id: string) => `https://app.qbo.intuit.com/app/expense?txnId=${id}`),
  };
});

import { handleCreateExpense, handleGetExpense, handleEditExpense } from "../expense.js";
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

describe("handleCreateExpense", () => {
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
    const result = await handleCreateExpense(client as never, {
      payment_type: "CreditCard",
      payment_account: "Cash",
      txn_date: "2026-02-15",
      lines: [{ account_name: "Office Supplies", amount: 45.99 }],
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("CreditCard");
    expect(result.content[0].text).toContain("$45.99");
    expect(client.createPurchase).not.toHaveBeenCalled();
  });

  it("creates expense with minimal fields", async () => {
    mockSuccess(client.createPurchase, { Id: "600" });

    const result = await handleCreateExpense(client as never, {
      payment_type: "Cash",
      payment_account: "Cash",
      txn_date: "2026-02-15",
      draft: false,
      lines: [{ account_name: "Office Supplies", amount: 30 }],
    });

    expect(result.content[0].text).toContain("Expense Created");
    expect(client.createPurchase).toHaveBeenCalledOnce();
    expect(client.createPurchase.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail)
      .not.toHaveProperty("CustomerRef");
  });

  it("assigns a line customer/job by name without changing billable behavior", async () => {
    mockSuccess(client.createPurchase, { Id: "605" });

    await handleCreateExpense(client as never, {
      payment_type: "Cash",
      payment_account: "Cash",
      txn_date: "2026-02-15",
      draft: false,
      lines: [{
        account_name: "Office Supplies",
        customer_name: "Customer One:Job One",
        amount: 30,
      }],
    });

    const detail = client.createPurchase.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "300", name: "Customer One:Job One" });
    expect(detail).not.toHaveProperty("BillableStatus");
  });

  it("assigns a line customer/job by ID", async () => {
    mockSuccess(client.createPurchase, { Id: "606" });

    await handleCreateExpense(client as never, {
      payment_type: "Cash",
      payment_account: "Cash",
      txn_date: "2026-02-15",
      draft: false,
      lines: [{ account_name: "Cash", customer_id: "301", amount: 10 }],
    });

    const detail = client.createPurchase.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "301", name: "Customer By ID" });
    expect(mockResolveCustomerById).toHaveBeenCalledWith(client, "301");
  });

  it("shows a line customer/job in the default draft preview", async () => {
    const result = await handleCreateExpense(client as never, {
      payment_type: "Cash",
      payment_account: "Cash",
      txn_date: "2026-02-15",
      lines: [{ account_name: "Cash", customer_name: "Customer One:Job One", amount: 10 }],
    });

    expect(result.content[0].text).toContain("Customer/Job: Customer One:Job One");
    expect(client.createPurchase).not.toHaveBeenCalled();
  });

  it("rejects customer_name and customer_id on the same line", async () => {
    await expect(handleCreateExpense(client as never, {
      payment_type: "Cash",
      payment_account: "Cash",
      txn_date: "2026-02-15",
      lines: [{
        account_name: "Cash",
        customer_name: "Customer One:Job One",
        customer_id: "301",
        amount: 10,
      }],
    })).rejects.toThrow("only one");
    expect(client.createPurchase).not.toHaveBeenCalled();
  });

  it("creates with all optional fields", async () => {
    mockSuccess(client.createPurchase, { Id: "601" });

    await handleCreateExpense(client as never, {
      payment_type: "Check",
      payment_account: "Cash",
      txn_date: "2026-03-01",
      entity_name: "Shell Gas Station",
      department_name: "Santa Rosa",
      memo: "Gas for trucks",
      doc_number: "CHK-100",
      draft: false,
      lines: [{ account_name: "Rent Expense", amount: 80, description: "Fuel" }],
    });

    const payload = client.createPurchase.mock.calls[0][0];
    expect(payload.PaymentType).toBe("Check");
    expect(payload.EntityRef).toEqual({ value: "101", name: "Shell Gas Station", type: "Vendor" });
    expect(payload.DepartmentRef).toBeDefined();
    expect(payload.PrivateNote).toBe("Gas for trucks");
    expect(payload.DocNumber).toBe("CHK-100");
  });

  it("includes PaymentType in payload", async () => {
    mockSuccess(client.createPurchase, { Id: "602" });

    await handleCreateExpense(client as never, {
      payment_type: "CreditCard",
      payment_account: "Cash",
      txn_date: "2026-01-01",
      draft: false,
      lines: [{ account_name: "Cash", amount: 10 }],
    });

    const payload = client.createPurchase.mock.calls[0][0];
    expect(payload.PaymentType).toBe("CreditCard");
  });

  it("omits EntityRef when no entity provided", async () => {
    mockSuccess(client.createPurchase, { Id: "603" });

    await handleCreateExpense(client as never, {
      payment_type: "Cash",
      payment_account: "Cash",
      txn_date: "2026-01-01",
      draft: false,
      lines: [{ account_name: "Office Supplies", amount: 25 }],
    });

    const payload = client.createPurchase.mock.calls[0][0];
    expect(payload.EntityRef).toBeUndefined();
  });

  it("resolves payment account to AccountRef", async () => {
    mockSuccess(client.createPurchase, { Id: "604" });

    await handleCreateExpense(client as never, {
      payment_type: "Cash",
      payment_account: "Cash",
      txn_date: "2026-01-01",
      draft: false,
      lines: [{ account_name: "Office Supplies", amount: 15 }],
    });

    const payload = client.createPurchase.mock.calls[0][0];
    expect(payload.AccountRef).toEqual({ value: "1", name: "Cash" });
  });

  it("throws when entity not found", async () => {
    await expect(
      handleCreateExpense(client as never, {
        payment_type: "Cash",
        payment_account: "Cash",
        txn_date: "2026-01-01",
        entity_name: "Unknown Vendor",
        lines: [{ account_name: "Cash", amount: 10 }],
      })
    ).rejects.toThrow("not found");
  });

  it("throws when payment account not found", async () => {
    await expect(
      handleCreateExpense(client as never, {
        payment_type: "Cash",
        payment_account: "Nonexistent Bank",
        txn_date: "2026-01-01",
        lines: [{ account_name: "Cash", amount: 10 }],
      })
    ).rejects.toThrow('Account not found: "Nonexistent Bank"');
  });

  it("propagates API errors", async () => {
    mockError(client.createPurchase, "Server Error");

    await expect(
      handleCreateExpense(client as never, {
        payment_type: "Cash",
        payment_account: "Cash",
        txn_date: "2026-01-01",
        draft: false,
        lines: [{ account_name: "Cash", amount: 10 }],
      })
    ).rejects.toThrow("Server Error");
  });

  it("creates expense with multiple lines and correct total", async () => {
    mockSuccess(client.createPurchase, { Id: "700" });

    const result = await handleCreateExpense(client as never, {
      payment_type: "Cash",
      payment_account: "Cash",
      txn_date: "2026-02-10",
      draft: false,
      lines: [
        { account_name: "Office Supplies", amount: 45.00, description: "Pens" },
        { account_name: "Rent Expense", amount: 150.75, description: "Cleaning" },
      ],
    });

    const payload = client.createPurchase.mock.calls[0][0];
    expect(payload.Line).toHaveLength(2);
    expect(payload.Line[0].Amount).toBe(45.00);
    expect(payload.Line[1].Amount).toBe(150.75);
    expect(result.content[0].text).toContain("$195.75");
  });
});

describe("handleGetExpense", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns formatted expense with PaymentType visible", async () => {
    mockSuccess(client.getPurchase, {
      Id: "600",
      SyncToken: "1",
      PaymentType: "CreditCard",
      TxnDate: "2026-02-15",
      TotalAmt: 45.99,
      AccountRef: { value: "1", name: "Cash" },
      Line: [],
    });

    const result = await handleGetExpense(client as never, { id: "600" });
    expect(result.content[0].text).toContain("SyncToken: 1");
    expect(result.content[0].text).toContain("CreditCard");
  });

  it("shows line customer/job and billable status", async () => {
    mockSuccess(client.getPurchase, {
      Id: "600",
      SyncToken: "1",
      PaymentType: "CreditCard",
      TxnDate: "2026-02-15",
      TotalAmt: 45.99,
      AccountRef: { value: "1", name: "Cash" },
      Line: [{
        Id: "1",
        Amount: 45.99,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "5", name: "Office Supplies" },
          CustomerRef: { value: "300", name: "Customer One:Job One" },
          BillableStatus: "NotBillable",
        },
      }],
    });

    const result = await handleGetExpense(client as never, { id: "600" });
    expect(result.content[0].text).toContain("Customer/Job: Customer One:Job One");
    expect(result.content[0].text).toContain("NotBillable");
  });

  it("propagates API errors", async () => {
    mockError(client.getPurchase, "Not Found");
    await expect(handleGetExpense(client as never, { id: "999" })).rejects.toThrow("Not Found");
  });
});

describe("handleEditExpense", () => {
  let client: ReturnType<typeof createMockClient>;

  const existingExpense = {
    Id: "600",
    SyncToken: "1",
    PaymentType: "CreditCard",
    TxnDate: "2026-02-15",
    DocNumber: "EXP-001",
    PrivateNote: "Original",
    AccountRef: { value: "1", name: "Cash" },
    EntityRef: { value: "100", name: "Office Depot", type: "Vendor" },
    DepartmentRef: { value: "10", name: "Main Office" },
    CurrencyRef: { value: "USD", name: "United States Dollar" },
    ExchangeRate: 1,
    PaymentMethodRef: { value: "5", name: "Visa" },
    Credit: false,
    IncludeInAnnualTPAR: false,
    LinkedTxn: [{ TxnId: "901", TxnType: "ReimburseCharge", TxnLineId: "1" }],
    TotalAmt: 45.99,
    Line: [
      {
        Id: "1",
        Amount: 45.99,
        DetailType: "AccountBasedExpenseLineDetail",
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
    mockSuccess(client.getPurchase, existingExpense);
  });

  it("sparse update includes PaymentType from existing (immutable)", async () => {
    mockSuccess(client.updatePurchase, { Id: "600", SyncToken: "2" });

    await handleEditExpense(client as never, {
      id: "600",
      memo: "Updated",
      draft: false,
    });

    const payload = client.updatePurchase.mock.calls[0][0];
    expect(payload.sparse).toBe(true);
    expect(payload.PaymentType).toBe("CreditCard");
  });

  it("full update with line changes", async () => {
    mockSuccess(client.updatePurchase, { Id: "600", SyncToken: "2" });

    await handleEditExpense(client as never, {
      id: "600",
      draft: false,
      lines: [{ line_id: "1", amount: 60 }],
    });

    const payload = client.updatePurchase.mock.calls[0][0];
    expect(payload.sparse).toBe(false);
    expect(payload.PaymentType).toBe("CreditCard");
    expect(payload.AccountRef).toEqual(existingExpense.AccountRef);
    expect(payload.EntityRef).toEqual(existingExpense.EntityRef);
    expect(payload.DepartmentRef).toEqual(existingExpense.DepartmentRef);
    expect(payload.CurrencyRef).toEqual(existingExpense.CurrencyRef);
    expect(payload.ExchangeRate).toBe(1);
    expect(payload.PaymentMethodRef).toEqual(existingExpense.PaymentMethodRef);
    expect(payload.Credit).toBe(false);
    expect(payload.IncludeInAnnualTPAR).toBe(false);
    expect(payload.LinkedTxn).toEqual(existingExpense.LinkedTxn);
    expect(payload.Line[0].AccountBasedExpenseLineDetail).toMatchObject({
      CustomerRef: { value: "299", name: "Original Customer:Original Job" },
      BillableStatus: "NotBillable",
      TaxCodeRef: { value: "NON" },
    });
  });

  it("changes an existing line customer/job by name", async () => {
    mockSuccess(client.updatePurchase, { Id: "600", SyncToken: "2" });

    await handleEditExpense(client as never, {
      id: "600",
      lines: [{ line_id: "1", customer_name: "Customer One:Job One" }],
      draft: false,
    });

    const payload = client.updatePurchase.mock.calls[0][0];
    const detail = payload.Line[0].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "300", name: "Customer One:Job One" });
    expect(detail.BillableStatus).toBe("NotBillable");
    expect(detail.TaxCodeRef).toEqual({ value: "NON" });
    expect(payload.EntityRef).toEqual(existingExpense.EntityRef);
    expect(payload.DepartmentRef).toEqual(existingExpense.DepartmentRef);
  });

  it("changes an existing line customer/job by ID", async () => {
    mockSuccess(client.updatePurchase, { Id: "600", SyncToken: "2" });

    await handleEditExpense(client as never, {
      id: "600",
      lines: [{ line_id: "1", customer_id: "301" }],
      draft: false,
    });

    const detail = client.updatePurchase.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "301", name: "Customer By ID" });
  });

  it("clears a customer/job from a NotBillable line", async () => {
    mockSuccess(client.updatePurchase, { Id: "600", SyncToken: "2" });

    await handleEditExpense(client as never, {
      id: "600",
      lines: [{ line_id: "1", clear_customer: true }],
      draft: false,
    });

    const detail = client.updatePurchase.mock.calls[0][0].Line[0].AccountBasedExpenseLineDetail;
    expect(detail).not.toHaveProperty("CustomerRef");
    expect(detail.BillableStatus).toBe("NotBillable");
  });

  it("adds a new NotBillable line with a customer/job", async () => {
    mockSuccess(client.updatePurchase, { Id: "600", SyncToken: "2" });

    await handleEditExpense(client as never, {
      id: "600",
      lines: [{ account_name: "Cash", amount: 10, customer_name: "Customer One:Job One" }],
      draft: false,
    });

    const detail = client.updatePurchase.mock.calls[0][0].Line[1].AccountBasedExpenseLineDetail;
    expect(detail.CustomerRef).toEqual({ value: "300", name: "Customer One:Job One" });
    expect(detail.BillableStatus).toBe("NotBillable");
  });

  it("shows the changed customer/job in draft without updating", async () => {
    const result = await handleEditExpense(client as never, {
      id: "600",
      lines: [{ line_id: "1", customer_name: "Customer One:Job One" }],
    });

    expect(result.content[0].text).toContain("Customer/Job: Customer One:Job One");
    expect(client.updatePurchase).not.toHaveBeenCalled();
  });

  it.each([
    ["HasBeenBilled", { customer_name: "Customer One:Job One" }, "after the line has been billed"],
    ["Billable", { clear_customer: true }, "while the line is Billable"],
  ] as const)("protects %s customer/job state", async (status, change, message) => {
    mockSuccess(client.getPurchase, {
      ...existingExpense,
      Line: [{
        ...existingExpense.Line[0],
        AccountBasedExpenseLineDetail: {
          ...existingExpense.Line[0].AccountBasedExpenseLineDetail,
          BillableStatus: status,
        },
      }],
    });

    await expect(handleEditExpense(client as never, {
      id: "600",
      lines: [{ line_id: "1", ...change }],
      draft: false,
    })).rejects.toThrow(message);
    expect(client.updatePurchase).not.toHaveBeenCalled();
  });

  it("rejects customer mutation on an item-based line", async () => {
    mockSuccess(client.getPurchase, {
      ...existingExpense,
      Line: [{
        Id: "2",
        Amount: 50,
        DetailType: "ItemBasedExpenseLineDetail",
        ItemBasedExpenseLineDetail: { ItemRef: { value: "10", name: "Widget" } },
      }],
    });

    await expect(handleEditExpense(client as never, {
      id: "600",
      lines: [{ line_id: "2", customer_name: "Customer One:Job One" }],
      draft: false,
    })).rejects.toThrow("account-based lines");
    expect(client.updatePurchase).not.toHaveBeenCalled();
  });

  it("propagates API errors", async () => {
    mockError(client.updatePurchase, "Concurrency Error");
    await expect(
      handleEditExpense(client as never, { id: "600", memo: "x", draft: false })
    ).rejects.toThrow("Concurrency Error");
  });

  it("deletes a line when delete=true", async () => {
    const twoLineExpense = {
      ...existingExpense,
      Line: [
        { Id: "1", Amount: 30, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "5", name: "Office Supplies" } } },
        { Id: "2", Amount: 15.99, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "1", name: "Cash" } } },
      ],
    };
    mockSuccess(client.getPurchase, twoLineExpense);
    mockSuccess(client.updatePurchase, { Id: "600", SyncToken: "2" });

    await handleEditExpense(client as never, {
      id: "600",
      lines: [{ line_id: "1", delete: true }],
      draft: false,
    });

    const payload = client.updatePurchase.mock.calls[0][0];
    expect(payload.Line).toHaveLength(1);
    expect(payload.Line[0].Id).toBe("2");
  });

  it("throws when line_id not found", async () => {
    await expect(
      handleEditExpense(client as never, {
        id: "600",
        lines: [{ line_id: "nonexistent", amount: 100 }],
        draft: false,
      })
    ).rejects.toThrow('Line ID nonexistent not found in expense');
  });
});
