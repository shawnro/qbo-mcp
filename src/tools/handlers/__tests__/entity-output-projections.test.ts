import { describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  mockPromisify,
  mockSuccess,
} from "../../../__mocks__/mock-client.js";

vi.mock("../../../client/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../client/index.js")>(
    "../../../client/index.js"
  );
  return { ...actual, promisify: mockPromisify };
});

import { handleGetBillPayment } from "../bill-payment.js";
import { handleGetBill } from "../bill.js";
import { handleGetClass } from "../class.js";
import { handleGetDeposit } from "../deposit.js";
import { handleGetExpense } from "../expense.js";
import { handleGetInvoice } from "../invoice.js";
import { handleGetJournalEntry } from "../journal-entry.js";
import { handleGetSalesReceipt } from "../sales-receipt.js";
import { handleGetVendorCredit } from "../vendor-credit.js";

const context = {
  output: { mode: "http", executionEnvironment: "local" },
} as never;

type Getter = (
  client: never,
  args: { id: string },
  context: never
) => Promise<{ content: Array<{ type: string; text: string }> }>;

interface ProjectionCase {
  name: string;
  method: string;
  getter: Getter;
  response: Record<string, unknown>;
  retained: string[];
}

const cases: ProjectionCase[] = [
  {
    name: "bill payment",
    method: "getBillPayment",
    getter: handleGetBillPayment as Getter,
    response: {
      Id: "10",
      SyncToken: "2",
      TxnDate: "2026-01-01",
      TotalAmt: 25,
      PayType: "Check",
      VendorRef: { value: "40", name: "Vendor" },
      CheckPayment: { BankAccountRef: { value: "41", name: "Checking" } },
      Line: [{
        Amount: 25,
        LinkedTxn: [{ TxnId: "20", TxnType: "Bill", HiddenTxnField: "omit" }],
        HiddenLineField: "omit",
      }],
      HiddenEntityField: "omit",
    },
    retained: [
      '"SyncToken":"2"',
      '"VendorRef":{"value":"40"',
      '"BankAccountRef":{"value":"41"',
      '"TxnId":"20"',
      '"TxnType":"Bill"',
    ],
  },
  {
    name: "bill",
    method: "getBill",
    getter: handleGetBill as Getter,
    response: {
      Id: "11",
      SyncToken: "3",
      TxnDate: "2026-01-01",
      TotalAmt: 30,
      DepartmentRef: { value: "4", name: "North" },
      CurrencyRef: { value: "USD", name: "United States Dollar" },
      LinkedTxn: [{ TxnId: "31", TxnType: "BillPaymentCheck", HiddenTxnField: "omit" }],
      Line: [{
        Id: "21",
        Amount: 30,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "7", name: "Expense" },
          HiddenDetailField: "omit",
        },
        HiddenLineField: "omit",
      }],
      HiddenEntityField: "omit",
    },
    retained: [
      '"SyncToken":"3"',
      '"Id":"21"',
      '"AccountRef":{"value":"7"',
      '"DepartmentRef":{"value":"4"',
      '"CurrencyRef":{"value":"USD"',
      '"TxnId":"31"',
    ],
  },
  {
    name: "class",
    method: "getClass",
    getter: handleGetClass as Getter,
    response: {
      Id: "12",
      SyncToken: "4",
      Name: "Operations",
      ParentRef: { value: "1", name: "Company" },
      HiddenEntityField: "omit",
    },
    retained: ['"SyncToken":"4"', '"ParentRef":{"value":"1"'],
  },
  {
    name: "deposit",
    method: "getDeposit",
    getter: handleGetDeposit as Getter,
    response: {
      Id: "13",
      SyncToken: "5",
      TxnDate: "2026-01-01",
      TotalAmt: 35,
      DepositToAccountRef: { value: "42", name: "Savings" },
      Line: [{
        Id: "22",
        Amount: 35,
        DetailType: "DepositLineDetail",
        DepositLineDetail: {
          AccountRef: { value: "8", name: "Income" },
          HiddenDetailField: "omit",
        },
        HiddenLineField: "omit",
      }],
      HiddenEntityField: "omit",
    },
    retained: [
      '"SyncToken":"5"',
      '"DepositToAccountRef":{"value":"42"',
      '"Id":"22"',
      '"AccountRef":{"value":"8"',
    ],
  },
  {
    name: "expense",
    method: "getPurchase",
    getter: handleGetExpense as Getter,
    response: {
      Id: "14",
      SyncToken: "6",
      TxnDate: "2026-01-01",
      PaymentType: "Cash",
      TotalAmt: 40,
      TxnTaxDetail: { HiddenTaxDetail: "omit" },
      LinkedTxn: [{ TxnId: "32", TxnType: "Bill", TxnLineId: "2", HiddenTxnField: "omit" }],
      Line: [{
        Id: "23",
        Amount: 40,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "9", name: "Supplies" },
          CustomerRef: { value: "30", name: "Customer" },
          HiddenDetailField: "omit",
        },
        HiddenLineField: "omit",
      }],
      HiddenEntityField: "omit",
    },
    retained: [
      '"SyncToken":"6"',
      '"Id":"23"',
      '"CustomerRef":{"value":"30"',
      '"TxnId":"32"',
      '"TxnLineId":"2"',
    ],
  },
  {
    name: "invoice",
    method: "getInvoice",
    getter: handleGetInvoice as Getter,
    response: {
      Id: "15",
      SyncToken: "7",
      TxnDate: "2026-01-01",
      TotalAmt: 45,
      LinkedTxn: [{ TxnId: "34", TxnType: "Payment", HiddenTxnField: "omit" }],
      Line: [{
        Id: "24",
        Amount: 45,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "10", name: "Service" },
          TaxCodeRef: { value: "TAX" },
          HiddenDetailField: "omit",
        },
        HiddenLineField: "omit",
      }],
      HiddenEntityField: "omit",
    },
    retained: [
      '"SyncToken":"7"',
      '"TxnId":"34"',
      '"Id":"24"',
      '"TaxCodeRef":{"value":"TAX"',
    ],
  },
  {
    name: "journal entry",
    method: "getJournalEntry",
    getter: handleGetJournalEntry as Getter,
    response: {
      Id: "16",
      SyncToken: "8",
      TxnDate: "2026-01-01",
      TotalAmt: 50,
      Line: [{
        Id: "25",
        Amount: 50,
        DetailType: "JournalEntryLineDetail",
        JournalEntryLineDetail: {
          PostingType: "Debit",
          AccountRef: { value: "11", name: "Checking" },
          DepartmentRef: { value: "43", name: "West" },
          HiddenDetailField: "omit",
        },
        HiddenLineField: "omit",
      }],
      HiddenEntityField: "omit",
    },
    retained: [
      '"SyncToken":"8"',
      '"Id":"25"',
      '"PostingType":"Debit"',
      '"DepartmentRef":{"value":"43"',
    ],
  },
  {
    name: "sales receipt",
    method: "getSalesReceipt",
    getter: handleGetSalesReceipt as Getter,
    response: {
      Id: "17",
      SyncToken: "9",
      TxnDate: "2026-01-01",
      TotalAmt: 55,
      DepositToAccountRef: { value: "44", name: "Undeposited Funds" },
      Line: [{
        Id: "26",
        Amount: 55,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: "12", name: "Product" },
          ClassRef: { value: "2", name: "Retail" },
          HiddenDetailField: "omit",
        },
        HiddenLineField: "omit",
      }],
      HiddenEntityField: "omit",
    },
    retained: [
      '"SyncToken":"9"',
      '"DepositToAccountRef":{"value":"44"',
      '"Id":"26"',
      '"ClassRef":{"value":"2"',
    ],
  },
  {
    name: "vendor credit",
    method: "getVendorCredit",
    getter: handleGetVendorCredit as Getter,
    response: {
      Id: "18",
      SyncToken: "10",
      TxnDate: "2026-01-01",
      TotalAmt: 60,
      LinkedTxn: [{ TxnId: "33", TxnType: "BillPaymentCheck", HiddenTxnField: "omit" }],
      Line: [{
        Id: "27",
        Amount: 60,
        DetailType: "AccountBasedExpenseLineDetail",
        AccountBasedExpenseLineDetail: {
          AccountRef: { value: "13", name: "Expense" },
          BillableStatus: "NotBillable",
          HiddenDetailField: "omit",
        },
        HiddenLineField: "omit",
      }],
      HiddenEntityField: "omit",
    },
    retained: [
      '"SyncToken":"10"',
      '"Id":"27"',
      '"BillableStatus":"NotBillable"',
      '"TxnId":"33"',
    ],
  },
];

describe("entity getter output projections", () => {
  it.each(cases)("allowlists $name report data", async ({ method, getter, response, retained }) => {
    const client = createMockClient();
    mockSuccess(client[method], response);

    const result = await getter(client as never, { id: String(response.Id) }, context);
    const output = result.content.map((item) => item.text).join("\n");

    for (const fragment of retained) expect(output).toContain(fragment);
    expect(output).not.toContain("HiddenEntityField");
    expect(output).not.toContain("HiddenLineField");
    expect(output).not.toContain("HiddenDetailField");
    expect(output).not.toContain("HiddenTxnField");
    expect(output).not.toContain("HiddenTaxDetail");
  });
});