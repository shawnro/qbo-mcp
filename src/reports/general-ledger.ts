import { getQboUrl } from "../utils/urls.js";

export interface GeneralLedgerCell {
  value?: string;
  id?: string;
}

export interface GeneralLedgerRow {
  type?: string;
  group?: string;
  ColData?: GeneralLedgerCell[];
  Header?: { ColData?: GeneralLedgerCell[] };
  Summary?: { ColData?: GeneralLedgerCell[] };
  Rows?: { Row?: GeneralLedgerRow[] };
}

export interface GeneralLedgerReport {
  Header?: {
    ReportName?: string;
    StartPeriod?: string;
    EndPeriod?: string;
    ReportBasis?: string;
    Currency?: string;
    Option?: Array<{ Name?: string; Value?: string }>;
  };
  Columns?: {
    Column?: Array<{
      ColTitle?: string;
      ColType?: string;
      MetaData?: Array<{ Name: string; Value: string }>;
    }>;
  };
  Rows?: { Row?: GeneralLedgerRow[] };
}

export interface NormalizedLedgerPosting {
  sectionKey: string;
  date: string;
  transactionType: string;
  transactionId?: string;
  docNumber?: string;
  name?: string;
  nameId?: string;
  memo?: string;
  splitAccount?: string;
  splitAccountId?: string;
  rawAmount: number;
  runningBalance?: number;
}

export interface NormalizedGeneralLedger {
  reportBasis?: string;
  startPeriod?: string;
  endPeriod?: string;
  currency?: string;
  openingBalances: Array<{ sectionKey: string; balance: number }>;
  postings: NormalizedLedgerPosting[];
  columnTitles: string[];
}

export type PostingType = "Debit" | "Credit" | "None";

export interface AccountPosting extends NormalizedLedgerPosting {
  sourceEntityType?: string;
  qboLink?: string;
  postingType: PostingType;
  amount: number;
}

export interface LedgerSummary {
  openingBalance: number;
  closingBalance: number;
  totalDebits: number;
  totalCredits: number;
  netActivity: number;
  transactionCount: number;
  postingCount: number;
}

const REQUIRED_COLUMNS = ["Date", "Transaction Type", "Amount", "Balance"] as const;

const DEBIT_NORMAL_ACCOUNT_TYPES = new Set([
  "Bank",
  "Accounts Receivable",
  "Other Current Asset",
  "Fixed Asset",
  "Other Asset",
  "Expense",
  "Other Expense",
  "Cost of Goods Sold",
]);

const CREDIT_NORMAL_ACCOUNT_TYPES = new Set([
  "Accounts Payable",
  "Credit Card",
  "Other Current Liability",
  "Long Term Liability",
  "Equity",
  "Income",
  "Other Income",
]);

const REPORT_TYPE_TO_ENTITY: Record<string, string> = {
  "journal entry": "journalentry",
  bill: "bill",
  "bill payment (check)": "billpayment",
  "bill payment (credit card)": "billpayment",
  invoice: "invoice",
  payment: "payment",
  "sales receipt": "salesreceipt",
  deposit: "deposit",
  expense: "purchase",
  check: "purchase",
  "cash expense": "purchase",
  "credit card expense": "purchase",
  "credit card credit": "purchase",
  "vendor credit": "vendorcredit",
};

function normalizedTitle(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseReportMoney(value: string | undefined, label: string): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;

  const parenthesized = text.startsWith("(") && text.endsWith(")");
  const normalized = text
    .replace(/[,$]/g, "")
    .replace(/^\((.*)\)$/, "$1")
    .trim();
  if (!normalized || normalized === "-") return undefined;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`General Ledger ${label} is not a valid amount: "${text}"`);
  }
  return parenthesized ? -Math.abs(parsed) : parsed;
}

function validateIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be in YYYY-MM-DD format`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`${label} is not a valid calendar date`);
  }
}

export function resolveReportDateRange(
  startDate?: string,
  endDate?: string
): { startDate: string; endDate: string } {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const start = startDate || `${now.getUTCFullYear()}-01-01`;
  const end = endDate || today;
  validateIsoDate(start, "start_date");
  validateIsoDate(end, "end_date");
  if (start > end) throw new Error("start_date must be on or before end_date");
  return { startDate: start, endDate: end };
}

export function normalizeAccountingMethod(value?: string): "Accrual" | "Cash" {
  if (value === undefined) return "Accrual";
  const normalized = value.trim().toLowerCase();
  if (normalized === "accrual") return "Accrual";
  if (normalized === "cash") return "Cash";
  throw new Error('accounting_method must be "Accrual" or "Cash"');
}

function accountNormalSide(accountType: string): "Debit" | "Credit" {
  if (DEBIT_NORMAL_ACCOUNT_TYPES.has(accountType)) return "Debit";
  if (CREDIT_NORMAL_ACCOUNT_TYPES.has(accountType)) return "Credit";
  throw new Error(
    `Unsupported QBO AccountType "${accountType}" for General Ledger debit/credit normalization`
  );
}

export function validateLedgerAccountType(accountType: string | undefined): string {
  if (!accountType) {
    throw new Error("QBO account is missing AccountType required for debit/credit normalization");
  }
  accountNormalSide(accountType);
  return accountType;
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function dollars(value: number): number {
  return value / 100;
}

export function normalizePostingAmount(
  rawAmount: number,
  accountType: string
): { amount: number; postingType: PostingType } {
  if (rawAmount === 0) return { amount: 0, postingType: "None" };
  const normalSide = accountNormalSide(accountType);
  const signedCents = normalSide === "Debit" ? cents(rawAmount) : -cents(rawAmount);
  return {
    amount: dollars(signedCents),
    postingType: signedCents > 0 ? "Debit" : "Credit",
  };
}

export function normalizeGeneralLedgerReport(report: GeneralLedgerReport): NormalizedGeneralLedger {
  const columns = report.Columns?.Column ?? [];
  const indexByTitle = new Map<string, number>();
  columns.forEach((column, index) => {
    const title = normalizedTitle(column.ColTitle);
    if (title && !indexByTitle.has(title)) indexByTitle.set(title, index);
  });

  for (const title of REQUIRED_COLUMNS) {
    if (!indexByTitle.has(title.toLowerCase())) {
      throw new Error(
        `General Ledger report is missing required column "${title}". ` +
        `Received: ${columns.map(column => column.ColTitle || "(untitled)").join(", ") || "none"}`
      );
    }
  }

  const dateIndex = indexByTitle.get("date")!;
  const typeIndex = indexByTitle.get("transaction type")!;
  const numIndex = indexByTitle.get("num");
  const nameIndex = indexByTitle.get("name");
  const memoIndex = indexByTitle.get("memo/description");
  const splitIndex = indexByTitle.get("split");
  const amountIndex = indexByTitle.get("amount")!;
  const balanceIndex = indexByTitle.get("balance")!;

  const openingBalances: Array<{ sectionKey: string; balance: number }> = [];
  const postings: NormalizedLedgerPosting[] = [];
  let sectionCounter = 0;

  const walk = (rows: GeneralLedgerRow[] | undefined, currentSection = "root"): void => {
    for (const row of rows ?? []) {
      if (row.type === "Section") {
        const sectionKey = `${currentSection}/${++sectionCounter}`;
        walk(row.Rows?.Row, sectionKey);
        continue;
      }

      if (row.type !== "Data" || !row.ColData) continue;
      const cells = row.ColData;
      const dateText = cells[dateIndex]?.value?.trim() ?? "";
      if (dateText === "Beginning Balance") {
        openingBalances.push({
          sectionKey: currentSection,
          balance: parseReportMoney(cells[balanceIndex]?.value, "beginning balance") ?? 0,
        });
        continue;
      }

      const transactionType = optionalText(cells[typeIndex]?.value);
      if (!transactionType) continue;
      if (!dateText) {
        throw new Error(`General Ledger transaction row "${transactionType}" omitted its Date value`);
      }
      validateIsoDate(dateText, "General Ledger transaction date");
      const rawAmount = parseReportMoney(cells[amountIndex]?.value, "amount");
      if (rawAmount === undefined) {
        throw new Error(
          `General Ledger transaction row "${transactionType}" omitted its Amount value`
        );
      }

      postings.push({
        sectionKey: currentSection,
        date: dateText,
        transactionType,
        transactionId: optionalText(cells[typeIndex]?.id),
        docNumber: numIndex === undefined ? undefined : optionalText(cells[numIndex]?.value),
        name: nameIndex === undefined ? undefined : optionalText(cells[nameIndex]?.value),
        nameId: nameIndex === undefined ? undefined : optionalText(cells[nameIndex]?.id),
        memo: memoIndex === undefined ? undefined : optionalText(cells[memoIndex]?.value),
        splitAccount: splitIndex === undefined ? undefined : optionalText(cells[splitIndex]?.value),
        splitAccountId: splitIndex === undefined ? undefined : optionalText(cells[splitIndex]?.id),
        rawAmount,
        runningBalance: parseReportMoney(cells[balanceIndex]?.value, "running balance"),
      });
    }
  };

  walk(report.Rows?.Row);

  return {
    reportBasis: report.Header?.ReportBasis,
    startPeriod: report.Header?.StartPeriod,
    endPeriod: report.Header?.EndPeriod,
    currency: report.Header?.Currency,
    openingBalances,
    postings,
    columnTitles: columns.map(column => column.ColTitle || ""),
  };
}

export function projectAccountPostings(
  ledger: NormalizedGeneralLedger,
  accountType: string
): AccountPosting[] {
  return ledger.postings.map(posting => {
    const normalized = normalizePostingAmount(posting.rawAmount, accountType);
    const sourceEntityType = REPORT_TYPE_TO_ENTITY[posting.transactionType.toLowerCase()];
    return {
      ...posting,
      ...normalized,
      sourceEntityType,
      qboLink: sourceEntityType && posting.transactionId
        ? getQboUrl(sourceEntityType, posting.transactionId) || undefined
        : undefined,
    };
  });
}

export function projectLedgerSummary(
  ledger: NormalizedGeneralLedger,
  accountType: string
): LedgerSummary {
  const postings = projectAccountPostings(ledger, accountType);
  const openingBySection = new Map<string, number>();
  for (const row of ledger.openingBalances) {
    openingBySection.set(row.sectionKey, (openingBySection.get(row.sectionKey) ?? 0) + cents(row.balance));
  }

  const closingBySection = new Map(openingBySection);
  for (const posting of ledger.postings) {
    if (posting.runningBalance !== undefined) {
      closingBySection.set(posting.sectionKey, cents(posting.runningBalance));
    }
  }

  const totalDebitsCents = postings
    .filter(posting => posting.amount > 0)
    .reduce((sum, posting) => sum + cents(posting.amount), 0);
  const totalCreditsCents = postings
    .filter(posting => posting.amount < 0)
    .reduce((sum, posting) => sum + Math.abs(cents(posting.amount)), 0);
  const rawActivityCents = ledger.postings.reduce(
    (sum, posting) => sum + cents(posting.rawAmount),
    0
  );
  const transactionKeys = new Set(
    postings.map((posting, index) => posting.transactionId
      ? `${posting.transactionType.toLowerCase()}:${posting.transactionId}`
      : `row:${index}`)
  );

  const openingBalanceCents = [...openingBySection.values()].reduce((sum, value) => sum + value, 0);
  const closingBalanceCents = [...closingBySection.values()].reduce((sum, value) => sum + value, 0);
  if (openingBalanceCents + rawActivityCents !== closingBalanceCents) {
    throw new Error(
      "General Ledger postings do not reconcile: opening balance plus activity does not equal closing balance"
    );
  }

  return {
    openingBalance: dollars(openingBalanceCents),
    closingBalance: dollars(closingBalanceCents),
    totalDebits: dollars(totalDebitsCents),
    totalCredits: dollars(totalCreditsCents),
    netActivity: dollars(rawActivityCents),
    transactionCount: transactionKeys.size,
    postingCount: postings.length,
  };
}
