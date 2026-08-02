// Tests for sales receipt handlers (create, get, edit)

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
} from "../../../__mocks__/mock-cache.js";

vi.mock("../../../client/index.js", () => ({
    promisify: mockPromisify,
    getAccountCache: vi.fn(),
    getDepartmentCache: vi.fn(),
    getVendorCache: vi.fn(),
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
    getQboUrl: vi.fn((_entity: string, id: string) => `https://app.qbo.intuit.com/app/salesreceipt?txnId=${id}`),
  };
});

import {
  handleCreateSalesReceipt,
  handleGetSalesReceipt,
  handleEditSalesReceipt,
} from "../sales-receipt.js";
import {
  getAccountCache,
  getDepartmentCache,
  resolveItem,
  resolveCustomer,
  resolveCustomerById,
} from "../../../client/index.js";

const mockGetAccountCache = vi.mocked(getAccountCache);
const mockGetDepartmentCache = vi.mocked(getDepartmentCache);
const mockResolveItem = vi.mocked(resolveItem);
const mockResolveCustomer = vi.mocked(resolveCustomer);
const mockResolveCustomerById = vi.mocked(resolveCustomerById);

describe("handleCreateSalesReceipt", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockGetAccountCache.mockResolvedValue(createMockAccountCache() as never);
    mockGetDepartmentCache.mockResolvedValue(createMockDepartmentCache() as never);
    mockResolveItem.mockResolvedValue({ value: "200", name: "Widget" });
    mockResolveCustomer.mockResolvedValue({ value: "300", name: "John Doe" });
    mockResolveCustomerById.mockResolvedValue({ value: "301", name: "Customer By ID" });
  });

  it("returns preview in draft mode", async () => {
    const result = await handleCreateSalesReceipt(client as never, {
      txn_date: "2024-06-15",
      customer_name: "John Doe",
      lines: [{ item_name: "Widget", amount: 100 }],
      draft: true,
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("John Doe");
    expect(client.createSalesReceipt).not.toHaveBeenCalled();
  });

  it("creates sales receipt with draft=false", async () => {
    mockSuccess(client.createSalesReceipt, { Id: "600", DocNumber: "SR-001" });

    await handleCreateSalesReceipt(client as never, {
      txn_date: "2024-06-15",
      lines: [{ item_name: "Widget", amount: 50 }],
      draft: false,
    });

    expect(client.createSalesReceipt).toHaveBeenCalledOnce();
  });

  it("builds SalesItemLineDetail payload", async () => {
    mockSuccess(client.createSalesReceipt, { Id: "600" });

    await handleCreateSalesReceipt(client as never, {
      txn_date: "2024-06-15",
      lines: [{ item_name: "Widget", qty: 3, unit_price: 25 }],
      draft: false,
    });

    const payload = client.createSalesReceipt.mock.calls[0][0];
    expect(payload.Line[0].DetailType).toBe("SalesItemLineDetail");
    expect(payload.Line[0].SalesItemLineDetail.ItemRef).toEqual({ value: "200", name: "Widget" });
    expect(payload.Line[0].SalesItemLineDetail.Qty).toBe(3);
    expect(payload.Line[0].SalesItemLineDetail.UnitPrice).toBe(25);
    expect(payload.Line[0].Amount).toBe(75); // 3 * 25
  });

  it("defaults qty to 1 when only amount provided", async () => {
    mockSuccess(client.createSalesReceipt, { Id: "600" });

    await handleCreateSalesReceipt(client as never, {
      txn_date: "2024-06-15",
      lines: [{ item_name: "Widget", amount: 50 }],
      draft: false,
    });

    const payload = client.createSalesReceipt.mock.calls[0][0];
    expect(payload.Line[0].SalesItemLineDetail.Qty).toBe(1);
    expect(payload.Line[0].SalesItemLineDetail.UnitPrice).toBe(50);
    expect(payload.Line[0].Amount).toBe(50);
  });

  it("resolves customer name to CustomerRef", async () => {
    mockSuccess(client.createSalesReceipt, { Id: "600" });

    await handleCreateSalesReceipt(client as never, {
      txn_date: "2024-06-15",
      customer_name: "John Doe",
      lines: [{ item_name: "Widget", amount: 50 }],
      draft: false,
    });

    expect(mockResolveCustomer).toHaveBeenCalledWith(expect.anything(), "John Doe");
    const payload = client.createSalesReceipt.mock.calls[0][0];
    expect(payload.CustomerRef).toEqual({ value: "300", name: "John Doe" });
  });

  it("resolves an uncached customer ID to CustomerRef", async () => {
    mockSuccess(client.createSalesReceipt, { Id: "601" });

    await handleCreateSalesReceipt(client as never, {
      txn_date: "2024-06-15",
      customer_id: "301",
      lines: [{ item_name: "Widget", amount: 50 }],
      draft: false,
    });

    expect(mockResolveCustomerById).toHaveBeenCalledWith(expect.anything(), "301");
    expect(mockResolveCustomer).not.toHaveBeenCalled();
    const payload = client.createSalesReceipt.mock.calls[0][0];
    expect(payload.CustomerRef).toEqual({ value: "301", name: "Customer By ID" });
  });

  it("throws when both customer_name and customer_id are provided", async () => {
    await expect(
      handleCreateSalesReceipt(client as never, {
        txn_date: "2024-06-15",
        customer_name: "John Doe",
        customer_id: "301",
        lines: [{ item_name: "Widget", amount: 50 }],
      })
    ).rejects.toThrow("only one");
    expect(mockResolveCustomer).not.toHaveBeenCalled();
    expect(mockResolveCustomerById).not.toHaveBeenCalled();
  });

  it("resolves deposit_to_account", async () => {
    mockSuccess(client.createSalesReceipt, { Id: "600" });

    await handleCreateSalesReceipt(client as never, {
      txn_date: "2024-06-15",
      deposit_to_account: "Cash",
      lines: [{ item_name: "Widget", amount: 50 }],
      draft: false,
    });

    const payload = client.createSalesReceipt.mock.calls[0][0];
    expect(payload.DepositToAccountRef.value).toBe("1");
  });

  it("resolves department at header level", async () => {
    mockSuccess(client.createSalesReceipt, { Id: "600" });

    await handleCreateSalesReceipt(client as never, {
      txn_date: "2024-06-15",
      department_name: "Santa Rosa",
      lines: [{ item_name: "Widget", amount: 50 }],
      draft: false,
    });

    const payload = client.createSalesReceipt.mock.calls[0][0];
    expect(payload.DepartmentRef.value).toBe("20");
  });

  it("throws when line missing item", async () => {
    await expect(
      handleCreateSalesReceipt(client as never, {
        txn_date: "2024-06-15",
        lines: [{ amount: 50 } as never],
      })
    ).rejects.toThrow("item_name or item_id");
  });

  it("throws when line missing both amount and qty+unit_price", async () => {
    await expect(
      handleCreateSalesReceipt(client as never, {
        txn_date: "2024-06-15",
        lines: [{ item_name: "Widget" }],
      })
    ).rejects.toThrow("amount, or both qty and unit_price");
  });

  it("propagates API errors", async () => {
    mockError(client.createSalesReceipt, "Duplicate doc number");

    await expect(
      handleCreateSalesReceipt(client as never, {
        txn_date: "2024-06-15",
        lines: [{ item_name: "Widget", amount: 50 }],
        draft: false,
      })
    ).rejects.toThrow("Duplicate doc number");
  });

  it("resolves item via resolveItem", async () => {
    mockSuccess(client.createSalesReceipt, { Id: "600" });

    await handleCreateSalesReceipt(client as never, {
      txn_date: "2024-06-15",
      lines: [{ item_name: "Widget", amount: 50 }],
      draft: false,
    });

    expect(mockResolveItem).toHaveBeenCalledWith(expect.anything(), "Widget");
  });
});

