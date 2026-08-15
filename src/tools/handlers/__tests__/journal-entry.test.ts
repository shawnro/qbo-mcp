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

// Mock the client barrel (promisify, cache functions)
vi.mock("../../../client/index.js", () => ({
    promisify: mockPromisify,
    getAccountCache: vi.fn(),
    getDepartmentCache: vi.fn(),
    getClient: vi.fn(),
    clearCredentialsCache: vi.fn(),
    refreshTokens: vi.fn(),
    isAuthError: vi.fn(),
    clearLookupCache: vi.fn(),
    getCompanyIdValue: vi.fn(),
}));

// Mock outputReport to avoid temp file creation in tests
vi.mock("../../../utils/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/index.js")>(
    "../../../utils/index.js"
  );
  return {
    ...actual,
    outputReport: vi.fn((_type: string, _data: unknown, summary: string) => ({
      content: [{ type: "text", text: summary }],
    })),
    getQboUrl: vi.fn((_entity: string, id: string) => `https://app.qbo.intuit.com/app/journal?txnId=${id}`),
  };
});

// Import AFTER mocks are set up
import {
  handleCreateJournalEntry,
  handleGetJournalEntry,
  handleEditJournalEntry,
} from "../journal-entry.js";
import { getAccountCache, getDepartmentCache } from "../../../client/index.js";

const mockGetAccountCache = vi.mocked(getAccountCache);
const mockGetDepartmentCache = vi.mocked(getDepartmentCache);

function createAccountCacheWithNewAccounts() {
  const cache = createMockAccountCache();
  const accounts = [
    { Id: "200", Name: "New Debit Account", FullyQualifiedName: "New Debit Account", AcctNum: "7100", AccountType: "Expense", CurrentBalance: 0 },
    { Id: "201", Name: "New Credit Account", FullyQualifiedName: "New Credit Account", AcctNum: "7200", AccountType: "Income", CurrentBalance: 0 },
  ];
  const byId = new Map(cache.byId);
  const byName = new Map(cache.byName);
  const byAcctNum = new Map(cache.byAcctNum);
  for (const account of accounts) {
    byId.set(account.Id, account);
    byName.set(account.Name.toLowerCase(), account);
    byAcctNum.set(account.AcctNum, account);
  }
  return {
    ...cache,
    items: [...cache.items, ...accounts],
    byId,
    byName,
    byAcctNum,
    fetchedAt: Date.now(),
  };
}

