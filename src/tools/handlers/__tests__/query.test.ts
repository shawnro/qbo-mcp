import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockClient, resetMockClient } from "../../../__mocks__/mock-client.js";

// Mock the query module (paginatedQuery does the heavy lifting)
vi.mock("../../../query/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../query/index.js")>(
    "../../../query/index.js"
  );
  return {
    ...actual,
    paginatedQuery: vi.fn(),
    buildQueryErrorMessage: vi.fn(
      (_entity: string, _code: string, message: string) => `Query error: ${message}`
    ),
    summarizeTransactionLines: vi.fn(() => null),
  };
});

// Mock utils (avoid temp file writes)
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
    getQboUrl: vi.fn((_entity: string, id: string) => `https://qbo.intuit.com/app/test?txnId=${id}`),
  };
});

// Mock types (QB error detection)
vi.mock("../../../types/index.js", () => ({
  isQBError: vi.fn(() => false),
  extractQBErrorInfo: vi.fn(() => ({ code: "0", message: "unknown", detail: "" })),
}));

import { handleQuery } from "../query.js";
import { paginatedQuery } from "../../../query/index.js";
import { isQBError } from "../../../types/index.js";

const mockPaginatedQuery = vi.mocked(paginatedQuery);
const mockIsQBError = vi.mocked(isQBError);

describe("handleQuery", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  // --- Success cases ---

  it("queries customers and returns results", async () => {
    mockPaginatedQuery.mockResolvedValue({
      entities: [
        { Id: "1", DisplayName: "Acme Corp" },
        { Id: "2", DisplayName: "Widget Inc" },
      ],
      entityKey: "Customer",
      apiCalls: 1,
      truncated: false,
      startPositionSpecified: false,
      hasMore: false,
      returnedCount: 2,
      requestedLimit: 1000,
    } as never);

    const result = await handleQuery(client as never, {
      query: "SELECT * FROM Customer",
    });

    expect(result.content[0].text).toContain("Customer");
    expect(result.content[0].text).toContain("2 records");
  });

  it("queries journal entries with correct finder method", async () => {
    mockPaginatedQuery.mockResolvedValue({
      entities: [],
      entityKey: "JournalEntry",
      apiCalls: 1,
      truncated: false,
      startPositionSpecified: false,
      hasMore: false,
      returnedCount: 0,
      requestedLimit: 1000,
    } as never);

    const result = await handleQuery(client as never, {
      query: "SELECT * FROM JournalEntry",
    });

    expect(result.content[0].text).toContain("0 records");
    // Verify correct finder method was used (findJournalEntries, not findJournalEntrys)
    expect(mockPaginatedQuery).toHaveBeenCalledWith(
      expect.anything(),
      "findJournalEntries",
      expect.anything()
    );
  });

  it("maps Class to findClasses (irregular plural)", async () => {
    mockPaginatedQuery.mockResolvedValue({
      entities: [{ Id: "1", Name: "Marketing" }],
      entityKey: "Class",
      apiCalls: 1,
      truncated: false,
      startPositionSpecified: false,
      hasMore: false,
      returnedCount: 1,
      requestedLimit: 1000,
    } as never);

    await handleQuery(client as never, {
      query: "SELECT * FROM Class",
    });

    expect(mockPaginatedQuery).toHaveBeenCalledWith(
      expect.anything(),
      "findClasses",
      expect.anything()
    );
  });

  // --- Empty response ---

  it("handles empty result set", async () => {
    mockPaginatedQuery.mockResolvedValue({
      entities: [],
      entityKey: "Invoice",
      apiCalls: 1,
      truncated: false,
      startPositionSpecified: false,
      hasMore: false,
      returnedCount: 0,
      requestedLimit: 1000,
    } as never);

    const result = await handleQuery(client as never, {
      query: "SELECT * FROM Invoice WHERE TotalAmt > '99999'",
    });

    expect(result.content[0].text).toContain("0 records");
  });

  // --- Error cases ---

  it("throws on missing FROM clause", async () => {
    await expect(
      handleQuery(client as never, { query: "SELECT *" })
    ).rejects.toThrow("must contain FROM clause");
  });

  it("throws on unknown entity type", async () => {
    // findFakeEntitys won't exist on the client
    await expect(
      handleQuery(client as never, { query: "SELECT * FROM FakeEntity" })
    ).rejects.toThrow("Unknown entity type: FakeEntity");
  });

  it("handles QB query errors with enhanced message", async () => {
    mockIsQBError.mockReturnValue(true);
    mockPaginatedQuery.mockRejectedValue({
      Fault: {
        Error: [{ code: "4001", Message: "Invalid query", Detail: "Bad field" }],
      },
    });

    const result = await handleQuery(client as never, {
      query: "SELECT * FROM Customer WHERE BadField = 'x'",
    });

    expect(result.isError).toBe(true);
  });

  it("re-throws non-QB errors (auth, network)", async () => {
    mockIsQBError.mockReturnValue(false);
    mockPaginatedQuery.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      handleQuery(client as never, {
        query: "SELECT * FROM Customer",
      })
    ).rejects.toThrow("ECONNREFUSED");
  });

  // --- Pagination info ---

  it("includes pagination warning when truncated", async () => {
    mockPaginatedQuery.mockResolvedValue({
      entities: new Array(10000).fill({ Id: "x" }),
      entityKey: "Purchase",
      apiCalls: 10,
      truncated: true,
      startPositionSpecified: false,
      hasMore: true,
      returnedCount: 10000,
      requestedLimit: 1000,
    } as never);

    const result = await handleQuery(client as never, {
      query: "SELECT * FROM Purchase",
    });

    expect(result.content[0].text).toContain("truncated");
  });

  it("includes 'more data' note when hasMore is true", async () => {
    mockPaginatedQuery.mockResolvedValue({
      entities: [{ Id: "1" }],
      entityKey: "Bill",
      apiCalls: 1,
      truncated: false,
      startPositionSpecified: false,
      hasMore: true,
      returnedCount: 1,
      requestedLimit: 1,
    } as never);

    const result = await handleQuery(client as never, {
      query: "SELECT * FROM Bill MAXRESULTS 1",
    });

    expect(result.content[0].text).toContain("More data exists");
  });
});
