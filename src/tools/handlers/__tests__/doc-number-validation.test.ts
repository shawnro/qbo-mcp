import { describe, expect, it } from "vitest";
import { createMockClient } from "../../../__mocks__/mock-client.js";
import { handleCreateBillPayment } from "../bill-payment.js";
import { handleCreateBill, handleEditBill } from "../bill.js";
import { handleCreateExpense } from "../expense.js";
import { handleCreateInvoice } from "../invoice.js";
import { handleCreateJournalEntry, handleEditJournalEntry } from "../journal-entry.js";
import { handleCreateSalesReceipt } from "../sales-receipt.js";
import { handleCreateVendorCredit, handleEditVendorCredit } from "../vendor-credit.js";

const overlongDocNumber = "X".repeat(22);

const cases: Array<{
  name: string;
  invoke: (client: ReturnType<typeof createMockClient>) => Promise<unknown>;
}> = [
  {
    name: "create_journal_entry",
    invoke: (client) => handleCreateJournalEntry(client as never, {
      txn_date: "2026-01-01",
      doc_number: overlongDocNumber,
      lines: [
        { account_name: "Cash", amount: 1, posting_type: "Debit" },
        { account_name: "Tips", amount: 1, posting_type: "Credit" },
      ],
    }),
  },
  {
    name: "edit_journal_entry",
    invoke: (client) => handleEditJournalEntry(client as never, {
      id: "1",
      doc_number: overlongDocNumber,
    }),
  },
  {
    name: "create_bill",
    invoke: (client) => handleCreateBill(client as never, {
      vendor_name: "Vendor",
      txn_date: "2026-01-01",
      doc_number: overlongDocNumber,
      lines: [{ account_name: "Cash", amount: 1 }],
    }),
  },
  {
    name: "edit_bill",
    invoke: (client) => handleEditBill(client as never, {
      id: "1",
      doc_number: overlongDocNumber,
    }),
  },
  {
    name: "create_expense",
    invoke: (client) => handleCreateExpense(client as never, {
      payment_type: "Cash",
      payment_account: "Cash",
      txn_date: "2026-01-01",
      doc_number: overlongDocNumber,
      lines: [{ account_name: "Expense", amount: 1 }],
    }),
  },
  {
    name: "create_sales_receipt",
    invoke: (client) => handleCreateSalesReceipt(client as never, {
      txn_date: "2026-01-01",
      doc_number: overlongDocNumber,
      lines: [{ item_name: "Item", amount: 1 }],
    }),
  },
  {
    name: "create_invoice",
    invoke: (client) => handleCreateInvoice(client as never, {
      txn_date: "2026-01-01",
      customer_name: "Customer",
      doc_number: overlongDocNumber,
      lines: [{ item_name: "Item", amount: 1 }],
    }),
  },
  {
    name: "create_vendor_credit",
    invoke: (client) => handleCreateVendorCredit(client as never, {
      vendor_name: "Vendor",
      txn_date: "2026-01-01",
      doc_number: overlongDocNumber,
      lines: [{ account_name: "Expense", amount: 1 }],
    }),
  },
  {
    name: "edit_vendor_credit",
    invoke: (client) => handleEditVendorCredit(client as never, {
      id: "1",
      doc_number: overlongDocNumber,
    }),
  },
  {
    name: "create_bill_payment",
    invoke: (client) => handleCreateBillPayment(client as never, {
      vendor_name: "Vendor",
      payment_account: "Cash",
      txn_date: "2026-01-01",
      doc_number: overlongDocNumber,
      bills: [{ bill_id: "1" }],
    }),
  },
];

describe("document number handler validation", () => {
  it.each(cases)("rejects $name before any QBO API call", async ({ invoke }) => {
    const client = createMockClient();

    await expect(invoke(client)).rejects.toThrow(
      "doc_number must be 21 characters or fewer"
    );

    for (const method of Object.values(client)) {
      expect(method).not.toHaveBeenCalled();
    }
  });
});