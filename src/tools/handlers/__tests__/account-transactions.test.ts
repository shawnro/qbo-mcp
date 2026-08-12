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
import { outputReport, setOutputMode } from "../../../utils/index.js";
import { handleQueryAccountTransactions } from "../account-transactions.js";

const mockResolveAccount = vi.mocked(resolveAccount);
const mockGetDepartmentCache = vi.mocked(getDepartmentCache);
const mockOutputReport = vi.mocked(outputReport);

const RESOLVED_ACCOUNT = {
  Id: "35",
  Name: "Checking",
  FullyQualifiedName: "Checking",
  AcctNum: "1000",
  AccountType: "Bank",
  CurrentBalance: 1201,
};

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

function glReport(rows: Array<{
  date: string;
  type: string;
  id?: string;
  num?: string;
  name?: string;
  nameId?: string;
  memo?: string;
  split?: string;
  splitId?: string;
  amount: string;
  balance: string;
}>, basis = "Accrual") {
  return {
    Header: {
      ReportName: "GeneralLedger",
      StartPeriod: "2026-01-01",
      EndPeriod: "2026-01-31",
      ReportBasis: basis,
      Currency: "USD",
    },
    Columns: {
      Column: COLUMNS.map(title => ({ ColTitle: title, ColType: title === "Amount" || title === "Balance" ? "Money" : "String" })),
    },
    Rows: {
      Row: [{
        type: "Section",
        Rows: {
          Row: rows.map(row => ({
            type: "Data",
            ColData: [
              { value: row.date },
              { value: row.type, id: row.id },
              { value: row.num || "" },
              { value: row.name || "", id: row.nameId },
              { value: row.memo || "" },
              { value: row.split || "", id: row.splitId },
              { value: row.amount },
              { value: row.balance },
            ],
          })),
        },
      }],
    },
  };
}

