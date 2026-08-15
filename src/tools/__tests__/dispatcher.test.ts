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
  handleCreateVendor: vi.fn(),
  handleGetVendor: vi.fn(),
  handleEditVendor: vi.fn(),
  handleDeactivateVendor: vi.fn(),
  handleCreateCustomer: vi.fn(),
  handleGetCustomer: vi.fn(),
  handleEditCustomer: vi.fn(),
  handleCreateAttachable: vi.fn(),
  handleGetAttachable: vi.fn(),
  handleEditAttachable: vi.fn(),
  handleListTransactionAttachables: vi.fn(),
  handleReadAttachableContent: vi.fn(),
  handleDeleteEntity: vi.fn(),
}));

import { executeTool } from "../index.js";
import { QboOperationTimeoutError } from "../../client/promisify.js";
import type { QboRequestContext } from "../../runtime/types.js";
import {
  handleCreateAttachable,
  handleCreateVendor,
  handleGetCompanyInfo,
  handleGetTrialBalance,
  handleGetVendor,
  handleReadAttachableContent,
} from "../handlers/index.js";

const mockHandleCreateAttachable = vi.mocked(handleCreateAttachable);
const mockHandleCreateVendor = vi.mocked(handleCreateVendor);
const mockHandleGetCompanyInfo = vi.mocked(handleGetCompanyInfo);
const mockHandleGetTrialBalance = vi.mocked(handleGetTrialBalance);
const mockHandleGetVendor = vi.mocked(handleGetVendor);
const mockHandleReadAttachableContent = vi.mocked(handleReadAttachableContent);

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
    mockHandleGetVendor.mockResolvedValue({
      content: [{ type: "text", text: "Vendor Info" }],
    });
    mockHandleGetTrialBalance.mockResolvedValue({
      content: [{ type: "text", text: "Trial Balance" }],
    });
  });

  it("executes handler successfully on first try", async () => {
    const result = await executeTool("get_company_info", {});

    expect(result.content[0].text).toBe("Company Info");
    expect(mockGetClient).toHaveBeenCalledOnce();
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it("routes Vendor tools through the registry", async () => {
    const result = await executeTool("get_vendor", { id: "42" });

    expect(result.content[0].text).toBe("Vendor Info");
    expect(mockHandleGetVendor).toHaveBeenCalledWith(fakeClient, { id: "42" }, undefined);
  });

  it("forwards request context through report and Vendor mutation registrations", async () => {
    const context = {
      runtime: {
        createClientAttempt: vi.fn().mockResolvedValue({
          client: fakeClient,
          credentialFingerprint: "fingerprint",
        }),
      },
    } as unknown as QboRequestContext;
    mockHandleCreateVendor.mockResolvedValue({
      content: [{ type: "text", text: "Vendor draft" }],
    });

    await executeTool("get_trial_balance", {}, context);
    await executeTool("create_vendor", { display_name: "Acme" }, context);

    expect(mockHandleGetTrialBalance).toHaveBeenCalledWith(fakeClient, {}, context);
    expect(mockHandleCreateVendor).toHaveBeenCalledWith(
      fakeClient,
      { display_name: "Acme" },
      context
    );
  });

  it("does not auth-retry a partial Vendor creation result", async () => {
    mockHandleCreateVendor.mockResolvedValue({
      content: [{
        type: "text",
        text: "Vendor Acme (ID: 42) was created, but default terms could not be applied: HTTP 401: Unauthorized",
      }],
      isError: true,
    });

    const result = await executeTool("create_vendor", {
      display_name: "Acme",
      terms_ref: "Net 30",
      draft: false,
    });

    expect(result.isError).toBe(true);
    expect(mockHandleCreateVendor).toHaveBeenCalledOnce();
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it("does not auth-retry a partial Attachable upload result", async () => {
    mockHandleCreateAttachable.mockResolvedValue({
      content: [{
        type: "text",
        text: "File invoice.pdf was uploaded as Attachable 205, but linking failed: HTTP 401: Unauthorized",
      }],
      isError: true,
    });

    const result = await executeTool("create_attachable", {
      file_path: "C:\\Business\\invoice.pdf",
      entity_type: "Bill",
      entity_id: "77",
      draft: false,
    });

    expect(result.isError).toBe(true);
    expect(mockHandleCreateAttachable).toHaveBeenCalledOnce();
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it("routes non-text attachment content blocks unchanged", async () => {
    mockHandleReadAttachableContent.mockResolvedValue({
      content: [
        { type: "text", text: "receipt.png" },
        { type: "image", data: "cG5n", mimeType: "image/png" },
      ],
    });

    const result = await executeTool("read_attachable_content", { id: "200" });

    expect(result.content[1]).toEqual({ type: "image", data: "cG5n", mimeType: "image/png" });
    expect(mockHandleReadAttachableContent).toHaveBeenCalledWith(fakeClient, { id: "200" }, undefined);
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

  it("returns bounded retry guidance when a read exceeds its callback deadline", async () => {
    mockHandleGetCompanyInfo.mockRejectedValue(new QboOperationTimeoutError(25));

    const result = await executeTool("get_company_info", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'timeout: "get_company_info" exceeded the 25 ms QuickBooks callback deadline. Retry the read.'
    );
    expect(mockHandleGetCompanyInfo).toHaveBeenCalledOnce();
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it("returns safe retry guidance when a preview exceeds its callback deadline", async () => {
    mockHandleCreateVendor.mockRejectedValue(new QboOperationTimeoutError(25));

    const result = await executeTool("create_vendor", {
      display_name: "Acme",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'timeout: "create_vendor" exceeded the 25 ms QuickBooks callback deadline. ' +
      "Retry the preview; no committed write was requested."
    );
    expect(mockHandleCreateVendor).toHaveBeenCalledOnce();
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

  it("returns timeout guidance when a read deadline expires after auth refresh", async () => {
    mockHandleGetCompanyInfo
      .mockRejectedValueOnce(new Error("AuthenticationFailed"))
      .mockRejectedValueOnce(new QboOperationTimeoutError(25));
    mockIsAuthError.mockImplementation((error) =>
      error instanceof Error && error.message === "AuthenticationFailed"
    );
    mockRefreshTokens.mockResolvedValue(undefined);

    const result = await executeTool("get_company_info", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'timeout: "get_company_info" exceeded the 25 ms QuickBooks callback deadline. Retry the read.'
    );
    expect(mockHandleGetCompanyInfo).toHaveBeenCalledTimes(2);
  });

  it("stops when refresh fails instead of retrying with stale credentials", async () => {
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
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Authentication refresh failed: Refresh failed");
    expect(mockHandleGetCompanyInfo).toHaveBeenCalledOnce();
  });

  it("never replays a committed mutation after an auth failure", async () => {
    mockHandleCreateVendor.mockRejectedValue(new Error("AuthenticationFailed"));
    mockIsAuthError.mockReturnValue(true);
    mockRefreshTokens.mockResolvedValue(undefined);

    const result = await executeTool("create_vendor", {
      display_name: "Acme",
      draft: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("indeterminate_result");
    expect(mockRefreshTokens).toHaveBeenCalledOnce();
    expect(mockHandleCreateVendor).toHaveBeenCalledOnce();
  });

  it("never replays a committed attachment upload after an auth failure", async () => {
    mockHandleCreateAttachable.mockRejectedValue(new Error("AuthenticationFailed"));
    mockIsAuthError.mockReturnValue(true);
    mockRefreshTokens.mockResolvedValue(undefined);

    const result = await executeTool("create_attachable", {
      file_path: "C:\\receipts\\receipt.pdf",
      draft: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("indeterminate_result");
    expect(mockRefreshTokens).toHaveBeenCalledOnce();
    expect(mockHandleCreateAttachable).toHaveBeenCalledOnce();
  });

  it("marks an ambiguous committed timeout indeterminate without replay", async () => {
    mockHandleCreateVendor.mockRejectedValue(Object.assign(
      new Error("socket timed out"),
      { code: "ETIMEDOUT" }
    ));

    const result = await executeTool("create_vendor", {
      display_name: "Acme",
      draft: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("indeterminate_result");
    expect(result.content[0].text).toContain("ETIMEDOUT");
    expect(mockHandleCreateVendor).toHaveBeenCalledOnce();
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it("marks a callback-deadline committed result indeterminate without replay", async () => {
    mockHandleCreateVendor.mockRejectedValue(new QboOperationTimeoutError(25));

    const result = await executeTool("create_vendor", {
      display_name: "Acme",
      draft: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("indeterminate_result");
    expect(result.content[0].text).toContain("ETIMEDOUT");
    expect(mockHandleCreateVendor).toHaveBeenCalledOnce();
    expect(mockRefreshTokens).not.toHaveBeenCalled();
  });

  it("marks an HTTP 408 committed result indeterminate without replay", async () => {
    mockHandleCreateVendor.mockRejectedValue(Object.assign(
      new Error("Request Timeout"),
      { statusCode: 408 }
    ));

    const result = await executeTool("create_vendor", {
      display_name: "Acme",
      draft: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("indeterminate_result");
    expect(mockHandleCreateVendor).toHaveBeenCalledOnce();
  });

  it("returns ordinary committed validation failures without indeterminate wording", async () => {
    mockHandleCreateVendor.mockRejectedValue(new Error("Display name is required"));

    const result = await executeTool("create_vendor", {
      display_name: "",
      draft: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: Display name is required");
    expect(mockHandleCreateVendor).toHaveBeenCalledOnce();
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