describe("handleGetSalesReceipt", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns formatted sales receipt", async () => {
    mockSuccess(client.getSalesReceipt, {
      Id: "600",
      SyncToken: "1",
      TxnDate: "2024-06-15",
      CustomerRef: { value: "300", name: "John Doe" },
      TotalAmt: 150,
      Line: [],
    });

    const result = await handleGetSalesReceipt(client as never, { id: "600" });
    expect(result.content[0].text).toContain("John Doe");
    expect(client.getSalesReceipt).toHaveBeenCalledOnce();
  });

  it("propagates API errors", async () => {
    mockError(client.getSalesReceipt, "Object Not Found");
    await expect(
      handleGetSalesReceipt(client as never, { id: "999" })
    ).rejects.toThrow("Object Not Found");
  });
});

describe("handleEditSalesReceipt", () => {
  let client: ReturnType<typeof createMockClient>;

  const existingSR = {
    Id: "600",
    SyncToken: "1",
    CustomerRef: { value: "300", name: "John Doe" },
    TxnDate: "2024-06-15",
    TotalAmt: 50,
    Line: [
      { Id: "1", Amount: 50, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "200", name: "Widget" }, Qty: 1, UnitPrice: 50 } },
    ],
  };

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockGetAccountCache.mockResolvedValue(createMockAccountCache() as never);
    mockGetDepartmentCache.mockResolvedValue(createMockDepartmentCache() as never);
    mockResolveItem.mockResolvedValue({ value: "200", name: "Widget" });
    mockSuccess(client.getSalesReceipt, existingSR);
  });

  it("sparse update for header-only changes", async () => {
    mockSuccess(client.updateSalesReceipt, { Id: "600", SyncToken: "2" });

    await handleEditSalesReceipt(client as never, {
      id: "600",
      memo: "Updated memo",
      draft: false,
    });

    expect(client.updateSalesReceipt).toHaveBeenCalledOnce();
    const payload = client.updateSalesReceipt.mock.calls[0][0];
    expect(payload.sparse).toBe(true);
    expect(payload.PrivateNote).toBe("Updated memo");
  });

  it("full update when lines are modified", async () => {
    mockSuccess(client.updateSalesReceipt, { Id: "600", SyncToken: "2" });

    await handleEditSalesReceipt(client as never, {
      id: "600",
      lines: [{ line_id: "1", amount: 75 }],
      draft: false,
    });

    expect(client.getSalesReceipt).toHaveBeenCalledOnce();
    expect(client.updateSalesReceipt).toHaveBeenCalledOnce();
    const payload = client.updateSalesReceipt.mock.calls[0][0];
    expect(payload.sparse).toBe(false);
  });

  it("deletes a line when delete=true", async () => {
    const twoLineSR = {
      ...existingSR,
      Line: [
        { Id: "1", Amount: 50, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "200", name: "Widget" }, Qty: 1, UnitPrice: 50 } },
        { Id: "2", Amount: 25, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { ItemRef: { value: "200", name: "Widget" }, Qty: 1, UnitPrice: 25 } },
      ],
    };
    mockSuccess(client.getSalesReceipt, twoLineSR);
    mockSuccess(client.updateSalesReceipt, { Id: "600", SyncToken: "2" });

    await handleEditSalesReceipt(client as never, {
      id: "600",
      lines: [{ line_id: "1", delete: true }],
      draft: false,
    });

    const payload = client.updateSalesReceipt.mock.calls[0][0];
    expect(payload.Line).toHaveLength(1);
    expect(payload.Line[0].Id).toBe("2");
  });

  it("throws when line_id not found", async () => {
    await expect(
      handleEditSalesReceipt(client as never, {
        id: "600",
        lines: [{ line_id: "nonexistent", amount: 100 }],
        draft: false,
      })
    ).rejects.toThrow('Line ID nonexistent not found in sales receipt');
  });
});
