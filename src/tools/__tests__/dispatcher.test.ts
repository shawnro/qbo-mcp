// Tests for tool dispatcher (auth retry logic)

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the client module
const mockGetClient = vi.fn();
const mockClearCredentialsCache = vi.fn();
const mockRefreshTokens = vi.fn();
const mockIsAuthError = vi.fn();

vi.mock("../../client/index.js", () => ({
  getClient: (...args: unknown[]) => mockGetClient(...args),
  clearCredentialsCache: (...args: unknown[]) => mockClearCredentialsCache(...args),
  refreshTokens: (...args: unknown[]) => mockRefreshTokens(...args),
  isAuthError: (...args: unknown[]) => mockIsAuthError(...args),
}));

// Mock handlers module
const mockHandler = vi.fn();
vi.mock("../../tools/handlers/index.js", () => ({
  handleAuthenticate: vi.fn(),
  handleListProfiles: vi.fn(),
  handleSwitchProfile: vi.fn(),
  handleGetCompanyInfo: vi.fn(),
  handleQuery: vi.fn(),
  handleListAccounts: vi.fn(),
  handleGetProfitLoss: vi.fn(),
  handleGetBalanceSheet: vi.fn(),
  handleGetTrialBalance: vi.fn(),
  handleQueryAccountTransactions: vi.fn(),
  handleAccountPeriodSummary: vi.fn(),
  handleCreateJournalEntry: vi.fn(),
  handleGetJournalEntry: vi.fn(),
  handleEditJournalEntry: vi.fn(),
  handleCreateBill: vi.fn(),
  handleGetBill: vi.fn(),
  handleEditBill: vi.fn(),
  handleCreateExpense: vi.fn(),
  handleGetExpense: vi.fn(),
  handleEditExpense: vi.fn(),
  handleCreateSalesReceipt: vi.fn(),
  handleGetSalesReceipt: vi.fn(),
  handleEditSalesReceipt: vi.fn(),
  handleCreateInvoice: vi.fn(),
  handleGetInvoice: vi.fn(),
  handleEditInvoice: vi.fn(),
  handleCreateDeposit: vi.fn(),
  handleGetDeposit: vi.fn(),
  handleEditDeposit: vi.fn(),
  handleCreateVendorCredit: vi.fn(),
  handleGetVendorCredit: vi.fn(),
  handleEditVendorCredit: vi.fn(),
  handleCreateBillPayment: vi.fn(),
  handleGetBillPayment: vi.fn(),
  handleCreateCustomer: vi.fn(),
  handleGetCustomer: vi.fn(),
  handleEditCustomer: vi.fn(),
  handleDeleteEntity: vi.fn(),
}));

import { executeTool } from "../index.js";
import {
  handleGetCompanyInfo,
} from "../handlers/index.js";

const mockHandleGetCompanyInfo = vi.mocked(handleGetCompanyInfo);

