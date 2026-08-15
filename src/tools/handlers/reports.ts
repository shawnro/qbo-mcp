// Handlers for report tools (profit_loss, balance_sheet, trial_balance)

import QuickBooks from "node-quickbooks";
import { promisify, resolveDepartmentId } from "../../client/index.js";
import { isHttpMode, outputReport } from "../../utils/index.js";
import { extractReportSummary, projectReportForHttp } from "../../reports/index.js";
import { QBReport } from "../../types/index.js";
import type { QboRequestContext } from "../../runtime/types.js";

function outputFinancialReport(
  reportType: string,
  result: QBReport,
  summary: string,
  context?: QboRequestContext
): { content: Array<{ type: string; text: string }> } {
  if (!isHttpMode(context?.output)) {
    return outputReport(reportType, result, summary, context?.output);
  }

  const projection = projectReportForHttp(result);
  const outputSummary = projection.truncated
    ? `${summary}\nHTTP mode detail capped at ${projection.includedDetailRows} of ${projection.totalDetailRows} report rows; totals and section summaries are preserved. Use a smaller date range or fewer summary columns for more detail.`
    : summary;
  return outputReport(reportType, projection.data, outputSummary, context?.output);
}

export async function handleGetProfitLoss(
  client: QuickBooks,
  args: {
    start_date?: string;
    end_date?: string;
    summarize_by?: string;
    department?: string;
    accounting_method?: string;
  },
  context?: QboRequestContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { start_date, end_date, summarize_by, department, accounting_method } = args;

  const options: Record<string, string> = {};
  if (start_date) options.start_date = start_date;
  if (end_date) options.end_date = end_date;
  if (summarize_by) options.summarize_column_by = summarize_by;
  if (department) {
    options.department = await resolveDepartmentId(client, department, context?.runtime.lookupCache);
  }
  if (accounting_method) options.accounting_method = accounting_method;

  const result = await promisify<unknown>((cb) =>
    client.reportProfitAndLoss(options, cb)
  ) as QBReport;

  const summary = extractReportSummary(result, "Profit and Loss");
  return outputFinancialReport("profit-loss", result, summary, context);
}

export async function handleGetBalanceSheet(
  client: QuickBooks,
  args: {
    as_of_date?: string;
    summarize_by?: string;
    department?: string;
    accounting_method?: string;
  },
  context?: QboRequestContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { as_of_date, summarize_by, department, accounting_method } = args;

  const options: Record<string, string> = {};
  if (as_of_date) {
    // Balance sheet needs both start_date and end_date
    // Set start_date to beginning of time for point-in-time report
    options.start_date = "1970-01-01";
    options.end_date = as_of_date;
  }
  if (summarize_by) options.summarize_column_by = summarize_by;
  if (department) {
    options.department = await resolveDepartmentId(client, department, context?.runtime.lookupCache);
  }
  if (accounting_method) options.accounting_method = accounting_method;

  const result = await promisify<unknown>((cb) =>
    client.reportBalanceSheet(options, cb)
  ) as QBReport;

  const summary = extractReportSummary(result, "Balance Sheet");
  return outputFinancialReport("balance-sheet", result, summary, context);
}

export async function handleGetTrialBalance(
  client: QuickBooks,
  args: {
    start_date?: string;
    end_date?: string;
    accounting_method?: string;
  },
  context?: QboRequestContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { start_date, end_date, accounting_method } = args;

  const options: Record<string, string> = {};
  if (start_date) options.start_date = start_date;
  if (end_date) options.end_date = end_date;
  if (accounting_method) options.accounting_method = accounting_method;

  const result = await promisify<unknown>((cb) =>
    client.reportTrialBalance(options, cb)
  ) as QBReport;

  const summary = extractReportSummary(result, "Trial Balance");
  return outputFinancialReport("trial-balance", result, summary, context);
}
