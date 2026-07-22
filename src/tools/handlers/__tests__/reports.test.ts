import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockClient,
  mockSuccess,
  mockError,
  resetMockClient,
  mockPromisify,
} from "../../../__mocks__/mock-client.js";

vi.mock("../../../client/index.js", () => ({
    promisify: mockPromisify,
    resolveDepartmentId: vi.fn(),
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
  };
});

vi.mock("../../../reports/index.js", () => ({
  extractReportSummary: vi.fn((_result: unknown, reportType: string) => `${reportType} Summary`),
}));

import { handleGetProfitLoss, handleGetBalanceSheet, handleGetTrialBalance } from "../reports.js";
import { resolveDepartmentId } from "../../../client/index.js";
import { outputReport } from "../../../utils/index.js";

const mockResolveDepartmentId = vi.mocked(resolveDepartmentId);
const mockOutputReport = vi.mocked(outputReport);

describe("handleGetProfitLoss", () => {
  let client: ReturnType<typeof createMockClient>;

  const mockReportResult = { Header: { ReportName: "ProfitAndLoss" }, Rows: { Row: [] } };

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockResolveDepartmentId.mockResolvedValue("20");
    mockSuccess(client.reportProfitAndLoss, mockReportResult);
  });

  it("calls reportProfitAndLoss with date range options", async () => {
    await handleGetProfitLoss(client as never, {
      start_date: "2026-01-01",
      end_date: "2026-03-31",
    });

    const options = client.reportProfitAndLoss.mock.calls[0][0];
    expect(options.start_date).toBe("2026-01-01");
    expect(options.end_date).toBe("2026-03-31");
  });

  it("maps summarize_by to summarize_column_by", async () => {
    await handleGetProfitLoss(client as never, {
      summarize_by: "Month",
    });

    const options = client.reportProfitAndLoss.mock.calls[0][0];
    expect(options.summarize_column_by).toBe("Month");
    expect(options).not.toHaveProperty("summarize_by");
  });

  it("resolves department name to ID", async () => {
    await handleGetProfitLoss(client as never, {
      department: "Santa Rosa",
    });

    expect(mockResolveDepartmentId).toHaveBeenCalledWith(expect.anything(), "Santa Rosa");
    const options = client.reportProfitAndLoss.mock.calls[0][0];
    expect(options.department).toBe("20");
  });

  it("includes accounting_method", async () => {
    await handleGetProfitLoss(client as never, {
      accounting_method: "Cash",
    });

    const options = client.reportProfitAndLoss.mock.calls[0][0];
    expect(options.accounting_method).toBe("Cash");
  });

  it("calls outputReport with report data", async () => {
    await handleGetProfitLoss(client as never, {});

    expect(mockOutputReport).toHaveBeenCalledWith(
      "profit-loss",
      mockReportResult,
      "Profit and Loss Summary"
    );
  });

  it("propagates API errors", async () => {
    mockError(client.reportProfitAndLoss, "Report generation failed");

    await expect(
      handleGetProfitLoss(client as never, {})
    ).rejects.toThrow("Report generation failed");
  });
});

describe("handleGetBalanceSheet", () => {
  let client: ReturnType<typeof createMockClient>;

  const mockReportResult = { Header: { ReportName: "BalanceSheet" }, Rows: { Row: [] } };

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockResolveDepartmentId.mockResolvedValue("20");
    mockSuccess(client.reportBalanceSheet, mockReportResult);
  });

  it("forces start_date to 1970-01-01 when as_of_date provided", async () => {
    await handleGetBalanceSheet(client as never, {
      as_of_date: "2026-06-30",
    });

    const options = client.reportBalanceSheet.mock.calls[0][0];
    expect(options.start_date).toBe("1970-01-01");
    expect(options.end_date).toBe("2026-06-30");
  });

  it("includes all options", async () => {
    await handleGetBalanceSheet(client as never, {
      as_of_date: "2026-12-31",
      summarize_by: "Total",
      department: "Main Office",
      accounting_method: "Accrual",
    });

    expect(mockResolveDepartmentId).toHaveBeenCalledWith(expect.anything(), "Main Office");
    const options = client.reportBalanceSheet.mock.calls[0][0];
    expect(options.summarize_column_by).toBe("Total");
    expect(options.accounting_method).toBe("Accrual");
    expect(options.department).toBe("20");
  });

  it("propagates API errors", async () => {
    mockError(client.reportBalanceSheet, "Timeout");

    await expect(
      handleGetBalanceSheet(client as never, {})
    ).rejects.toThrow("Timeout");
  });
});

describe("handleGetTrialBalance", () => {
  let client: ReturnType<typeof createMockClient>;

  const mockReportResult = { Header: { ReportName: "TrialBalance" }, Rows: { Row: [] } };

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockSuccess(client.reportTrialBalance, mockReportResult);
  });

  it("passes date range and accounting method", async () => {
    await handleGetTrialBalance(client as never, {
      start_date: "2026-01-01",
      end_date: "2026-06-30",
      accounting_method: "Cash",
    });

    const options = client.reportTrialBalance.mock.calls[0][0];
    expect(options.start_date).toBe("2026-01-01");
    expect(options.end_date).toBe("2026-06-30");
    expect(options.accounting_method).toBe("Cash");
  });

  it("omits undefined options from payload", async () => {
    await handleGetTrialBalance(client as never, {});

    const options = client.reportTrialBalance.mock.calls[0][0];
    expect(Object.keys(options)).toHaveLength(0);
  });

  it("propagates API errors", async () => {
    mockError(client.reportTrialBalance, "Service unavailable");

    await expect(
      handleGetTrialBalance(client as never, {})
    ).rejects.toThrow("Service unavailable");
  });
});
