// Tests for account transaction query handler and extractAccountLines

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
    resolveAccount: vi.fn(),
    getAccountCache: vi.fn(),
    getDepartmentCache: vi.fn(),
    resolveVendor: vi.fn(),
    resolveItem: vi.fn(),
    resolveCustomer: vi.fn(),
    resolveDepartmentId: vi.fn(),
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
    outputReport: vi.fn((_type: string, data: unknown, summary: string) => ({
      content: [{ type: "text", text: summary }],
      _data: data,
    })),
    getQboUrl: vi.fn((entity: string, id: string) => `https://qbo.test/${entity}/${id}`),
    isHttpMode: vi.fn(() => false),
  };
});

// Must mock pagination module since the handler imports from query barrel
vi.mock("../../../query/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../query/index.js")>(
    "../../../query/index.js"
  );
  return {
    ...actual,
    paginatedQuery: vi.fn(),
  };
});

import { handleQueryAccountTransactions } from "../account-transactions.js";
import { resolveAccount, getAccountCache, getDepartmentCache } from "../../../client/index.js";
import { outputReport } from "../../../utils/index.js";
import { paginatedQuery } from "../../../query/index.js";

const mockResolveAccount = vi.mocked(resolveAccount);
const mockGetAccountCache = vi.mocked(getAccountCache);
const mockGetDepartmentCache = vi.mocked(getDepartmentCache);
const mockOutputReport = vi.mocked(outputReport);
const mockPaginatedQuery = vi.mocked(paginatedQuery);

const RESOLVED_ACCOUNT = {
  Id: "1",
  Name: "Cash",
  FullyQualifiedName: "Cash",
  AcctNum: "1000",
  AccountType: "Bank",
  CurrentBalance: 5000,
};

