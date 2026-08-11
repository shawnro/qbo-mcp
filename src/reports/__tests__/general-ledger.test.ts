import { describe, expect, it } from "vitest";
import {
  normalizeAccountingMethod,
  normalizeGeneralLedgerReport,
  normalizePostingAmount,
  parseReportMoney,
  projectAccountPostings,
  projectLedgerSummary,
  resolveReportDateRange,
  validateLedgerAccountType,
  type GeneralLedgerCell,
  type GeneralLedgerReport,
  type GeneralLedgerRow,
} from "../general-ledger.js";

const DEFAULT_COLUMNS = [
  "Date",
  "Transaction Type",
  "Num",
  "Name",
  "Memo/Description",
  "Split",
  "Amount",
  "Balance",
];

function cells(
  values: Record<string, { value?: string; id?: string }>,
  columns = DEFAULT_COLUMNS
): GeneralLedgerCell[] {
  return columns.map(title => values[title] ?? { value: "" });
}

function report(
  rows: GeneralLedgerRow[],
  columns = DEFAULT_COLUMNS,
  basis = "Accrual"
): GeneralLedgerReport {
  return {
    Header: {
      ReportName: "GeneralLedger",
      StartPeriod: "2026-01-01",
      EndPeriod: "2026-01-31",
      ReportBasis: basis,
      Currency: "USD",
    },
    Columns: {
      Column: columns.map(title => ({ ColTitle: title, ColType: title === "Amount" || title === "Balance" ? "Money" : "String" })),
    },
    Rows: { Row: rows },
  };
}

function dataRow(values: Record<string, { value?: string; id?: string }>, columns = DEFAULT_COLUMNS): GeneralLedgerRow {
  return { type: "Data", ColData: cells(values, columns) };
}

describe("General Ledger normalization", () => {
  it("maps postings by column title and preserves QBO IDs", () => {
    const columns = [
      "Name",
      "Amount",
      "Date",
      "Split",
      "Balance",
      "Transaction Type",
      "Memo/Description",
      "Num",
    ];
    const normalized = normalizeGeneralLedgerReport(report([
      dataRow({
        Date: { value: "2026-01-15" },
        "Transaction Type": { value: "Bill Payment (Check)", id: "91" },
        Num: { value: "10" },
        Name: { value: "Robertson & Associates", id: "49" },
        "Memo/Description": { value: "Paid invoice" },
        Split: { value: "Accounts Payable (A/P)", id: "33" },
        Amount: { value: "-300.00" },
        Balance: { value: "4,700.00" },
      }, columns),
    ], columns));

    expect(normalized.postings).toEqual([{
      sectionKey: "root",
      date: "2026-01-15",
      transactionType: "Bill Payment (Check)",
      transactionId: "91",
      docNumber: "10",
      name: "Robertson & Associates",
      nameId: "49",
      memo: "Paid invoice",
      splitAccount: "Accounts Payable (A/P)",
      splitAccountId: "33",
      rawAmount: -300,
      runningBalance: 4700,
    }]);
  });

  it("walks nested sections and classifies beginning balances separately", () => {
    const normalized = normalizeGeneralLedgerReport(report([{
      type: "Section",
      Rows: { Row: [{
        type: "Section",
        Rows: { Row: [
          dataRow({
            Date: { value: "Beginning Balance" },
            Balance: { value: "1,000.00" },
          }),
          dataRow({
            Date: { value: "2026-01-20" },
            "Transaction Type": { value: "Expense", id: "107" },
            Amount: { value: "(250.00)" },
            Balance: { value: "750.00" },
          }),
        ] },
      }] },
    }]));

    expect(normalized.openingBalances).toHaveLength(1);
    expect(normalized.openingBalances[0].balance).toBe(1000);
    expect(normalized.postings[0].rawAmount).toBe(-250);
    expect(normalized.postings[0].sectionKey).not.toBe("root");
  });

  it("fails loudly when required report columns are missing", () => {
    expect(() => normalizeGeneralLedgerReport(report([], ["Date", "Amount"])))
      .toThrow('missing required column "Transaction Type"');
  });

  it("fails loudly when a transaction row omits Amount", () => {
    expect(() => normalizeGeneralLedgerReport(report([
      dataRow({
        Date: { value: "2026-01-20" },
        "Transaction Type": { value: "Invoice", id: "10" },
      }),
    ]))).toThrow("omitted its Amount");
  });

  it("fails loudly when a transaction row omits Date", () => {
    expect(() => normalizeGeneralLedgerReport(report([
      dataRow({
        "Transaction Type": { value: "Invoice", id: "10" },
        Amount: { value: "100.00" },
        Balance: { value: "100.00" },
      }),
    ]))).toThrow("omitted its Date");
  });
});

