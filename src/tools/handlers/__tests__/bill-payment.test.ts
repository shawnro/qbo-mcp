import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockClient,
  mockSuccess,
  mockError,
  resetMockClient,
  mockPromisify,
} from "../../../__mocks__/mock-client.js";
import {
  createMockAccountCache,
  createMockVendorCache,
} from "../../../__mocks__/mock-cache.js";

vi.mock("../../../client/index.js", () => ({
    promisify: mockPromisify,
    getAccountCache: vi.fn(),
    getVendorCache: vi.fn(),
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
    outputReport: vi.fn((_type: string, _data: unknown, summary: string) => ({
      content: [{ type: "text", text: summary }],
    })),
    getQboUrl: vi.fn((_entity: string, id: string) => `https://app.qbo.intuit.com/app/billpayment?txnId=${id}`),
  };
});

import { handleCreateBillPayment, handleGetBillPayment } from "../bill-payment.js";
import { getAccountCache, getVendorCache } from "../../../client/index.js";

const mockGetAccountCache = vi.mocked(getAccountCache);
const mockGetVendorCache = vi.mocked(getVendorCache);

describe("handleCreateBillPayment", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockGetAccountCache.mockResolvedValue(createMockAccountCache() as never);
    mockGetVendorCache.mockResolvedValue(createMockVendorCache() as never);
  });

  it("returns preview in draft mode", async () => {
    // Mock getBill to return bill details for validation
    mockSuccess(client.getBill, {
      Id: "500",
      Balance: 150,
      VendorRef: { value: "100", name: "Office Depot" },
      DocNumber: "B-001",
      TxnDate: "2026-03-01",
      TotalAmt: 150,
    });

    const result = await handleCreateBillPayment(client as never, {
      vendor_name: "Office Depot",
      payment_account: "Cash",
      txn_date: "2026-04-01",
      bills: [{ bill_id: "500" }],
    });

    expect(result.content[0].text).toContain("DRAFT");
    expect(result.content[0].text).toContain("Office Depot");
    expect(client.createBillPayment).not.toHaveBeenCalled();
  });

  it("creates bill payment with one bill", async () => {
    mockSuccess(client.getBill, {
      Id: "500",
      Balance: 150,
      VendorRef: { value: "100", name: "Office Depot" },
      TotalAmt: 150,
    });
    mockSuccess(client.createBillPayment, { Id: "900", DocNumber: "PAY-001" });

    const result = await handleCreateBillPayment(client as never, {
      vendor_name: "Office Depot",
      payment_account: "Cash",
      txn_date: "2026-04-01",
      draft: false,
      bills: [{ bill_id: "500" }],
    });

    expect(result.content[0].text).toContain("Bill Payment Created");
    expect(client.createBillPayment).toHaveBeenCalledOnce();
  });

  it("creates with bill + vendor credit", async () => {
    mockSuccess(client.getBill, {
      Id: "500",
      Balance: 150,
      VendorRef: { value: "100", name: "Office Depot" },
      TotalAmt: 150,
    });
    mockSuccess(client.getVendorCredit, {
      Id: "50",
      Balance: 30,
      VendorRef: { value: "100", name: "Office Depot" },
      TotalAmt: 30,
    });
    mockSuccess(client.createBillPayment, { Id: "901" });

    await handleCreateBillPayment(client as never, {
      vendor_name: "Office Depot",
      payment_account: "Cash",
      txn_date: "2026-04-01",
      draft: false,
      bills: [{ bill_id: "500", amount: 150 }],
      credits: [{ vendor_credit_id: "50", amount: 30 }],
    });

    const payload = client.createBillPayment.mock.calls[0][0];
    // Should have bill line and credit line
    expect(payload.Line.length).toBeGreaterThanOrEqual(2);
  });

  it("builds LinkedTxn structure in payload", async () => {
    mockSuccess(client.getBill, {
      Id: "500",
      Balance: 100,
      VendorRef: { value: "100", name: "Office Depot" },
      TotalAmt: 100,
    });
    mockSuccess(client.createBillPayment, { Id: "902" });

    await handleCreateBillPayment(client as never, {
      vendor_name: "Office Depot",
      payment_account: "Cash",
      txn_date: "2026-04-01",
      draft: false,
      bills: [{ bill_id: "500", amount: 100 }],
    });

    const payload = client.createBillPayment.mock.calls[0][0];
    const billLine = payload.Line.find((l: Record<string, unknown>) =>
      Array.isArray(l.LinkedTxn) && (l.LinkedTxn as Array<Record<string, unknown>>).some((lt) => lt.TxnType === "Bill")
    );
    expect(billLine).toBeDefined();
    expect(billLine.LinkedTxn[0].TxnId).toBe("500");
    expect(billLine.LinkedTxn[0].TxnType).toBe("Bill");
  });

  it("resolves vendor and bank account", async () => {
    mockSuccess(client.getBill, {
      Id: "500",
      Balance: 50,
      VendorRef: { value: "100", name: "Office Depot" },
      TotalAmt: 50,
    });
    mockSuccess(client.createBillPayment, { Id: "903" });

    await handleCreateBillPayment(client as never, {
      vendor_name: "Office Depot",
      payment_account: "Cash",
      txn_date: "2026-04-01",
      draft: false,
      bills: [{ bill_id: "500" }],
    });

    const payload = client.createBillPayment.mock.calls[0][0];
    expect(payload.VendorRef).toEqual({ value: "100", name: "Office Depot" });
    expect(payload.CheckPayment.BankAccountRef).toEqual({ value: "1", name: "Cash" });
  });

  it("throws when vendor not found", async () => {
    await expect(
      handleCreateBillPayment(client as never, {
        vendor_name: "Unknown",
        payment_account: "Cash",
        txn_date: "2026-04-01",
        bills: [{ bill_id: "500" }],
      })
    ).rejects.toThrow("not found");
  });

  it("throws when no bills provided", async () => {
    await expect(
      handleCreateBillPayment(client as never, {
        vendor_name: "Office Depot",
        payment_account: "Cash",
        txn_date: "2026-04-01",
        bills: [],
      })
    ).rejects.toThrow("At least one bill");
  });

  it("throws when bill amount exceeds balance", async () => {
    mockSuccess(client.getBill, {
      Id: "500",
      Balance: 50,
      VendorRef: { value: "100", name: "Office Depot" },
      TotalAmt: 100,
    });

    await expect(
      handleCreateBillPayment(client as never, {
        vendor_name: "Office Depot",
        payment_account: "Cash",
        txn_date: "2026-04-01",
        bills: [{ bill_id: "500", amount: 100 }],
      })
    ).rejects.toThrow(/balance|exceed/i);
  });

  it("propagates API errors on create", async () => {
    mockSuccess(client.getBill, {
      Id: "500",
      Balance: 50,
      VendorRef: { value: "100", name: "Office Depot" },
      TotalAmt: 50,
    });
    mockError(client.createBillPayment, "Server Error");

    await expect(
      handleCreateBillPayment(client as never, {
        vendor_name: "Office Depot",
        payment_account: "Cash",
        txn_date: "2026-04-01",
        draft: false,
        bills: [{ bill_id: "500" }],
      })
    ).rejects.toThrow("Server Error");
  });
});

describe("handleGetBillPayment", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns formatted bill payment", async () => {
    mockSuccess(client.getBillPayment, {
      Id: "900",
      SyncToken: "0",
      TxnDate: "2026-04-01",
      VendorRef: { value: "100", name: "Office Depot" },
      TotalAmt: 150,
      PayType: "Check",
      CheckPayment: { BankAccountRef: { value: "1", name: "Cash" } },
      Line: [
        { Amount: 150, LinkedTxn: [{ TxnId: "500", TxnType: "Bill" }] },
      ],
    });

    const result = await handleGetBillPayment(client as never, { id: "900" });
    expect(result.content[0].text).toContain("Office Depot");
    expect(result.content[0].text).toContain("$150.00");
  });

  it("propagates API errors", async () => {
    mockError(client.getBillPayment, "Not Found");
    await expect(handleGetBillPayment(client as never, { id: "999" })).rejects.toThrow("Not Found");
  });
});
