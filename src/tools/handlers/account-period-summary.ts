// General Ledger period summary with account-type-aware debit/credit semantics

import QuickBooks from "node-quickbooks";
import {
  getDepartmentCache,
  promisify,
  resolveAccount,
} from "../../client/index.js";
import {
  normalizeAccountingMethod,
  normalizeGeneralLedgerReport,
  projectLedgerSummary,
  resolveReportDateRange,
  validateLedgerAccountType,
  type GeneralLedgerReport,
} from "../../reports/index.js";
import { outputReport } from "../../utils/index.js";
import { createResolutionCoordinator } from "../resolve.js";
import type { QboRequestContext } from "../../runtime/types.js";

export async function handleAccountPeriodSummary(
  client: QuickBooks,
  args: {
    account: string;
    start_date?: string;
    end_date?: string;
    department?: string;
    accounting_method?: string;
  },
  context?: QboRequestContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const lookupCache = context?.runtime.lookupCache;
  const { account, start_date, end_date, department, accounting_method } = args;
  const resolvedAccount = await resolveAccount(client, account, lookupCache);
  const accountType = validateLedgerAccountType(resolvedAccount.AccountType);
  const { startDate, endDate } = resolveReportDateRange(start_date, end_date);
  const accountingMethod = normalizeAccountingMethod(accounting_method);

  let resolvedDepartmentId: string | undefined;
  let resolvedDepartmentName: string | undefined;
  if (department) {
    const departmentCache = await getDepartmentCache(client, {}, lookupCache);
    const resolver = createResolutionCoordinator(client, { department: departmentCache }, lookupCache);
    const ref = await resolver.department(department);
    resolvedDepartmentId = ref.value;
    resolvedDepartmentName = ref.name;
  }

  const options: Record<string, string> = {
    account: resolvedAccount.Id,
    start_date: startDate,
    end_date: endDate,
    accounting_method: accountingMethod,
  };
  if (resolvedDepartmentId) options.department = resolvedDepartmentId;

  const report = await promisify<unknown>((callback) =>
    client.reportGeneralLedgerDetail(options, callback)
  ) as GeneralLedgerReport;
  const ledger = normalizeGeneralLedgerReport(report);
  if (!ledger.reportBasis) {
    throw new Error("General Ledger report omitted ReportBasis required to verify accounting_method");
  }
  if (ledger.reportBasis.toLowerCase() !== accountingMethod.toLowerCase()) {
    throw new Error(
      `General Ledger returned ${ledger.reportBasis} basis after ${accountingMethod} was requested`
    );
  }
  const summary = projectLedgerSummary(ledger, accountType);

  const formatCurrency = (value: number): string => {
    const sign = value < 0 ? "-" : "";
    return `${sign}$${Math.abs(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };
  const accountLabel = resolvedAccount.AcctNum
    ? `${resolvedAccount.AcctNum} ${resolvedAccount.FullyQualifiedName || resolvedAccount.Name}`
    : resolvedAccount.FullyQualifiedName || resolvedAccount.Name;

  const summaryLines = [
    "Account Period Summary",
    "======================",
    `Account: ${accountLabel} (${accountType})`,
    `Period: ${startDate} to ${endDate}`,
    `Basis: ${accountingMethod}`,
  ];
  if (resolvedDepartmentName) summaryLines.push(`Department: ${resolvedDepartmentName}`);
  summaryLines.push(
    "",
    `Opening Balance:  ${formatCurrency(summary.openingBalance)}`,
    `Total Debits:     ${formatCurrency(summary.totalDebits)}`,
    `Total Credits:    ${formatCurrency(summary.totalCredits)}`,
    `Net Activity:     ${formatCurrency(summary.netActivity)}`,
    `Closing Balance:  ${formatCurrency(summary.closingBalance)}`,
    `Transactions:     ${summary.transactionCount}`,
    `Postings:         ${summary.postingCount}`
  );

  const reportData = {
    account: {
      id: resolvedAccount.Id,
      acctNum: resolvedAccount.AcctNum,
      name: resolvedAccount.FullyQualifiedName || resolvedAccount.Name,
      type: accountType,
    },
    dateRange: { start: startDate, end: endDate },
    department: resolvedDepartmentId ? {
      id: resolvedDepartmentId,
      name: resolvedDepartmentName,
    } : undefined,
    accountingMethod,
    summary,
  };

  return outputReport("account-period-summary", reportData, summaryLines.join("\n"), context?.output);
}