describe("General Ledger money and sign semantics", () => {
  it("parses QBO money formats", () => {
    expect(parseReportMoney("1,234.56", "amount")).toBe(1234.56);
    expect(parseReportMoney("$1,234.56", "amount")).toBe(1234.56);
    expect(parseReportMoney("(1,234.56)", "amount")).toBe(-1234.56);
    expect(parseReportMoney(".00", "amount")).toBe(0);
    expect(parseReportMoney("", "amount")).toBeUndefined();
    expect(() => parseReportMoney("not-money", "amount")).toThrow("not a valid amount");
  });

  it("normalizes debit-normal accounts to positive debits", () => {
    expect(normalizePostingAmount(125, "Bank")).toEqual({ amount: 125, postingType: "Debit" });
    expect(normalizePostingAmount(-25, "Expense")).toEqual({ amount: -25, postingType: "Credit" });
  });

  it("normalizes credit-normal accounts to negative credits", () => {
    expect(normalizePostingAmount(300, "Accounts Payable")).toEqual({ amount: -300, postingType: "Credit" });
    expect(normalizePostingAmount(-100, "Income")).toEqual({ amount: 100, postingType: "Debit" });
  });

  it("rejects unknown account types rather than guessing", () => {
    expect(() => normalizePostingAmount(10, "Non-Posting"))
      .toThrow("Unsupported QBO AccountType");
    expect(() => validateLedgerAccountType(undefined)).toThrow("missing AccountType");
  });
});