describe("handleQueryAccountTransactions", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    setOutputMode("stdio");
    mockResolveAccount.mockResolvedValue(RESOLVED_ACCOUNT as never);
    mockGetDepartmentCache.mockResolvedValue(createMockDepartmentCache() as never);
    mockSuccess(client.reportGeneralLedgerDetail, glReport([]));
  });

  it("calls one authoritative GL report with resolved filters", async () => {
    mockSuccess(client.reportGeneralLedgerDetail, glReport([], "Cash"));
    await handleQueryAccountTransactions(client as never, {
      account: "Checking",
      start_date: "2026-01-01",
      end_date: "2026-01-31",
      accounting_method: "Cash",
    });

    expect(mockResolveAccount).toHaveBeenCalledWith(client, "Checking", undefined);
    expect(client.reportGeneralLedgerDetail).toHaveBeenCalledOnce();
    expect(client.reportGeneralLedgerDetail.mock.calls[0][0]).toEqual({
      account: "35",
      start_date: "2026-01-01",
      end_date: "2026-01-31",
      accounting_method: "Cash",
    });
  });

  it("resolves and passes a department filter", async () => {
    await handleQueryAccountTransactions(client as never, {
      account: "Checking",
      department: "Santa Rosa",
    });

    const options = client.reportGeneralLedgerDetail.mock.calls[0][0];
    expect(options.department).toBe("20");
    const reportData = mockOutputReport.mock.calls[0][1] as {
      department?: { id: string; name?: string };
    };
    expect(reportData.department).toEqual({ id: "20", name: "Santa Rosa" });
  });

  it("rejects missing departments before calling the report", async () => {
    await expect(handleQueryAccountTransactions(client as never, {
      account: "Checking",
      department: "Missing",
    })).rejects.toThrow('Department not found: "Missing"');
    expect(client.reportGeneralLedgerDetail).not.toHaveBeenCalled();
  });

  it("returns authoritative postings with stable identities and correct bank signs", async () => {
    mockSuccess(client.reportGeneralLedgerDetail, glReport([
      {
        date: "2026-01-10",
        type: "Deposit",
        id: "4",
        memo: "Opening deposit",
        split: "Opening Balance Equity",
        splitId: "34",
        amount: "5000.00",
        balance: "5000.00",
      },
      {
        date: "2026-01-11",
        type: "Bill Payment (Check)",
        id: "91",
        num: "10",
        name: "Robertson & Associates",
        nameId: "49",
        split: "Accounts Payable (A/P)",
        splitId: "33",
        amount: "-300.00",
        balance: "4700.00",
      },
    ]));

    await handleQueryAccountTransactions(client as never, { account: "Checking" });

    const data = mockOutputReport.mock.calls[0][1] as {
      summary: Record<string, number>;
      postings: Array<Record<string, unknown>>;
    };
    expect(data.summary).toMatchObject({
      transactionCount: 2,
      postingCount: 2,
      totalDebits: 5000,
      totalCredits: 300,
      netChange: 4700,
      balanceChange: 4700,
      closingBalance: 4700,
    });
    expect(data.postings[1]).toMatchObject({
      transactionType: "Bill Payment (Check)",
      transactionId: "91",
      sourceEntityType: "billpayment",
      postingType: "Credit",
      amount: -300,
      splitAccount: "Accounts Payable (A/P)",
      splitAccountId: "33",
      qboLink: "https://app.qbo.intuit.com/app/billpayment?txnId=91",
    });
  });

  it("marks multi-split postings without inventing a counterpart account", async () => {
    mockSuccess(client.reportGeneralLedgerDetail, glReport([{
      date: "2026-01-10",
      type: "Journal Entry",
      id: "154",
      split: "-Split-",
      amount: "-1.23",
      balance: "-1.23",
    }]));

    await handleQueryAccountTransactions(client as never, { account: "Checking" });
    const data = mockOutputReport.mock.calls[0][1] as {
      postings: Array<Record<string, unknown>>;
    };
    expect(data.postings[0]).toMatchObject({
      hasMultipleSplits: true,
      splitAccount: undefined,
      splitAccountId: undefined,
    });
  });

  it("propagates report failures instead of returning partial success", async () => {
    mockError(client.reportGeneralLedgerDetail, "Permission denied for General Ledger");

    await expect(handleQueryAccountTransactions(client as never, { account: "Checking" }))
      .rejects.toThrow("Permission denied for General Ledger");
    expect(mockOutputReport).not.toHaveBeenCalled();
  });

  it("rejects a report basis mismatch", async () => {
    mockSuccess(client.reportGeneralLedgerDetail, glReport([], "Accrual"));
    await expect(handleQueryAccountTransactions(client as never, {
      account: "Checking",
      accounting_method: "Cash",
    })).rejects.toThrow("returned Accrual basis after Cash was requested");
  });

  it("rejects a report that omits its accounting basis", async () => {
    const missingBasis = glReport([]);
    (missingBasis.Header as { ReportBasis?: string }).ReportBasis = undefined;
    mockSuccess(client.reportGeneralLedgerDetail, missingBasis);
    await expect(handleQueryAccountTransactions(client as never, { account: "Checking" }))
      .rejects.toThrow("omitted ReportBasis");
  });

  it("validates date ranges and accounting method before QBO calls", async () => {
    await expect(handleQueryAccountTransactions(client as never, {
      account: "Checking",
      start_date: "2026-02-30",
    })).rejects.toThrow("valid calendar date");
    await expect(handleQueryAccountTransactions(client as never, {
      account: "Checking",
      start_date: "2026-02-01",
      end_date: "2026-01-01",
    })).rejects.toThrow("on or before");
    await expect(handleQueryAccountTransactions(client as never, {
      account: "Checking",
      accounting_method: "Hybrid",
    })).rejects.toThrow("Accrual");
    expect(client.reportGeneralLedgerDetail).not.toHaveBeenCalled();
  });

  it("caps HTTP detail while computing summaries from every returned posting", async () => {
    setOutputMode("http");
    const rows = Array.from({ length: 101 }, (_, index) => ({
      date: "2026-01-10",
      type: "Expense",
      id: String(index + 1),
      amount: "-1.00",
      balance: String(-(index + 1)),
    }));
    mockSuccess(client.reportGeneralLedgerDetail, glReport(rows));

    await handleQueryAccountTransactions(client as never, { account: "Checking" });
    const data = mockOutputReport.mock.calls[0][1] as {
      summary: { postingCount: number; totalCredits: number };
      postings: unknown[];
      detailTruncatedAt?: number;
      totalPostings?: number;
    };
    expect(data.summary).toMatchObject({ postingCount: 101, totalCredits: 101 });
    expect(data.postings).toHaveLength(100);
    expect(data.detailTruncatedAt).toBe(100);
    expect(data.totalPostings).toBe(101);
  });
});
