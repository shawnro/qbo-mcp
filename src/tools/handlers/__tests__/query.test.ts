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
import { HTTP_QUERY_LIMIT, paginatedQuery } from "../../../query/index.js";
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

  it("redacts sensitive fields recursively while preserving accounting data", async () => {
    mockPaginatedQuery.mockResolvedValue({
      entities: [{
        Id: "1",
        DisplayName: "Acme",
        taxidentifier: "sensitive-tax-id",
        VendorPaymentBankDetail: { BankAccountNumber: "sensitive-bank-account" },
        Nested: { PrimaryTaxIdentifier: "sensitive-primary-tax-id", Balance: 25 },
        Lines: [{ Amount: 25, SSN: "sensitive-ssn" }],
      }],
      entityKey: "Vendor",
      apiCalls: 1,
      truncated: false,
      startPositionSpecified: false,
      hasMore: false,
      returnedCount: 1,
      requestedLimit: 1000,
    } as never);

    const result = await handleQuery(client as never, { query: "SELECT * FROM Vendor" });
    const report = (result as unknown as { _data: { QueryResponse: { Vendor: unknown[] } } })._data;

    expect(report.QueryResponse.Vendor).toEqual([{
      Id: "1",
      DisplayName: "Acme",
      Nested: { Balance: 25 },
      Lines: [{ Amount: 25 }],
    }]);
  });

  it("projects Attachable query results without signed URLs", async () => {
    mockPaginatedQuery.mockResolvedValue({
      entities: [{
        Id: "200",
        SyncToken: "1",
        FileName: "receipt.pdf",
        TempDownloadUri: "https://signed.example/secret",
        FileAccessUri: "https://signed.example/file",
        AttachableRef: [{ EntityRef: { type: "Bill", value: "42", name: "Bill 42" } }],
      }],
      entityKey: "Attachable",
      apiCalls: 1,
      truncated: false,
      startPositionSpecified: false,
      hasMore: false,
      returnedCount: 1,
      requestedLimit: 1000,
    } as never);

    const result = await handleQuery(client as never, { query: "SELECT * FROM Attachable" });
    const report = (result as unknown as { _data: { QueryResponse: { Attachable: unknown[] } } })._data;

    expect(report.QueryResponse.Attachable).toEqual([{
      id: "200",
      syncToken: "1",
      fileName: "receipt.pdf",
      linkedEntities: [{ type: "Bill", id: "42", name: "Bill 42" }],
    }]);
    expect(JSON.stringify(report)).not.toContain("signed.example");
  });

  it("projects CompanyInfo query results without employer or preference metadata", async () => {
    (client as unknown as Record<string, unknown>).findCompanyInfos = vi.fn();
    mockPaginatedQuery.mockResolvedValue({
      entities: [{
        Id: "1",
        CompanyName: "Test Corp",
        LegalName: "Test Corporation LLC",
        Country: "US",
        FiscalYearStartMonth: "January",
        EmployerId: "12-3456789",
        NameValue: [{ Name: "SubscriptionStatus", Value: "PAID" }],
      }],
      entityKey: "CompanyInfo",
      apiCalls: 1,
      truncated: false,
      startPositionSpecified: false,
      hasMore: false,
      returnedCount: 1,
      requestedLimit: 1000,
    } as never);

    const result = await handleQuery(client as never, { query: "SELECT * FROM Company" });
    const report = (result as unknown as { _data: { QueryResponse: { CompanyInfo: unknown[] } } })._data;

    expect(report.QueryResponse.CompanyInfo).toEqual([{
      Id: "1",
      CompanyName: "Test Corp",
      LegalName: "Test Corporation LLC",
      Country: "US",
      FiscalYearStartMonth: "January",
    }]);
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

  it("explains when an explicit HTTP query limit is capped", async () => {
    mockPaginatedQuery.mockResolvedValue({
      entities: Array.from({ length: HTTP_QUERY_LIMIT }, (_, index) => ({ Id: String(index) })),
      entityKey: "Invoice",
      apiCalls: 1,
      truncated: false,
      startPositionSpecified: false,
      hasMore: true,
      returnedCount: HTTP_QUERY_LIMIT,
      requestedLimit: HTTP_QUERY_LIMIT,
    } as never);

    const result = await handleQuery(
      client as never,
      { query: "SELECT * FROM Invoice MAXRESULTS 500" },
      { output: { mode: "http", executionEnvironment: "node" } } as never
    );

    expect(mockPaginatedQuery).toHaveBeenCalledWith(
      expect.anything(),
      "findInvoices",
      expect.objectContaining({ maxResults: HTTP_QUERY_LIMIT })
    );
    expect(result.content[0].text).toContain(
      `HTTP mode detail capped at ${HTTP_QUERY_LIMIT} records`
    );
    expect(result.content[0].text).toContain("STARTPOSITION 101");
  });

  it("explains the default HTTP query limit", async () => {
    mockPaginatedQuery.mockResolvedValue({
      entities: Array.from({ length: HTTP_QUERY_LIMIT }, (_, index) => ({ Id: String(index) })),
      entityKey: "Invoice",
      apiCalls: 1,
      truncated: false,
      startPositionSpecified: false,
      hasMore: true,
      returnedCount: HTTP_QUERY_LIMIT,
      requestedLimit: HTTP_QUERY_LIMIT,
    } as never);

    const result = await handleQuery(
      client as never,
      { query: "SELECT * FROM Invoice" },
      { output: { mode: "http", executionEnvironment: "node" } } as never
    );

    expect(mockPaginatedQuery).toHaveBeenCalledWith(
      expect.anything(),
      "findInvoices",
      expect.objectContaining({ maxResults: HTTP_QUERY_LIMIT })
    );
    expect(result.content[0].text).toContain(
      `HTTP mode detail limited to ${HTTP_QUERY_LIMIT} records`
    );
    expect(result.content[0].text).toContain("STARTPOSITION 101");
  });
});