describe("General Ledger projections", () => {
  it("projects stable source entities and QBO links where mappings are known", () => {
    const ledger = normalizeGeneralLedgerReport(report([
      dataRow({
        Date: { value: "2026-01-20" },
        "Transaction Type": { value: "Bill Payment (Check)", id: "91" },
        Amount: { value: "-300.00" },
        Balance: { value: "4,700.00" },
      }),
      dataRow({
        Date: { value: "2026-01-21" },
        "Transaction Type": { value: "Inventory Qty Adjust", id: "113" },
        Amount: { value: "5.00" },
        Balance: { value: "4,705.00" },
      }),
    ]));

    const postings = projectAccountPostings(ledger, "Bank");
    expect(postings[0]).toMatchObject({
      sourceEntityType: "billpayment",
      postingType: "Credit",
      amount: -300,
      qboLink: "https://app.qbo.intuit.com/app/billpayment?txnId=91",
    });
    expect(postings[1].sourceEntityType).toBeUndefined();
    expect(postings[1].qboLink).toBeUndefined();
  });

  it("calculates correct debit-normal totals while retaining normal-balance activity", () => {
    const ledger = normalizeGeneralLedgerReport(report([
      dataRow({ Date: { value: "Beginning Balance" }, Balance: { value: "1000.00" } }),
      dataRow({
        Date: { value: "2026-01-10" },
        "Transaction Type": { value: "Deposit", id: "1" },
        Amount: { value: "200.00" },
        Balance: { value: "1200.00" },
      }),
      dataRow({
        Date: { value: "2026-01-11" },
        "Transaction Type": { value: "Expense", id: "2" },
        Amount: { value: "-50.00" },
        Balance: { value: "1150.00" },
      }),
    ]));

    expect(projectLedgerSummary(ledger, "Bank")).toEqual({
      openingBalance: 1000,
      closingBalance: 1150,
      totalDebits: 200,
      totalCredits: 50,
      netActivity: 150,
      transactionCount: 2,
      postingCount: 2,
    });
  });

  it("calculates correct credit-normal totals and unique transaction counts", () => {
    const ledger = normalizeGeneralLedgerReport(report([
      dataRow({ Date: { value: "Beginning Balance" }, Balance: { value: "100.00" } }),
      dataRow({
        Date: { value: "2026-01-10" },
        "Transaction Type": { value: "Bill", id: "90" },
        Amount: { value: "300.00" },
        Balance: { value: "400.00" },
      }),
      dataRow({
        Date: { value: "2026-01-10" },
        "Transaction Type": { value: "Bill", id: "90" },
        Amount: { value: "25.00" },
        Balance: { value: "425.00" },
      }),
      dataRow({
        Date: { value: "2026-01-11" },
        "Transaction Type": { value: "Bill Payment (Check)", id: "91" },
        Amount: { value: "-125.00" },
        Balance: { value: "300.00" },
      }),
    ]));

    expect(projectLedgerSummary(ledger, "Accounts Payable")).toEqual({
      openingBalance: 100,
      closingBalance: 300,
      totalDebits: 125,
      totalCredits: 325,
      netActivity: 200,
      transactionCount: 2,
      postingCount: 3,
    });
  });

  it("sums independent nested account sections without using the last row globally", () => {
    const ledger = normalizeGeneralLedgerReport(report([
      { type: "Section", Rows: { Row: [
        dataRow({ Date: { value: "Beginning Balance" }, Balance: { value: "100.00" } }),
        dataRow({
          Date: { value: "2026-01-10" },
          "Transaction Type": { value: "Expense", id: "1" },
          Amount: { value: "25.00" },
          Balance: { value: "125.00" },
        }),
      ] } },
      { type: "Section", Rows: { Row: [
        dataRow({ Date: { value: "Beginning Balance" }, Balance: { value: "200.00" } }),
        dataRow({
          Date: { value: "2026-01-11" },
          "Transaction Type": { value: "Expense", id: "2" },
          Amount: { value: "50.00" },
          Balance: { value: "250.00" },
        }),
      ] } },
    ]));

    expect(projectLedgerSummary(ledger, "Expense")).toMatchObject({
      openingBalance: 300,
      closingBalance: 375,
      totalDebits: 75,
      totalCredits: 0,
      netActivity: 75,
    });
  });

  it("rejects postings that do not reconcile to the reported closing balance", () => {
    const ledger = normalizeGeneralLedgerReport(report([
      dataRow({ Date: { value: "Beginning Balance" }, Balance: { value: "100.00" } }),
      dataRow({
        Date: { value: "2026-01-10" },
        "Transaction Type": { value: "Deposit", id: "1" },
        Amount: { value: "25.00" },
        Balance: { value: "999.00" },
      }),
    ]));
    expect(() => projectLedgerSummary(ledger, "Bank")).toThrow("do not reconcile");
  });
});

describe("report option validation", () => {
  it("validates and defaults report dates", () => {
    expect(resolveReportDateRange("2026-01-01", "2026-01-31")).toEqual({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
    expect(() => resolveReportDateRange("2026-02-30", "2026-03-01"))
      .toThrow("not a valid calendar date");
    expect(() => resolveReportDateRange("2026-02-01", "2026-01-01"))
      .toThrow("on or before");
  });

  it("normalizes accounting method", () => {
    expect(normalizeAccountingMethod()).toBe("Accrual");
    expect(normalizeAccountingMethod("cash")).toBe("Cash");
    expect(() => normalizeAccountingMethod("hybrid")).toThrow("Accrual");
  });
});