describe("handleCreateJournalEntry", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockGetAccountCache.mockResolvedValue(createMockAccountCache() as never);
    mockGetDepartmentCache.mockResolvedValue(createMockDepartmentCache() as never);
  });

  // --- Draft mode ---

  it("returns preview in draft mode (default)", async () => {
    const result = await handleCreateJournalEntry(client as never, {
      txn_date: "2026-01-15",
      lines: [
        { account_name: "Cash", amount: 100, posting_type: "Debit" },
        { account_name: "Tips", amount: 100, posting_type: "Credit" },
      ],
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("Cash");
    expect(result.content[0].text).toContain("Tips");
    expect(result.content[0].text).toContain("$100.00");
    // No API call in draft mode
    expect(client.createJournalEntry).not.toHaveBeenCalled();
  });

  it("includes memo and doc_number in preview", async () => {
    const result = await handleCreateJournalEntry(client as never, {
      txn_date: "2026-01-15",
      memo: "Monthly rent",
      doc_number: "JE-001",
      lines: [
        { account_name: "Rent Expense", amount: 50, posting_type: "Debit" },
        { account_name: "Cash", amount: 50, posting_type: "Credit" },
      ],
    });

    expect(result.content[0].text).toContain("Monthly rent");
    expect(result.content[0].text).toContain("JE-001");
    expect(client.createJournalEntry).not.toHaveBeenCalled();
  });

  // --- Create success (minimal fields) ---

  it("creates journal entry when draft=false", async () => {
    mockSuccess(client.createJournalEntry, { Id: "123", DocNumber: "JE-001" });

    const result = await handleCreateJournalEntry(client as never, {
      txn_date: "2026-01-15",
      draft: false,
      lines: [
        { account_name: "Cash", amount: 100, posting_type: "Debit" },
        { account_name: "Tips", amount: 100, posting_type: "Credit" },
      ],
    });

    expect(result.content[0].text).toContain("Journal Entry Created");
    expect(result.content[0].text).toContain("JE-001");
    expect(client.createJournalEntry).toHaveBeenCalledOnce();
    const payload = client.createJournalEntry.mock.calls[0][0];
    expect(payload.Line.every((line: Record<string, unknown>) => !("Id" in line))).toBe(true);
  });

  it("shares one account refresh across lines and preserves line order", async () => {
    mockGetAccountCache
      .mockResolvedValueOnce(createMockAccountCache() as never)
      .mockResolvedValueOnce(createAccountCacheWithNewAccounts() as never);
    mockSuccess(client.createJournalEntry, { Id: "124", DocNumber: "JE-002" });

    await handleCreateJournalEntry(client as never, {
      txn_date: "2026-01-15",
      draft: false,
      lines: [
        { account_name: "New Debit Account", amount: 100, posting_type: "Debit" },
        { account_name: "New Credit Account", amount: 100, posting_type: "Credit" },
      ],
    });

    const payload = client.createJournalEntry.mock.calls[0][0];
    expect(payload.Line.map((line: { JournalEntryLineDetail: { AccountRef: { value: string } } }) =>
      line.JournalEntryLineDetail.AccountRef.value
    )).toEqual(["200", "201"]);
    expect(mockGetAccountCache).toHaveBeenCalledTimes(2);
    expect(mockGetAccountCache).toHaveBeenLastCalledWith(client, { forceRefresh: true });
  });

  // --- Create success (all optional fields) ---

  it("creates with all optional fields (memo, doc_number, department, description)", async () => {
    mockSuccess(client.createJournalEntry, { Id: "456", DocNumber: "JE-002" });

    const result = await handleCreateJournalEntry(client as never, {
      txn_date: "2026-03-01",
      memo: "Office supplies for Santa Rosa",
      doc_number: "JE-002",
      draft: false,
      lines: [
        {
          account_name: "Office Supplies",
          amount: 75.50,
          posting_type: "Debit",
          department_name: "Santa Rosa",
          description: "Printer paper and toner",
        },
        {
          account_name: "Cash",
          amount: 75.50,
          posting_type: "Credit",
          description: "Payment from petty cash",
        },
      ],
    });

    expect(result.content[0].text).toContain("Journal Entry Created");
    expect(client.createJournalEntry).toHaveBeenCalledOnce();
  });

  // --- Payload inspection ---

  it("sends correct payload shape to QB API", async () => {
    mockSuccess(client.createJournalEntry, { Id: "789" });

    await handleCreateJournalEntry(client as never, {
      txn_date: "2026-06-15",
      memo: "Test memo",
      doc_number: "JE-100",
      draft: false,
      lines: [
        { account_name: "Tips", amount: 50, posting_type: "Credit", department_name: "Santa Rosa" },
        { account_name: "Cash", amount: 50, posting_type: "Debit" },
      ],
    });

    const payload = client.createJournalEntry.mock.calls[0][0];

    // Top-level fields
    expect(payload.TxnDate).toBe("2026-06-15");
    expect(payload.PrivateNote).toBe("Test memo");
    expect(payload.DocNumber).toBe("JE-100");

    // Line items
    expect(payload.Line).toHaveLength(2);

    // Credit line with department
    const creditLine = payload.Line.find(
      (l: Record<string, unknown>) =>
        (l.JournalEntryLineDetail as Record<string, unknown>).PostingType === "Credit"
    );
    expect(creditLine.Amount).toBe(50);
    expect(creditLine.DetailType).toBe("JournalEntryLineDetail");
    expect(creditLine.JournalEntryLineDetail.AccountRef).toEqual({
      value: "2",
      name: "Tips",
    });
    expect(creditLine.JournalEntryLineDetail.DepartmentRef).toEqual({
      value: "20",
    });

    // Debit line without department
    const debitLine = payload.Line.find(
      (l: Record<string, unknown>) =>
        (l.JournalEntryLineDetail as Record<string, unknown>).PostingType === "Debit"
    );
    expect(debitLine.Amount).toBe(50);
    expect(debitLine.JournalEntryLineDetail.AccountRef).toEqual({
      value: "1",
      name: "Cash",
    });
    expect(debitLine.JournalEntryLineDetail.DepartmentRef).toBeUndefined();
  });

  // --- Optional fields don't inject keys when omitted ---

  it("omits DocNumber from payload when not provided", async () => {
    mockSuccess(client.createJournalEntry, { Id: "999" });

    await handleCreateJournalEntry(client as never, {
      txn_date: "2026-01-01",
      draft: false,
      lines: [
        { account_name: "Cash", amount: 10, posting_type: "Debit" },
        { account_name: "Tips", amount: 10, posting_type: "Credit" },
      ],
    });

    const payload = client.createJournalEntry.mock.calls[0][0];
    expect(payload).not.toHaveProperty("DocNumber");
  });

  // --- Name resolution ---

  it("resolves account names to IDs via cache", async () => {
    mockSuccess(client.createJournalEntry, { Id: "100" });

    await handleCreateJournalEntry(client as never, {
      txn_date: "2026-01-15",
      draft: false,
      lines: [
        { account_name: "Tips", amount: 25, posting_type: "Credit" },
        { account_name: "Cash", amount: 25, posting_type: "Debit" },
      ],
    });

    const payload = client.createJournalEntry.mock.calls[0][0];
    const tipsLine = payload.Line.find(
      (l: Record<string, unknown>) =>
        (l.JournalEntryLineDetail as Record<string, unknown>).PostingType === "Credit"
    );
    expect(tipsLine.JournalEntryLineDetail.AccountRef.value).toBe("2"); // Tips Id
  });

  it("resolves account by AcctNum", async () => {
    mockSuccess(client.createJournalEntry, { Id: "101" });

    await handleCreateJournalEntry(client as never, {
      txn_date: "2026-01-15",
      draft: false,
      lines: [
        { account_name: "4100", amount: 30, posting_type: "Credit" }, // AcctNum for Tips
        { account_name: "1000", amount: 30, posting_type: "Debit" }, // AcctNum for Cash
      ],
    });

    const payload = client.createJournalEntry.mock.calls[0][0];
    const creditLine = payload.Line.find(
      (l: Record<string, unknown>) =>
        (l.JournalEntryLineDetail as Record<string, unknown>).PostingType === "Credit"
    );
    expect(creditLine.JournalEntryLineDetail.AccountRef.value).toBe("2"); // Tips
  });

  it("throws when account name not found", async () => {
    await expect(
      handleCreateJournalEntry(client as never, {
        txn_date: "2026-01-15",
        lines: [
          { account_name: "Nonexistent Account", amount: 100, posting_type: "Debit" },
          { account_name: "Cash", amount: 100, posting_type: "Credit" },
        ],
      })
    ).rejects.toThrow('Account not found: "Nonexistent Account"');
  });

  it("throws when department name not found", async () => {
    await expect(
      handleCreateJournalEntry(client as never, {
        txn_date: "2026-01-15",
        lines: [
          {
            account_name: "Cash",
            amount: 100,
            posting_type: "Debit",
            department_name: "Nonexistent Dept",
          },
          { account_name: "Tips", amount: 100, posting_type: "Credit" },
        ],
      })
    ).rejects.toThrow('Department not found: "Nonexistent Dept"');
  });

  // --- Balance validation ---

  it("throws when lines array is empty", async () => {
    await expect(
      handleCreateJournalEntry(client as never, {
        txn_date: "2026-01-15",
        lines: [],
      })
    ).rejects.toThrow("At least one line is required");
  });

  it("throws when debits don't equal credits", async () => {
    await expect(
      handleCreateJournalEntry(client as never, {
        txn_date: "2026-01-15",
        lines: [
          { account_name: "Cash", amount: 100, posting_type: "Debit" },
          { account_name: "Tips", amount: 99.99, posting_type: "Credit" },
        ],
      })
    ).rejects.toThrow("Debits");
  });

  // --- Amount validation ---

  it("throws when amount has more than 2 decimal places", async () => {
    await expect(
      handleCreateJournalEntry(client as never, {
        txn_date: "2026-01-15",
        lines: [
          { account_name: "Cash", amount: 100.001, posting_type: "Debit" },
          { account_name: "Tips", amount: 100.001, posting_type: "Credit" },
        ],
      })
    ).rejects.toThrow("decimal places");
  });

  // --- API error ---

  it("propagates QB API errors", async () => {
    mockError(client.createJournalEntry, "Duplicate DocNumber");

    await expect(
      handleCreateJournalEntry(client as never, {
        txn_date: "2026-01-15",
        draft: false,
        lines: [
          { account_name: "Cash", amount: 50, posting_type: "Debit" },
          { account_name: "Tips", amount: 50, posting_type: "Credit" },
        ],
      })
    ).rejects.toThrow("Duplicate DocNumber");
  });

  // --- Missing required fields ---

  it("throws when line has neither account_id nor account_name", async () => {
    await expect(
      handleCreateJournalEntry(client as never, {
        txn_date: "2026-01-15",
        lines: [
          { amount: 100, posting_type: "Debit" } as never,
          { account_name: "Tips", amount: 100, posting_type: "Credit" },
        ],
      })
    ).rejects.toThrow("account_id or account_name");
  });

  // --- JSON string lines (MCP transport edge case) ---

  it("handles lines passed as JSON string", async () => {
    mockSuccess(client.createJournalEntry, { Id: "200" });

    const lines = JSON.stringify([
      { account_name: "Cash", amount: 40, posting_type: "Debit" },
      { account_name: "Tips", amount: 40, posting_type: "Credit" },
    ]);

    const result = await handleCreateJournalEntry(client as never, {
      txn_date: "2026-01-15",
      draft: false,
      lines: lines as never,
    });

    expect(result.content[0].text).toContain("Journal Entry Created");
    expect(client.createJournalEntry).toHaveBeenCalledOnce();
  });
});

