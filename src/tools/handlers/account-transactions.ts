// Authoritative account posting detail from the QuickBooks General Ledger report

import QuickBooks from "node-quickbooks";
import {
  getDepartmentCache,
  promisify,
  resolveAccount,
} from "../../client/index.js";
import {
  normalizeAccountingMethod,
  normalizeGeneralLedgerReport,
  projectAccountPostings,
  projectLedgerSummary,
  resolveReportDateRange,
  validateLedgerAccountType,
  type GeneralLedgerReport,
} from "../../reports/index.js";
import { isHttpMode, outputReport } from "../../utils/index.js";
import { createResolutionCoordinator } from "../resolve.js";
import type { QboRequestContext } from "../../runtime/types.js";

const HTTP_POSTING_LIMIT = 100;
const LARGE_REPORT_WARNING = 1000;

export async function handleQueryAccountTransactions(
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

  // Do not catch report failures here. Auth failures must reach the dispatcher
  // for its one controlled refresh/retry; all other failures must be visible
  // rather than becoming a misleading successful empty account history.
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

  const allPostings = projectAccountPostings(ledger, accountType);
  const ledgerSummary = projectLedgerSummary(ledger, accountType);
  const netChange = ledgerSummary.totalDebits - ledgerSummary.totalCredits;
  const truncated = isHttpMode(context?.output) && allPostings.length > HTTP_POSTING_LIMIT;
  const outputPostings = truncated
    ? allPostings.slice(0, HTTP_POSTING_LIMIT)
    : allPostings;
  const unlinkedPostingCount = allPostings.filter(posting => !posting.qboLink).length;

  const postingData = outputPostings.map(posting => ({
    date: posting.date,
    transactionType: posting.transactionType,
    transactionId: posting.transactionId,
    sourceEntityType: posting.sourceEntityType,
    docNumber: posting.docNumber,
    name: posting.name,
    nameId: posting.nameId,
    memo: posting.memo,
    splitAccount: posting.splitAccount === "-Split-" ? undefined : posting.splitAccount,
    splitAccountId: posting.splitAccount === "-Split-" ? undefined : posting.splitAccountId,
    hasMultipleSplits: posting.splitAccount === "-Split-",
    postingType: posting.postingType,
    amount: posting.amount,
    rawReportAmount: posting.rawAmount,
    runningBalance: posting.runningBalance,
    qboLink: posting.qboLink,
  }));

  const reportData = {
    account: {
      id: resolvedAccount.Id,
      acctNum: resolvedAccount.AcctNum,
      name: resolvedAccount.FullyQualifiedName || resolvedAccount.Name,
      type: accountType,
      currentBalance: resolvedAccount.CurrentBalance,
    },
    dateRange: { start: startDate, end: endDate },
    department: resolvedDepartmentId ? {
      id: resolvedDepartmentId,
      name: resolvedDepartmentName,
    } : undefined,
    accountingMethod,
    report: {
      source: "QuickBooks GeneralLedgerDetail",
      basis: ledger.reportBasis || accountingMethod,
      currency: ledger.currency,
      returnedPostingCount: allPostings.length,
      unlinkedPostingCount,
      rowLimitKnown: false,
    },
    summary: {
      transactionCount: ledgerSummary.transactionCount,
      postingCount: ledgerSummary.postingCount,
      totalDebits: ledgerSummary.totalDebits,
      totalCredits: ledgerSummary.totalCredits,
      netChange,
      balanceChange: ledgerSummary.netActivity,
      openingBalance: ledgerSummary.openingBalance,
      closingBalance: ledgerSummary.closingBalance,
    },
    postings: postingData,
    ...(truncated ? {
      detailTruncatedAt: HTTP_POSTING_LIMIT,
      totalPostings: allPostings.length,
    } : {}),
  };

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
    "Account General Ledger Postings",
    "===============================",
    `Account: ${accountLabel} (${accountType})`,
    `Period: ${startDate} to ${endDate}`,
    `Basis: ${accountingMethod}`,
  ];
  if (resolvedDepartmentName) summaryLines.push(`Department: ${resolvedDepartmentName}`);
  summaryLines.push(
    "",
    `Summary: ${ledgerSummary.transactionCount} transactions / ${ledgerSummary.postingCount} postings`,
    `Debits: ${formatCurrency(ledgerSummary.totalDebits)} | Credits: ${formatCurrency(ledgerSummary.totalCredits)} | Net debit change: ${formatCurrency(netChange)}`,
    `Opening balance: ${formatCurrency(ledgerSummary.openingBalance)} | Closing balance: ${formatCurrency(ledgerSummary.closingBalance)} | Balance change: ${formatCurrency(ledgerSummary.netActivity)}`
  );

  if (truncated) {
    summaryLines.push(
      `Detail capped at ${HTTP_POSTING_LIMIT} of ${allPostings.length} postings in HTTP mode; summary uses all returned GL rows.`
    );
  }
  if (allPostings.length >= LARGE_REPORT_WARNING) {
    summaryLines.push(
      `Warning: QBO returned ${allPostings.length} postings. QBO does not publish report pagination or a total-row/truncation indicator; use a narrower date range for high-volume accounts.`
    );
  }
  if (unlinkedPostingCount > 0) {
    summaryLines.push(
      `${unlinkedPostingCount} posting(s) use QBO report transaction labels without a known direct-link mapping; transaction IDs remain included when QBO supplied them.`
    );
  }

  if (outputPostings.length > 0) {
    summaryLines.push("", "First postings:");
    for (const posting of outputPostings.slice(0, 10)) {
      const docNumber = posting.docNumber ? ` #${posting.docNumber}` : "";
      const name = posting.name ? ` — ${posting.name}` : "";
      const split = posting.splitAccount
        ? ` [split: ${posting.splitAccount}]`
        : "";
      summaryLines.push(
        `  ${posting.date} ${posting.transactionType}${docNumber}${name}: ` +
        `${posting.postingType} ${formatCurrency(Math.abs(posting.amount))}${split}`
      );
    }
  }

  return outputReport("account-transactions", reportData, summaryLines.join("\n"), context?.output);
}
