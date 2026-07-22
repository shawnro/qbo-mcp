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
    getQboUrl: vi.fn((_entity: string, id: string) => `https://app.qbo.intuit.com/app/deposit?txnId=${id}`),
  };
});

import { handleCreateDeposit, handleGetDeposit, handleEditDeposit } from "../deposit.js";
import { getAccountCache, getDepartmentCache, getVendorCache } from "../../../client/index.js";

const mockGetAccountCache = vi.mocked(getAccountCache);
const mockGetDepartmentCache = vi.mocked(getDepartmentCache);
const mockGetVendorCache = vi.mocked(getVendorCache);

describe("handleCreateDeposit", () => {
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
    const result = await handleCreateDeposit(client as never, {
      deposit_to_account: "Cash",
      txn_date: "2026-05-01",
      lines: [{ account_name: "Tips", amount: 200 }],
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("$200.00");
    expect(client.createDeposit).not.toHaveBeenCalled();
  });

  it("creates deposit with minimal fields", async () => {
    mockSuccess(client.createDeposit, { Id: "800" });

    const result = await handleCreateDeposit(client as never, {
      deposit_to_account: "Cash",
      txn_date: "2026-05-01",
      draft: false,
      lines: [{ account_name: "Tips", amount: 100 }],
    });

    expect(result.content[0].text).toContain("Deposit Created");
    expect(client.createDeposit).toHaveBeenCalledOnce();
  });

  it("creates with entity per line", async () => {
    mockSuccess(client.createDeposit, { Id: "801" });

    await handleCreateDeposit(client as never, {
      deposit_to_account: "Cash",
      txn_date: "2026-05-01",
      draft: false,
      lines: [{ account_name: "Tips", amount: 150, entity_name: "Office Depot" }],
    });

    const payload = client.createDeposit.mock.calls[0][0];
    const line = payload.Line[0];
    expect(line.DetailType).toBe("DepositLineDetail");
    expect(line.DepositLineDetail.AccountRef).toEqual({ value: "2", name: "Tips" });
    expect(line.DepositLineDetail.Entity).toBeDefined();
    expect(line.DepositLineDetail.Entity.value).toBe("100"); // Office Depot
  });

  it("resolves DepositToAccountRef", async () => {
    mockSuccess(client.createDeposit, { Id: "802" });

    await handleCreateDeposit(client as never, {
      deposit_to_account: "Cash",
      txn_date: "2026-05-01",
      draft: false,
      lines: [{ account_name: "Tips", amount: 50 }],
    });

    const payload = client.createDeposit.mock.calls[0][0];
    expect(payload.DepositToAccountRef).toEqual({ value: "1", name: "Cash" });
  });

  it("includes DepartmentRef when provided", async () => {
    mockSuccess(client.createDeposit, { Id: "803" });

    await handleCreateDeposit(client as never, {
      deposit_to_account: "Cash",
      txn_date: "2026-05-01",
      department_name: "Petaluma",
      draft: false,
      lines: [{ account_name: "Tips", amount: 75 }],
    });

    const payload = client.createDeposit.mock.calls[0][0];
    expect(payload.DepartmentRef).toEqual({ value: "30", name: "Petaluma" });
  });

  it("creates with multiple deposit lines and sums total", async () => {
    mockSuccess(client.createDeposit, { Id: "804" });

    const result = await handleCreateDeposit(client as never, {
      deposit_to_account: "Cash",
      txn_date: "2026-05-01",
      draft: false,
      lines: [
        { account_name: "Tips", amount: 100 },
        { account_name: "Tips", amount: 250.50 },
        { account_name: "Tips", amount: 49.50 },
      ],
    });

    const payload = client.createDeposit.mock.calls[0][0];
    expect(payload.Line).toHaveLength(3);
    expect(payload.Line[0].Amount).toBe(100);
    expect(payload.Line[1].Amount).toBe(250.50);
    expect(payload.Line[2].Amount).toBe(49.50);
    expect(result.content[0].text).toContain("$400.00");
  });

  it("throws when account not found", async () => {
    await expect(
      handleCreateDeposit(client as never, {
        deposit_to_account: "Nonexistent Bank",
        txn_date: "2026-05-01",
        lines: [{ account_name: "Tips", amount: 50 }],
      })
    ).rejects.toThrow("not found");
  });

  it("propagates API errors", async () => {
    mockError(client.createDeposit, "Server Error");

    await expect(
      handleCreateDeposit(client as never, {
        deposit_to_account: "Cash",
        txn_date: "2026-05-01",
        draft: false,
        lines: [{ account_name: "Tips", amount: 50 }],
      })
    ).rejects.toThrow("Server Error");
  });

  it("throws when lines array is empty", async () => {
    await expect(
      handleCreateDeposit(client as never, {
        deposit_to_account: "Cash",
        txn_date: "2026-05-01",
        lines: [],
      })
    ).rejects.toThrow("At least one line is required");
  });
});

