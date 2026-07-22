// Tests for delete entity handler

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockClient,
  mockSuccess,
  mockError,
  resetMockClient,
  mockPromisify,
} from "../../../__mocks__/mock-client.js";

// Mock client barrel (delete handler only imports promisify)
vi.mock("../../../client/index.js", () => ({
    promisify: mockPromisify,
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
  return { ...actual };
});

import { handleDeleteEntity } from "../delete.js";

const client = createMockClient();

beforeEach(() => {
  resetMockClient(client);
  vi.clearAllMocks();
});

describe("handleDeleteEntity", () => {
  describe("validation", () => {
    it("throws on invalid entity_type", async () => {
      await expect(
        handleDeleteEntity(client as never, { entity_type: "widget", id: "1" })
      ).rejects.toThrow('Invalid entity_type "widget"');
    });

    it("error message includes valid types", async () => {
      await expect(
        handleDeleteEntity(client as never, { entity_type: "bad", id: "1" })
      ).rejects.toThrow("journal_entry");
    });
  });

  describe("preview mode (confirm=false)", () => {
    it("fetches entity and returns summary for journal_entry", async () => {
      mockSuccess(client.getJournalEntry, {
        Id: "42",
        TxnDate: "2024-06-15",
        DocNumber: "JE-100",
        TotalAmt: 500.0,
        PrivateNote: "Test memo",
      });

      const result = await handleDeleteEntity(client as never, {
        entity_type: "journal_entry",
        id: "42",
      });

      expect(result.content[0].text).toContain("Journal Entry #42");
      expect(result.content[0].text).toContain("2024-06-15");
      expect(result.content[0].text).toContain("JE-100");
      expect(result.content[0].text).toContain("$500.00");
      expect(result.content[0].text).toContain("Test memo");
      expect(result.content[0].text).toContain("confirm=true to delete");
    });

    it("fetches entity using correct getMethod per type", async () => {
      mockSuccess(client.getBill, {
        Id: "10",
        TxnDate: "2024-01-01",
        VendorRef: { name: "Acme Corp" },
        TotalAmt: 250.0,
      });

      await handleDeleteEntity(client as never, {
        entity_type: "bill",
        id: "10",
      });

      expect(client.getBill).toHaveBeenCalledOnce();
      expect(client.deleteBill).not.toHaveBeenCalled();
    });

    it("shows expense summary with payee and payment type", async () => {
      mockSuccess(client.getPurchase, {
        Id: "5",
        TxnDate: "2024-03-20",
        EntityRef: { name: "Office Depot" },
        PaymentType: "CreditCard",
        TotalAmt: 89.99,
      });

      const result = await handleDeleteEntity(client as never, {
        entity_type: "expense",
        id: "5",
      });

      expect(result.content[0].text).toContain("Office Depot");
      expect(result.content[0].text).toContain("CreditCard");
      expect(result.content[0].text).toContain("$89.99");
    });

    it("handles entity with minimal fields gracefully", async () => {
      mockSuccess(client.getDeposit, {
        Id: "7",
        TxnDate: "2024-02-01",
        TotalAmt: 1000.0,
      });

      const result = await handleDeleteEntity(client as never, {
        entity_type: "deposit",
        id: "7",
      });

      expect(result.content[0].text).toContain("Deposit #7");
      expect(result.content[0].text).toContain("(unknown account)");
    });

    it("never calls deleteMethod when confirm is false", async () => {
      mockSuccess(client.getInvoice, {
        Id: "3",
        TxnDate: "2024-01-01",
        CustomerRef: { name: "Client A" },
        TotalAmt: 100.0,
      });

      await handleDeleteEntity(client as never, {
        entity_type: "invoice",
        id: "3",
        confirm: false,
      });

      expect(client.deleteInvoice).not.toHaveBeenCalled();
    });
  });

  describe("delete mode (confirm=true)", () => {
    it("calls deleteMethod with correct Id", async () => {
      mockSuccess(client.deleteJournalEntry, {});

      const result = await handleDeleteEntity(client as never, {
        entity_type: "journal_entry",
        id: "42",
        confirm: true,
      });

      expect(client.deleteJournalEntry).toHaveBeenCalledOnce();
      // Verify the Id argument shape
      const callArgs = client.deleteJournalEntry.mock.calls[0];
      expect(callArgs[0]).toEqual({ Id: "42" });
      expect(result.content[0].text).toBe("Deleted Journal Entry #42.");
    });

    it("calls correct deleteMethod for bill_payment", async () => {
      mockSuccess(client.deleteBillPayment, {});

      await handleDeleteEntity(client as never, {
        entity_type: "bill_payment",
        id: "99",
        confirm: true,
      });

      expect(client.deleteBillPayment).toHaveBeenCalledOnce();
      expect(client.deleteBillPayment.mock.calls[0][0]).toEqual({ Id: "99" });
    });

    it("does not call getMethod when confirming", async () => {
      mockSuccess(client.deleteVendorCredit, {});

      await handleDeleteEntity(client as never, {
        entity_type: "vendor_credit",
        id: "15",
        confirm: true,
      });

      expect(client.getVendorCredit).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("propagates API error on get", async () => {
      mockError(client.getBill, "Object Not Found");

      await expect(
        handleDeleteEntity(client as never, { entity_type: "bill", id: "999" })
      ).rejects.toThrow("Object Not Found");
    });

    it("propagates API error on delete", async () => {
      mockError(client.deleteSalesReceipt, "Permission denied");

      await expect(
        handleDeleteEntity(client as never, {
          entity_type: "sales_receipt",
          id: "5",
          confirm: true,
        })
      ).rejects.toThrow("Permission denied");
    });
  });
});