describe("handleGetJournalEntry", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns formatted journal entry", async () => {
    mockSuccess(client.getJournalEntry, {
      Id: "55",
      SyncToken: "3",
      TxnDate: "2026-06-01",
      DocNumber: "JE-055",
      PrivateNote: "Test memo",
      TotalAmt: 100,
      Line: [
        {
          Id: "0",
          Amount: 100,
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: {
            PostingType: "Debit",
            AccountRef: { value: "1", name: "Cash" },
          },
        },
        {
          Id: "1",
          Amount: 100,
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: {
            PostingType: "Credit",
            AccountRef: { value: "2", name: "Tips" },
          },
        },
      ],
    });

    const result = await handleGetJournalEntry(client as never, { id: "55" });

    expect(result.content[0].text).toContain("Journal Entry");
    expect(result.content[0].text).toContain("SyncToken: 3");
    expect(result.content[0].text).toContain("JE-055");
    expect(result.content[0].text).toContain("Cash");
    expect(result.content[0].text).toContain("Tips");
    expect(client.getJournalEntry).toHaveBeenCalledOnce();
  });

  it("propagates API errors", async () => {
    mockError(client.getJournalEntry, "Object Not Found");

    await expect(
      handleGetJournalEntry(client as never, { id: "999" })
    ).rejects.toThrow("Object Not Found");
  });

  it("handles journal entry with no lines", async () => {
    mockSuccess(client.getJournalEntry, {
      Id: "60",
      SyncToken: "0",
      TxnDate: "2026-01-01",
      Line: [],
    });

    const result = await handleGetJournalEntry(client as never, { id: "60" });
    expect(result.content[0].text).toContain("60");
  });
});

