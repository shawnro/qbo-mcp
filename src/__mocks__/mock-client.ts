// Mock QuickBooks client for testing handlers
// Provides vi.fn() stubs for all QB API methods used by handlers

import { vi } from "vitest";

/**
 * Promisify implementation for use in vi.mock() blocks.
 * Matches the real promisify from src/client/promisify.ts.
 */
export function mockPromisify<T>(
  fn: (callback: (err: Error | null, result: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

/**
 * Create a mock QuickBooks client with vi.fn() stubs for all methods.
 * Each method can be configured per-test via mockImplementation.
 */
export function createMockClient() {
  return {
    // Journal Entry
    createJournalEntry: vi.fn(),
    getJournalEntry: vi.fn(),
    updateJournalEntry: vi.fn(),

    // Bill
    createBill: vi.fn(),
    getBill: vi.fn(),
    updateBill: vi.fn(),

    // Invoice
    createInvoice: vi.fn(),
    getInvoice: vi.fn(),
    updateInvoice: vi.fn(),

    // Expense / Purchase
    createPurchase: vi.fn(),
    getPurchase: vi.fn(),
    updatePurchase: vi.fn(),

    // Sales Receipt
    createSalesReceipt: vi.fn(),
    getSalesReceipt: vi.fn(),
    updateSalesReceipt: vi.fn(),

    // Deposit
    createDeposit: vi.fn(),
    getDeposit: vi.fn(),
    updateDeposit: vi.fn(),

    // Vendor Credit
    createVendorCredit: vi.fn(),
    getVendorCredit: vi.fn(),
    updateVendorCredit: vi.fn(),

    // Bill Payment
    createBillPayment: vi.fn(),
    getBillPayment: vi.fn(),

    // Customer
    createCustomer: vi.fn(),
    getCustomer: vi.fn(),
    updateCustomer: vi.fn(),

    // Class
    createClass: vi.fn(),
    getClass: vi.fn(),
    updateClass: vi.fn(),

    // Attachable
    createAttachable: vi.fn(),
    getAttachable: vi.fn(),
    updateAttachable: vi.fn(),
    deleteAttachable: vi.fn(),
    upload: vi.fn(),

    // Delete
    deleteJournalEntry: vi.fn(),
    deleteBill: vi.fn(),
    deleteInvoice: vi.fn(),
    deleteDeposit: vi.fn(),
    deleteSalesReceipt: vi.fn(),
    deletePurchase: vi.fn(),
    deleteBillPayment: vi.fn(),
    deleteVendorCredit: vi.fn(),

    // Terms
    findTerms: vi.fn(),

    // Finders (used by query tool and cache)
    findAccounts: vi.fn(),
    findDepartments: vi.fn(),
    findVendors: vi.fn(),
    findCustomers: vi.fn(),
    findItems: vi.fn(),
    findInvoices: vi.fn(),
    findBills: vi.fn(),
    findPurchases: vi.fn(),
    findJournalEntries: vi.fn(),
    findDeposits: vi.fn(),
    findSalesReceipts: vi.fn(),
    findPayments: vi.fn(),
    findClasses: vi.fn(),
    findAttachables: vi.fn(),

    // Reports
    reportProfitAndLoss: vi.fn(),
    reportBalanceSheet: vi.fn(),
    reportTrialBalance: vi.fn(),
    reportGeneralLedgerDetail: vi.fn(),

    // Company
    getCompanyInfo: vi.fn(),
  } as unknown as Record<string, ReturnType<typeof vi.fn>>;
}

/**
 * Configure a mock method to succeed with given data (callback pattern).
 * Usage: mockSuccess(client.createJournalEntry, { Id: "123" })
 */
export function mockSuccess(method: ReturnType<typeof vi.fn>, data: unknown) {
  method.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, result: unknown) => void;
    cb(null, data);
  });
}

/**
 * Configure a mock method to fail with given error message (callback pattern).
 * Usage: mockError(client.createJournalEntry, "Duplicate DocNumber")
 */
export function mockError(method: ReturnType<typeof vi.fn>, message: string) {
  method.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, result: unknown) => void;
    cb(new Error(message), null);
  });
}

/**
 * Reset all methods on a mock client. Use in beforeEach.
 */
export function resetMockClient(client: Record<string, ReturnType<typeof vi.fn>>) {
  for (const method of Object.values(client)) {
    if (typeof method?.mockReset === "function") {
      method.mockReset();
    }
  }
}
