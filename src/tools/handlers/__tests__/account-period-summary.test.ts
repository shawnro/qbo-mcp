import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  mockError,
  mockPromisify,
  mockSuccess,
  resetMockClient,
} from "../../../__mocks__/mock-client.js";
import { createMockDepartmentCache } from "../../../__mocks__/mock-cache.js";

vi.mock("../../../client/index.js", () => ({
  promisify: mockPromisify,
  resolveAccount: vi.fn(),
  getDepartmentCache: vi.fn(),
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
  };
});

import { resolveAccount, getDepartmentCache } from "../../../client/index.js";
import { outputReport } from "../../../utils/index.js";
import { handleAccountPeriodSummary } from "../account-period-summary.js";

const mockResolveAccount = vi.mocked(resolveAccount);
const mockGetDepartmentCache = vi.mocked(getDepartmentCache);
const mockOutputReport = vi.mocked(outputReport);

const COLUMNS = [
  "Date",
  "Transaction Type",
  "Num",
  "Name",
  "Memo/Description",
  "Split",
  "Amount",
  "Balance",
];

function report(amounts: Array<{ amount: number; balance: number }>, options: {
  opening?: number;
  basis?: string;
} = {}) {
  const rows: Array<Record<string, unknown>> = [];
  if (options.opening !== undefined) {
    rows.push({
      type: "Data",
      ColData: COLUMNS.map((_, index) => ({
        value: index === 0 ? "Beginning Balance" : index === 7 ? String(options.opening) : "",
      })),
    });
  }
  amounts.forEach((entry, index) => rows.push({
    type: "Data",
    ColData: COLUMNS.map((_, columnIndex) => ({
      value: columnIndex === 0
        ? "2026-01-15"
        : columnIndex === 1
          ? "Journal Entry"
          : columnIndex === 6
            ? String(entry.amount)
            : columnIndex === 7
              ? String(entry.balance)
              : "",
      ...(columnIndex === 1 && { id: String(index + 1) }),
    })),
  }));
  return {
    Header: {
      ReportName: "GeneralLedger",
      StartPeriod: "2026-01-01",
      EndPeriod: "2026-01-31",
      ReportBasis: options.basis || "Accrual",
    },
    Columns: { Column: COLUMNS.map(title => ({ ColTitle: title })) },
    Rows: { Row: [{ type: "Section", Rows: { Row: rows } }] },
  };
}

describe("handleAccountPeriodSummary", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockResolveAccount.mockResolvedValue({
      Id: "35",
      Name: "Checking",
      FullyQualifiedName: "Checking",
      AcctNum: "1000",
      AccountType: "Bank",
      CurrentBalance: 1201,
    } as never);
    mockGetDepartmentCache.mockResolvedValue(createMockDepartmentCache() as never);
    mockSuccess(client.reportGeneralLedgerDetail, report([]));
  });

  it("calculates correct Bank debit and credit totals from normal-balance amounts", async () => {
    mockSuccess(client.reportGeneralLedgerDetail, report([
      { amount: 200, balance: 1200 },
      { amount: -50, balance: 1150 },
    ], { opening: 1000 }));

    await handleAccountPeriodSummary(client as never, { account: "Checking" });
    const data = mockOutputReport.mock.calls[0][1] as {
      summary: Record<string, number>;
    };
    expect(data.summary).toMatchObject({
      openingBalance: 1000,
      closingBalance: 1150,
      totalDebits: 200,
      totalCredits: 50,
      netActivity: 150,
      transactionCount: 2,
      postingCount: 2,
    });
  });

  it("calculates correct Accounts Payable debit and credit totals", async () => {
    mockResolveAccount.mockResolvedValue({
      Id: "33",
      Name: "Accounts Payable (A/P)",
      AccountType: "Accounts Payable",
      CurrentBalance: 300,
    } as never);
    mockSuccess(client.reportGeneralLedgerDetail, report([
      { amount: 300, balance: 400 },
      { amount: -100, balance: 300 },
    ], { opening: 100 }));

    await handleAccountPeriodSummary(client as never, { account: "A/P" });
    const data = mockOutputReport.mock.calls[0][1] as {
      summary: Record<string, number>;
    };
    expect(data.summary).toMatchObject({
      totalDebits: 100,
      totalCredits: 300,
      netActivity: 200,
      closingBalance: 300,
    });
  });

  it("handles an empty report", async () => {
    mockSuccess(client.reportGeneralLedgerDetail, report([], { opening: 500 }));
    await handleAccountPeriodSummary(client as never, { account: "Checking" });
    const data = mockOutputReport.mock.calls[0][1] as {
      summary: Record<string, number>;
    };
    expect(data.summary).toMatchObject({
      openingBalance: 500,
      closingBalance: 500,
      transactionCount: 0,
      postingCount: 0,
    });
  });

  it("passes account, dates, department, and accounting method to QBO", async () => {
    mockSuccess(client.reportGeneralLedgerDetail, report([], { basis: "Cash" }));
    await handleAccountPeriodSummary(client as never, {
      account: "Checking",
      start_date: "2026-01-01",
      end_date: "2026-01-31",
      department: "Santa Rosa",
      accounting_method: "Cash",
    });

    expect(client.reportGeneralLedgerDetail.mock.calls[0][0]).toEqual({
      account: "35",
      start_date: "2026-01-01",
      end_date: "2026-01-31",
      accounting_method: "Cash",
      department: "20",
    });
    const data = mockOutputReport.mock.calls[0][1] as {
      department?: { id: string; name?: string };
      accountingMethod: string;
    };
    expect(data.department).toEqual({ id: "20", name: "Santa Rosa" });
    expect(data.accountingMethod).toBe("Cash");
  });

  it("propagates report errors", async () => {
    mockError(client.reportGeneralLedgerDetail, "General Ledger unavailable");
    await expect(handleAccountPeriodSummary(client as never, { account: "Checking" }))
      .rejects.toThrow("General Ledger unavailable");
    expect(mockOutputReport).not.toHaveBeenCalled();
  });

  it("rejects invalid dates, methods, and report basis mismatches", async () => {
    await expect(handleAccountPeriodSummary(client as never, {
      account: "Checking",
      start_date: "2026-02-30",
    })).rejects.toThrow("valid calendar date");
    await expect(handleAccountPeriodSummary(client as never, {
      account: "Checking",
      accounting_method: "Hybrid",
    })).rejects.toThrow("Accrual");

    mockSuccess(client.reportGeneralLedgerDetail, report([], { basis: "Accrual" }));
    await expect(handleAccountPeriodSummary(client as never, {
      account: "Checking",
      accounting_method: "Cash",
    })).rejects.toThrow("returned Accrual basis after Cash was requested");
  });
});