describe("handleGetDeposit", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns formatted deposit with SyncToken", async () => {
    mockSuccess(client.getDeposit, {
      Id: "800",
      SyncToken: "1",
      TxnDate: "2026-05-01",
      DepositToAccountRef: { value: "1", name: "Cash" },
      TotalAmt: 200,
      Line: [],
    });

    const result = await handleGetDeposit(client as never, { id: "800" });
    expect(result.content[0].text).toContain("SyncToken: 1");
  });

  it("propagates API errors", async () => {
    mockError(client.getDeposit, "Not Found");
    await expect(handleGetDeposit(client as never, { id: "999" })).rejects.toThrow("Not Found");
  });
});

describe("handleEditDeposit", () => {
  let client: ReturnType<typeof createMockClient>;

  const existingDeposit = {
    Id: "800",
    SyncToken: "1",
    TxnDate: "2026-05-01",
    PrivateNote: "Original",
    TotalAmt: 200,
    DepositToAccountRef: { value: "1", name: "Cash" },
    DepartmentRef: { value: "10", name: "Main Office" },
    Line: [
      {
        Id: "1",
        Amount: 200,
        DetailType: "DepositLineDetail",
        DepositLineDetail: {
          AccountRef: { value: "2", name: "Tips" },
          Entity: { value: "100", name: "Office Depot", type: "Vendor" },
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
    mockSuccess(client.getDeposit, existingDeposit);
  });

  it("sparse update when no line changes", async () => {
    mockSuccess(client.updateDeposit, { Id: "800", SyncToken: "2" });

    await handleEditDeposit(client as never, {
      id: "800",
      memo: "Updated",
      draft: false,
    });

    const payload = client.updateDeposit.mock.calls[0][0];
    expect(payload.sparse).toBe(true);
    expect(payload.PrivateNote).toBe("Updated");
  });

  it("full update with line replacement (validates total matches)", async () => {
    mockSuccess(client.updateDeposit, { Id: "800", SyncToken: "2" });

    await handleEditDeposit(client as never, {
      id: "800",
      draft: false,
      lines: [{ account_name: "Tips", amount: 200 }],
    });

    const payload = client.updateDeposit.mock.calls[0][0];
    expect(payload.sparse).toBe(false);
    expect(payload.Line).toHaveLength(1);
  });

  it("throws when new total doesn't match original", async () => {
    await expect(
      handleEditDeposit(client as never, {
        id: "800",
        draft: false,
        lines: [{ account_name: "Tips", amount: 999 }],
      })
    ).rejects.toThrow(/total|match|mismatch/i);
  });

  it("expected_total bypasses total validation", async () => {
    mockSuccess(client.updateDeposit, { Id: "800", SyncToken: "2" });

    await handleEditDeposit(client as never, {
      id: "800",
      draft: false,
      expected_total: 500,
      lines: [{ account_name: "Tips", amount: 500 }],
    });

    expect(client.updateDeposit).toHaveBeenCalledOnce();
  });

  it("propagates API errors", async () => {
    mockError(client.updateDeposit, "Concurrency Error");
    await expect(
      handleEditDeposit(client as never, { id: "800", memo: "x", draft: false })
    ).rejects.toThrow("Concurrency Error");
  });
});
