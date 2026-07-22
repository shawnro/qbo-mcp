// Tests for account period summary handler (GL report parsing)

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockClient,
  mockSuccess,
  resetMockClient,
  mockPromisify,
} from "../../../__mocks__/mock-client.js";

vi.mock("../../../client/index.js", () => ({
    promisify: mockPromisify,
    resolveAccount: vi.fn(),
    resolveDepartmentId: vi.fn(),
    getAccountCache: vi.fn(),
    getDepartmentCache: vi.fn(),
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
    outputReport: vi.fn((_type: string, data: unknown, summary: string) => ({
      content: [{ type: "text", text: summary }],
      _data: data, // Expose for assertions
    })),
  };
});

import { handleAccountPeriodSummary } from "../account-period-summary.js";
import { resolveAccount, resolveDepartmentId } from "../../../client/index.js";
import { outputReport } from "../../../utils/index.js";

const mockResolveAccount = vi.mocked(resolveAccount);
const mockResolveDepartmentId = vi.mocked(resolveDepartmentId);
const mockOutputReport = vi.mocked(outputReport);

const RESOLVED_ACCOUNT = {
  Id: "42",
  Name: "Cash",
  FullyQualifiedName: "Cash",
  AcctNum: "1000",
  AccountType: "Bank",
  CurrentBalance: 5000,
};

// Build a GL report structure for testing
function buildGLReport(opts: {
  beginningBalance?: number;
  transactions?: Array<{ amount: number; balance: number }>;
  nested?: boolean;
}) {
  const { beginningBalance = 0, transactions = [], nested = false } = opts;

  const columns = [
    { ColTitle: "Date", ColType: "Date" },
    { ColTitle: "Transaction Type", ColType: "String" },
    { ColTitle: "Num", ColType: "String" },
    { ColTitle: "Name", ColType: "String" },
    { ColTitle: "Memo/Description", ColType: "String" },
    { ColTitle: "Split", ColType: "String" },
    { ColTitle: "Amount", ColType: "Money" },
    { ColTitle: "Balance", ColType: "Money" },
  ];

  const dataRows = [];

  // Beginning Balance row
  if (beginningBalance !== 0) {
    const bbColData = columns.map(() => ({ value: "" }));
    bbColData[0] = { value: "Beginning Balance" };
    bbColData[7] = { value: String(beginningBalance) }; // Balance column
    dataRows.push({ type: "Data", ColData: bbColData });
  }

  // Transaction rows
  for (const txn of transactions) {
    const colData = columns.map(() => ({ value: "" }));
    colData[0] = { value: "2024-06-15" };
    colData[1] = { value: "Journal Entry" };
    colData[6] = { value: String(txn.amount) }; // Amount
    colData[7] = { value: String(txn.balance) }; // Balance
    dataRows.push({ type: "Data", ColData: colData });
  }

  let rows;
  if (nested) {
    // Wrap in a Section (simulating parent → child account)
    rows = [{
      type: "Section",
      Rows: {
        Row: [{
          type: "Section",
          Rows: { Row: dataRows },
        }],
      },
    }];
  } else {
    rows = dataRows;
  }

  return {
    Columns: { Column: columns },
    Rows: { Row: rows },
  };
}

