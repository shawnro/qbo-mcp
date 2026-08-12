export type ToolEffect = "read" | "preview" | "committed-mutation";

const READ_TOOLS = new Set([
  "get_company_info",
  "query",
  "list_accounts",
  "get_profit_loss",
  "get_balance_sheet",
  "get_trial_balance",
  "query_account_transactions",
  "account_period_summary",
  "get_journal_entry",
  "get_bill",
  "get_expense",
  "get_sales_receipt",
  "get_invoice",
  "get_deposit",
  "get_vendor_credit",
  "get_bill_payment",
  "get_vendor",
  "get_customer",
  "get_class",
  "get_attachable",
  "list_transaction_attachables",
  "read_attachable_content",
]);

const DRAFT_MUTATIONS = new Set([
  "create_journal_entry",
  "edit_journal_entry",
  "create_bill",
  "edit_bill",
  "create_expense",
  "edit_expense",
  "create_sales_receipt",
  "edit_sales_receipt",
  "create_invoice",
  "edit_invoice",
  "create_deposit",
  "edit_deposit",
  "create_vendor_credit",
  "edit_vendor_credit",
  "create_bill_payment",
  "create_vendor",
  "edit_vendor",
  "deactivate_vendor",
  "create_customer",
  "edit_customer",
  "create_class",
  "edit_class",
  "create_attachable",
  "edit_attachable",
]);

export function getToolEffect(
  name: string,
  args: Record<string, unknown>
): ToolEffect {
  if (name === "delete_entity") {
    return args.confirm === true ? "committed-mutation" : "preview";
  }
  if (DRAFT_MUTATIONS.has(name)) {
    return args.draft === false ? "committed-mutation" : "preview";
  }
  if (READ_TOOLS.has(name)) return "read";
  throw new Error(`Tool "${name}" has no execution effect classification`);
}