describe("handleQueryAccountTransactions", () => {
  const client = createMockClient();

  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveAccount.mockResolvedValue(RESOLVED_ACCOUNT as never);
    mockGetAccountCache.mockResolvedValue(createMockAccountCache() as never);
    mockGetDepartmentCache.mockResolvedValue(createMockDepartmentCache() as never);

    // Default: all entity queries return empty
    mockPaginatedQuery.mockResolvedValue({
      entities: [],
      entityKey: "Unknown",
      apiCalls: 1,
      truncated: false,
      startPositionSpecified: false,
      hasMore: false,
      returnedCount: 0,
      requestedLimit: 10000,
    });
  });

  it("resolves account from input", async () => {
    await handleQueryAccountTransactions(client as never, {
      account: "Cash",
    });

    expect(mockResolveAccount).toHaveBeenCalledWith(expect.anything(), "Cash");
  });

  it("queries all 7 entity types", async () => {
    await handleQueryAccountTransactions(client as never, {
      account: "Cash",
    });

    // Should call paginatedQuery 7 times (JE, Purchase, Deposit, SalesReceipt, Bill, Invoice, Payment)
    expect(mockPaginatedQuery).toHaveBeenCalledTimes(7);
  });

  it("passes date range to pagination queries", async () => {
    await handleQueryAccountTransactions(client as never, {
      account: "Cash",
      start_date: "2024-01-01",
      end_date: "2024-06-30",
    });

    // Check that baseCriteria includes date filter
    const firstCall = mockPaginatedQuery.mock.calls[0];
    const pagination = firstCall[2];
    expect(pagination.baseCriteria).toContain("TxnDate >= '2024-01-01'");
    expect(pagination.baseCriteria).toContain("TxnDate <= '2024-06-30'");
  });

  it("resolves department and includes in report data", async () => {
    await handleQueryAccountTransactions(client as never, {
      account: "Cash",
      department: "Santa Rosa",
    });

    expect(mockGetDepartmentCache).toHaveBeenCalled();

    // Report data should include resolved department
    const reportData = mockOutputReport.mock.calls[0][1] as {
      department?: { id: string; name: string };
    };
    expect(reportData.department).toEqual({ id: "20", name: "Santa Rosa" });
  });

  it("throws when department not found", async () => {
    await expect(
      handleQueryAccountTransactions(client as never, {
        account: "Cash",
        department: "Nonexistent",
      })
    ).rejects.toThrow('Department not found: "Nonexistent"');
  });

  it("groups lines from same transaction together", async () => {
    // Mock a journal entry with 2 lines matching our account
    mockPaginatedQuery.mockImplementation(async (_client, finder) => {
      if (finder === "findJournalEntries") {
        return {
          entities: [{
            Id: "100",
            TxnDate: "2024-03-15",
            Line: [
              {
                Id: "1",
                Amount: 500,
                JournalEntryLineDetail: {
                  PostingType: "Debit",
                  AccountRef: { value: "1", name: "Cash" },
                },
              },
              {
                Id: "2",
                Amount: 500,
                JournalEntryLineDetail: {
                  PostingType: "Credit",
                  AccountRef: { value: "3", name: "Rent Expense" },
                },
              },
            ],
          }],
          entityKey: "JournalEntry",
          apiCalls: 1,
          truncated: false,
          startPositionSpecified: false,
          hasMore: false,
          returnedCount: 1,
          requestedLimit: 10000,
        };
      }
      return {
        entities: [],
        entityKey: "Unknown",
        apiCalls: 1,
        truncated: false,
        startPositionSpecified: false,
        hasMore: false,
        returnedCount: 0,
        requestedLimit: 10000,
      };
    });

    await handleQueryAccountTransactions(client as never, {
      account: "Cash",
    });

    const reportData = mockOutputReport.mock.calls[0][1] as {
      summary: { transactionCount: number; matchingLineCount: number };
      groupedByTransaction: Record<string, { lines: unknown[] }>;
    };

    // 1 transaction with 2 lines
    expect(reportData.summary.transactionCount).toBe(1);
    // Only 1 matching line (Cash, account ID "1")
    expect(reportData.summary.matchingLineCount).toBe(1);
    // Grouped under one key
    const groups = Object.keys(reportData.groupedByTransaction);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toBe("JournalEntry:100");
  });

  it("calculates debit/credit summary correctly", async () => {
    // Two journal entries: one debit to Cash, one credit from Cash
    mockPaginatedQuery.mockImplementation(async (_client, finder) => {
      if (finder === "findJournalEntries") {
        return {
          entities: [
            {
              Id: "100",
              TxnDate: "2024-03-15",
              Line: [
                { Id: "1", Amount: 1000, JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "1" } } },
                { Id: "2", Amount: 1000, JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "3" } } },
              ],
            },
            {
              Id: "101",
              TxnDate: "2024-03-16",
              Line: [
                { Id: "3", Amount: 250, JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "1" } } },
                { Id: "4", Amount: 250, JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "2" } } },
              ],
            },
          ],
          entityKey: "JournalEntry",
          apiCalls: 1,
          truncated: false,
          startPositionSpecified: false,
          hasMore: false,
          returnedCount: 2,
          requestedLimit: 10000,
        };
      }
      return {
        entities: [],
        entityKey: "Unknown",
        apiCalls: 1,
        truncated: false,
        startPositionSpecified: false,
        hasMore: false,
        returnedCount: 0,
        requestedLimit: 10000,
      };
    });

    await handleQueryAccountTransactions(client as never, {
      account: "Cash",
    });

    const reportData = mockOutputReport.mock.calls[0][1] as {
      summary: { totalDebits: number; totalCredits: number; netChange: number };
    };

    // Account "1" (Cash): JE 100 has debit 1000, JE 101 has credit 250
    expect(reportData.summary.totalDebits).toBe(1000);
    expect(reportData.summary.totalCredits).toBe(250);
    expect(reportData.summary.netChange).toBe(750); // debits - credits
  });

  it("gracefully handles entity query failure", async () => {
    // One entity type fails, others succeed
    let callCount = 0;
    mockPaginatedQuery.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error("Permission denied for Purchases");
      }
      return {
        entities: [],
        entityKey: "Unknown",
        apiCalls: 1,
        truncated: false,
        startPositionSpecified: false,
        hasMore: false,
        returnedCount: 0,
        requestedLimit: 10000,
      };
    });

    // Should NOT throw even though one query fails
    await handleQueryAccountTransactions(client as never, { account: "Cash" });

    // All 7 queries were attempted
    expect(mockPaginatedQuery).toHaveBeenCalledTimes(7);
  });

  it("includes account metadata in report data", async () => {
    await handleQueryAccountTransactions(client as never, { account: "Cash" });

    const reportData = mockOutputReport.mock.calls[0][1] as {
      account: { id: string; acctNum: string; name: string; type: string };
    };
    expect(reportData.account.id).toBe("1");
    expect(reportData.account.acctNum).toBe("1000");
    expect(reportData.account.name).toBe("Cash");
    expect(reportData.account.type).toBe("Bank");
  });

  it("defaults date range to year start through today", async () => {
    await handleQueryAccountTransactions(client as never, { account: "Cash" });

    const reportData = mockOutputReport.mock.calls[0][1] as {
      dateRange: { start: string; end: string };
    };
    const year = new Date().getFullYear();
    expect(reportData.dateRange.start).toBe(`${year}-01-01`);
    expect(reportData.dateRange.end).toBe(new Date().toISOString().split("T")[0]);
  });
});