describe("handleAccountPeriodSummary", () => {
  const client = createMockClient();

  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveAccount.mockResolvedValue(RESOLVED_ACCOUNT as never);
    mockResolveDepartmentId.mockResolvedValue("10");
  });

  it("parses GL with beginning balance and transactions", async () => {
    const report = buildGLReport({
      beginningBalance: 1000,
      transactions: [
        { amount: -200, balance: 1200 }, // debit
        { amount: 50, balance: 1150 },   // credit
        { amount: -100, balance: 1250 }, // debit
      ],
    });
    mockSuccess(client.reportGeneralLedgerDetail, report);

    await handleAccountPeriodSummary(client as never, {
      account: "Cash",
      start_date: "2024-01-01",
      end_date: "2024-12-31",
    });

    // Verify outputReport was called with parsed summary data
    expect(mockOutputReport).toHaveBeenCalledOnce();
    const reportData = mockOutputReport.mock.calls[0][1] as {
      summary: {
        openingBalance: number;
        closingBalance: number;
        totalDebits: number;
        totalCredits: number;
        netActivity: number;
        transactionCount: number;
      };
    };

    expect(reportData.summary.openingBalance).toBe(1000);
    expect(reportData.summary.closingBalance).toBe(1250);
    expect(reportData.summary.totalDebits).toBe(300);  // 200 + 100
    expect(reportData.summary.totalCredits).toBe(50);
    expect(reportData.summary.netActivity).toBe(-250); // 50 - 300
    expect(reportData.summary.transactionCount).toBe(3);
  });

  it("handles empty GL (no transactions)", async () => {
    const report = buildGLReport({
      beginningBalance: 500,
      transactions: [],
    });
    mockSuccess(client.reportGeneralLedgerDetail, report);

    await handleAccountPeriodSummary(client as never, {
      account: "Cash",
      start_date: "2024-01-01",
      end_date: "2024-12-31",
    });

    const reportData = mockOutputReport.mock.calls[0][1] as {
      summary: { openingBalance: number; closingBalance: number; transactionCount: number };
    };
    expect(reportData.summary.openingBalance).toBe(500);
    expect(reportData.summary.closingBalance).toBe(500); // closing = opening when no txns
    expect(reportData.summary.transactionCount).toBe(0);
  });

  it("handles nested GL sections (parent → child accounts)", async () => {
    const report = buildGLReport({
      beginningBalance: 200,
      transactions: [
        { amount: -50, balance: 250 },
      ],
      nested: true,
    });
    mockSuccess(client.reportGeneralLedgerDetail, report);

    await handleAccountPeriodSummary(client as never, {
      account: "Cash",
    });

    const reportData = mockOutputReport.mock.calls[0][1] as {
      summary: { openingBalance: number; totalDebits: number; transactionCount: number };
    };
    expect(reportData.summary.openingBalance).toBe(200);
    expect(reportData.summary.totalDebits).toBe(50);
    expect(reportData.summary.transactionCount).toBe(1);
  });

  it("handles GL with no beginning balance row", async () => {
    const report = buildGLReport({
      transactions: [
        { amount: -100, balance: 100 },
      ],
    });
    mockSuccess(client.reportGeneralLedgerDetail, report);

    await handleAccountPeriodSummary(client as never, { account: "Cash" });

    const reportData = mockOutputReport.mock.calls[0][1] as {
      summary: { openingBalance: number; closingBalance: number };
    };
    expect(reportData.summary.openingBalance).toBe(0);
    expect(reportData.summary.closingBalance).toBe(100);
  });

  it("handles GL with empty report", async () => {
    mockSuccess(client.reportGeneralLedgerDetail, {
      Columns: { Column: [] },
      Rows: { Row: [] },
    });

    await handleAccountPeriodSummary(client as never, { account: "Cash" });

    const reportData = mockOutputReport.mock.calls[0][1] as {
      summary: { transactionCount: number };
    };
    expect(reportData.summary.transactionCount).toBe(0);
  });

  it("resolves account and passes to report options", async () => {
    mockSuccess(client.reportGeneralLedgerDetail, {
      Columns: { Column: [] },
      Rows: { Row: [] },
    });

    await handleAccountPeriodSummary(client as never, {
      account: "Cash",
      start_date: "2024-01-01",
      end_date: "2024-06-30",
    });

    expect(mockResolveAccount).toHaveBeenCalledWith(expect.anything(), "Cash");

    // Verify reportGeneralLedgerDetail called with resolved account ID
    expect(client.reportGeneralLedgerDetail).toHaveBeenCalledOnce();
    const reportArgs = client.reportGeneralLedgerDetail.mock.calls[0][0];
    expect(reportArgs.account).toBe("42");
    expect(reportArgs.start_date).toBe("2024-01-01");
    expect(reportArgs.end_date).toBe("2024-06-30");
  });

  it("passes department to report options when provided", async () => {
    mockSuccess(client.reportGeneralLedgerDetail, {
      Columns: { Column: [] },
      Rows: { Row: [] },
    });

    await handleAccountPeriodSummary(client as never, {
      account: "Cash",
      department: "Santa Rosa",
    });

    expect(mockResolveDepartmentId).toHaveBeenCalledWith(expect.anything(), "Santa Rosa");
    const reportArgs = client.reportGeneralLedgerDetail.mock.calls[0][0];
    expect(reportArgs.department).toBe("10");
  });

  it("passes accounting_method to report options", async () => {
    mockSuccess(client.reportGeneralLedgerDetail, {
      Columns: { Column: [] },
      Rows: { Row: [] },
    });

    await handleAccountPeriodSummary(client as never, {
      account: "Cash",
      accounting_method: "Cash",
    });

    const reportArgs = client.reportGeneralLedgerDetail.mock.calls[0][0];
    expect(reportArgs.accounting_method).toBe("Cash");
  });

  it("includes account metadata in report data", async () => {
    mockSuccess(client.reportGeneralLedgerDetail, {
      Columns: { Column: [] },
      Rows: { Row: [] },
    });

    await handleAccountPeriodSummary(client as never, { account: "Cash" });

    const reportData = mockOutputReport.mock.calls[0][1] as {
      account: { id: string; acctNum: string; name: string; type: string };
    };
    expect(reportData.account.id).toBe("42");
    expect(reportData.account.acctNum).toBe("1000");
    expect(reportData.account.name).toBe("Cash");
    expect(reportData.account.type).toBe("Bank");
  });

  it("all-credit transactions produce positive netActivity", async () => {
    const report = buildGLReport({
      transactions: [
        { amount: 100, balance: 100 },
        { amount: 200, balance: 300 },
      ],
    });
    mockSuccess(client.reportGeneralLedgerDetail, report);

    await handleAccountPeriodSummary(client as never, { account: "Cash" });

    const reportData = mockOutputReport.mock.calls[0][1] as {
      summary: { totalDebits: number; totalCredits: number; netActivity: number };
    };
    expect(reportData.summary.totalDebits).toBe(0);
    expect(reportData.summary.totalCredits).toBe(300);
    expect(reportData.summary.netActivity).toBe(300);
  });
});