describe("executeTool", () => {
  const fakeClient = {} as never;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.QBO_DISABLE_UPDATE;
    mockGetClient.mockResolvedValue(fakeClient);
    mockIsAuthError.mockReturnValue(false);
    mockHandleGetCompanyInfo.mockResolvedValue({
      content: [{ type: "text", text: "Company Info" }],
    });
  });

  it("executes handler successfully on first try", async () => {
    const result = await executeTool("get_company_info", {});

    expect(result.content[0].text).toBe("Company Info");
    expect(mockGetClient).toHaveBeenCalledOnce();
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it("does not retry on non-auth errors", async () => {
    mockHandleGetCompanyInfo.mockRejectedValue(new Error("Network timeout"));

    const result = await executeTool("get_company_info", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: Network timeout");
    expect(mockRefreshTokens).not.toHaveBeenCalled();
    // Handler was only called once (no retry)
    expect(mockHandleGetCompanyInfo).toHaveBeenCalledOnce();
  });

  it("retries after refreshing token on auth error", async () => {
    // First call fails with auth error
    mockHandleGetCompanyInfo
      .mockRejectedValueOnce(new Error("AuthenticationFailed"))
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Success after retry" }],
      });
    mockIsAuthError.mockReturnValue(true);
    mockRefreshTokens.mockResolvedValue(undefined);

    const result = await executeTool("get_company_info", {});

    expect(result.content[0].text).toBe("Success after retry");
    expect(mockRefreshTokens).toHaveBeenCalledOnce();
    // getClient called twice (once for initial, once for retry)
    expect(mockGetClient).toHaveBeenCalledTimes(2);
  });

  it("clears credentials cache when refresh fails", async () => {
    mockHandleGetCompanyInfo
      .mockRejectedValueOnce(new Error("AuthenticationFailed"))
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Success after cache clear" }],
      });
    mockIsAuthError.mockReturnValue(true);
    mockRefreshTokens.mockRejectedValue(new Error("Refresh failed"));

    const result = await executeTool("get_company_info", {});

    expect(mockRefreshTokens).toHaveBeenCalledOnce();
    expect(mockClearCredentialsCache).toHaveBeenCalledOnce();
    // Retry still happens after cache clear
    expect(result.content[0].text).toBe("Success after cache clear");
  });

  it("returns error when retry also fails after auth error", async () => {
    mockHandleGetCompanyInfo
      .mockRejectedValueOnce(new Error("AuthenticationFailed"))
      .mockRejectedValueOnce({
        response: {
          status: 400,
          data: {
            Fault: {
              Error: [{
                Code: "2050",
                Message: "String length is invalid",
                Element: "DocNumber",
              }],
            },
          },
        },
      });
    mockIsAuthError.mockReturnValueOnce(true);
    mockRefreshTokens.mockResolvedValue(undefined);

    const result = await executeTool("get_company_info", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "Error after retry: QBO error 2050: String length is invalid (DocNumber)"
    );
    expect(mockHandleGetCompanyInfo).toHaveBeenCalledTimes(2);
  });

  it("throws on unknown tool name", async () => {
    await expect(executeTool("nonexistent_tool", {})).rejects.toThrow(
      "Unknown tool: nonexistent_tool"
    );
  });

  it("rejects deactivate tools when updates are disabled before handler lookup", async () => {
    process.env.QBO_DISABLE_UPDATE = "true";

    const result = await executeTool("deactivate_vendor", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("disabled by server configuration");
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it("formats direct QBO Fault details", async () => {
    mockHandleGetCompanyInfo.mockRejectedValue({
      Fault: {
        Error: [{
          Code: "2050",
          Message: "String length specified does not match supported length",
          Detail: "The supplied string is too long",
          Element: "DocNumber",
        }],
      },
    });

    const result = await executeTool("get_company_info", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      "Error: QBO error 2050: String length specified does not match supported length — " +
      "The supplied string is too long (DocNumber)"
    );
  });

  it("safely formats a QBO Fault nested in an Axios error", async () => {
    const axiosError = Object.assign(new Error("Request failed with status code 400"), {
      response: {
        status: 400,
        headers: { "set-cookie": "synthetic-cookie-secret" },
        data: {
          Fault: {
            Error: [{ Code: "6000", Message: "Business Validation Error" }],
          },
        },
      },
      config: {
        headers: { Authorization: "Bearer synthetic-access-token" },
      },
    });
    mockHandleGetCompanyInfo.mockRejectedValue(axiosError);

    const result = await executeTool("get_company_info", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: QBO error 6000: Business Validation Error");
    expect(result.content[0].text).not.toContain("synthetic-access-token");
    expect(result.content[0].text).not.toContain("synthetic-cookie-secret");
  });

  it("does not require client for qbo_authenticate", async () => {
    // Import the mock for handleAuthenticate
    const { handleAuthenticate } = await import("../handlers/index.js");
    const mockAuth = vi.mocked(handleAuthenticate);
    mockAuth.mockResolvedValue({
      content: [{ type: "text", text: "Auth instructions" }],
    });

    const result = await executeTool("qbo_authenticate", {});

    expect(result.content[0].text).toBe("Auth instructions");
    expect(mockGetClient).not.toHaveBeenCalled();
  });
});