describe("handleEditJournalEntry", () => {
  let client: ReturnType<typeof createMockClient>;

  const existingJE = {
    Id: "77",
    SyncToken: "2",
    TxnDate: "2026-05-01",
    DocNumber: "JE-077",
    PrivateNote: "Original memo",
    Line: [
      {
        Id: "0",
        Amount: 200,
        Description: "Original debit",
        DetailType: "JournalEntryLineDetail",
        JournalEntryLineDetail: {
          PostingType: "Debit",
          AccountRef: { value: "1", name: "Cash" },
        },
      },
      {
        Id: "1",
        Amount: 200,
        Description: "Original credit",
        DetailType: "JournalEntryLineDetail",
        JournalEntryLineDetail: {
          PostingType: "Credit",
          AccountRef: { value: "2", name: "Tips" },
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
    // Default: getJournalEntry returns the existing JE
    mockSuccess(client.getJournalEntry, existingJE);
  });

  it("returns preview in draft mode for simple field changes", async () => {
    const result = await handleEditJournalEntry(client as never, {
      id: "77",
      memo: "Updated memo",
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("Updated memo");
    expect(client.updateJournalEntry).not.toHaveBeenCalled();
  });

  it("updates simple fields with sparse update when draft=false", async () => {
    mockSuccess(client.updateJournalEntry, { Id: "77", SyncToken: "3" });

    await handleEditJournalEntry(client as never, {
      id: "77",
      memo: "New memo",
      txn_date: "2026-06-01",
      draft: false,
    });

    const payload = client.updateJournalEntry.mock.calls[0][0];
    expect(payload.Id).toBe("77");
    expect(payload.SyncToken).toBe("2");
    expect(payload.sparse).toBe(true);
    expect(payload.PrivateNote).toBe("New memo");
    expect(payload.TxnDate).toBe("2026-06-01");
  });

  it("uses full update (sparse=false) when modifying lines", async () => {
    mockSuccess(client.updateJournalEntry, { Id: "77", SyncToken: "3" });

    await handleEditJournalEntry(client as never, {
      id: "77",
      draft: false,
      lines: [
        { line_id: "0", amount: 300 },
        { line_id: "1", amount: 300 },
      ],
    });

    const payload = client.updateJournalEntry.mock.calls[0][0];
    expect(payload.sparse).toBe(false);
    expect(payload.Line).toBeDefined();
  });

  it("lets QBO assign IDs to new lines added during edit", async () => {
    mockSuccess(client.updateJournalEntry, { Id: "77", SyncToken: "3" });

    await handleEditJournalEntry(client as never, {
      id: "77",
      draft: false,
      lines: [
        { account_name: "Rent Expense", amount: 50, posting_type: "Debit" },
        { account_name: "Cash", amount: 50, posting_type: "Credit" },
      ],
    });

    const payload = client.updateJournalEntry.mock.calls[0][0];
    const persistedIds = payload.Line
      .filter((line: Record<string, unknown>) => "Id" in line)
      .map((line: Record<string, unknown>) => line.Id);
    const newLines = payload.Line.filter((line: Record<string, unknown>) => !("Id" in line));

    expect(persistedIds).toEqual(["0", "1"]);
    expect(newLines).toHaveLength(2);
  });

  it("deletes a line by line_id", async () => {
    // Set up a 4-line JE (2 debits, 2 credits) so deleting one pair stays balanced
    const fourLineJE = {
      ...existingJE,
      Line: [
        ...existingJE.Line,
        {
          Id: "2",
          Amount: 50,
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: {
            PostingType: "Debit",
            AccountRef: { value: "3", name: "Rent Expense" },
          },
        },
        {
          Id: "3",
          Amount: 50,
          DetailType: "JournalEntryLineDetail",
          JournalEntryLineDetail: {
            PostingType: "Credit",
            AccountRef: { value: "1", name: "Cash" },
          },
        },
      ],
    };
    mockSuccess(client.getJournalEntry, fourLineJE);
    mockSuccess(client.updateJournalEntry, { Id: "77", SyncToken: "3" });

    await handleEditJournalEntry(client as never, {
      id: "77",
      draft: false,
      lines: [
        { line_id: "2", delete: true },
        { line_id: "3", delete: true },
      ],
    });

    const payload = client.updateJournalEntry.mock.calls[0][0];
    const lineIds = payload.Line.map((l: Record<string, unknown>) => l.Id);
    expect(lineIds).not.toContain("2");
    expect(lineIds).not.toContain("3");
    expect(lineIds).toContain("0");
    expect(lineIds).toContain("1");
  });

  it("throws when line_id not found", async () => {
    await expect(
      handleEditJournalEntry(client as never, {
        id: "77",
        draft: false,
        lines: [{ line_id: "999", amount: 50 }],
      })
    ).rejects.toThrow("Line ID 999 not found");
  });

  it("propagates API errors on update", async () => {
    mockError(client.updateJournalEntry, "Stale SyncToken");

    await expect(
      handleEditJournalEntry(client as never, {
        id: "77",
        memo: "fail",
        draft: false,
      })
    ).rejects.toThrow("Stale SyncToken");
  });

  it("propagates API errors on get (fetch current)", async () => {
    mockError(client.getJournalEntry, "Object Not Found");

    await expect(
      handleEditJournalEntry(client as never, {
        id: "77",
        memo: "anything",
        draft: false,
      })
    ).rejects.toThrow("Object Not Found");
  });
});
