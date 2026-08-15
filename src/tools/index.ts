// Tool registry and dispatcher with auth retry

import QuickBooks from "node-quickbooks";
import { asMCPToolResult } from "../types/index.js";
import type { InternalToolResult, MCPToolResult } from "../types/index.js";
import type { QboRequestContext } from "../runtime/types.js";
import { getClient, clearCredentialsCache, refreshTokens, isAuthError } from "../client/index.js";
import { isQboOperationTimeoutError } from "../client/promisify.js";
import { formatQBOError, isAmbiguousMutationError } from "../utils/index.js";
import { isToolDisabled } from "./crud-filter.js";
import { getToolEffect } from "./effects.js";
import { runLocalOperation } from "../runtime/local-operation-coordinator.js";
import {
  handleGetCompanyInfo,
  handleQuery,
  handleListAccounts,
  handleGetProfitLoss,
  handleGetBalanceSheet,
  handleGetTrialBalance,
  handleQueryAccountTransactions,
  handleAccountPeriodSummary,
  handleCreateJournalEntry,
  handleGetJournalEntry,
  handleEditJournalEntry,
  handleCreateBill,
  handleGetBill,
  handleEditBill,
  handleCreateExpense,
  handleGetExpense,
  handleEditExpense,
  handleCreateSalesReceipt,
  handleGetSalesReceipt,
  handleEditSalesReceipt,
  handleCreateInvoice,
  handleGetInvoice,
  handleEditInvoice,
  handleCreateDeposit,
  handleGetDeposit,
  handleEditDeposit,
  handleCreateVendorCredit,
  handleGetVendorCredit,
  handleEditVendorCredit,
  handleCreateBillPayment,
  handleGetBillPayment,
  handleCreateVendor,
  handleGetVendor,
  handleEditVendor,
  handleDeactivateVendor,
  handleCreateCustomer,
  handleGetCustomer,
  handleEditCustomer,
  handleCreateClass,
  handleGetClass,
  handleEditClass,
  handleCreateAttachable,
  handleGetAttachable,
  handleEditAttachable,
  handleListTransactionAttachables,
  handleReadAttachableContent,
  handleDeleteEntity,
  handleAuthenticate,
  handleListProfiles,
  handleSwitchProfile,
} from "./handlers/index.js";

export { toolDefinitions } from "./definitions.js";

type ToolHandler = (
  client: QuickBooks,
  args: Record<string, unknown>,
  context?: QboRequestContext
) => Promise<InternalToolResult>;

// Tool handler registry
const toolHandlers = new Map<string, ToolHandler>();

// Register all tools
toolHandlers.set("get_company_info", (client) => handleGetCompanyInfo(client));
toolHandlers.set("query", (client, args, context) => handleQuery(client, args as { query: string }, context));
toolHandlers.set("list_accounts", (client, args, context) => handleListAccounts(client, args as { account_type?: string; active_only?: boolean }, context));
toolHandlers.set("get_profit_loss", (client, args, context) => handleGetProfitLoss(client, args as Parameters<typeof handleGetProfitLoss>[1], context));
toolHandlers.set("get_balance_sheet", (client, args, context) => handleGetBalanceSheet(client, args as Parameters<typeof handleGetBalanceSheet>[1], context));
toolHandlers.set("get_trial_balance", (client, args, context) => handleGetTrialBalance(client, args as Parameters<typeof handleGetTrialBalance>[1], context));
toolHandlers.set("query_account_transactions", (client, args, context) => handleQueryAccountTransactions(client, args as Parameters<typeof handleQueryAccountTransactions>[1], context));
toolHandlers.set("account_period_summary", (client, args, context) => handleAccountPeriodSummary(client, args as Parameters<typeof handleAccountPeriodSummary>[1], context));
toolHandlers.set("create_journal_entry", (client, args, context) => handleCreateJournalEntry(client, args as Parameters<typeof handleCreateJournalEntry>[1], context));
toolHandlers.set("get_journal_entry", (client, args, context) => handleGetJournalEntry(client, args as { id: string }, context));
toolHandlers.set("edit_journal_entry", (client, args, context) => handleEditJournalEntry(client, args as Parameters<typeof handleEditJournalEntry>[1], context));
toolHandlers.set("create_bill", (client, args, context) => handleCreateBill(client, args as Parameters<typeof handleCreateBill>[1], context));
toolHandlers.set("get_bill", (client, args, context) => handleGetBill(client, args as { id: string }, context));
toolHandlers.set("edit_bill", (client, args, context) => handleEditBill(client, args as Parameters<typeof handleEditBill>[1], context));
toolHandlers.set("create_expense", (client, args, context) => handleCreateExpense(client, args as Parameters<typeof handleCreateExpense>[1], context));
toolHandlers.set("get_expense", (client, args, context) => handleGetExpense(client, args as { id: string }, context));
toolHandlers.set("edit_expense", (client, args, context) => handleEditExpense(client, args as Parameters<typeof handleEditExpense>[1], context));
toolHandlers.set("create_sales_receipt", (client, args, context) => handleCreateSalesReceipt(client, args as Parameters<typeof handleCreateSalesReceipt>[1], context));
toolHandlers.set("get_sales_receipt", (client, args, context) => handleGetSalesReceipt(client, args as { id: string }, context));
toolHandlers.set("edit_sales_receipt", (client, args, context) => handleEditSalesReceipt(client, args as Parameters<typeof handleEditSalesReceipt>[1], context));
toolHandlers.set("create_invoice", (client, args, context) => handleCreateInvoice(client, args as Parameters<typeof handleCreateInvoice>[1], context));
toolHandlers.set("get_invoice", (client, args, context) => handleGetInvoice(client, args as { id: string }, context));
toolHandlers.set("edit_invoice", (client, args, context) => handleEditInvoice(client, args as Parameters<typeof handleEditInvoice>[1], context));
toolHandlers.set("create_deposit", (client, args, context) => handleCreateDeposit(client, args as Parameters<typeof handleCreateDeposit>[1], context));
toolHandlers.set("get_deposit", (client, args, context) => handleGetDeposit(client, args as { id: string }, context));
toolHandlers.set("edit_deposit", (client, args, context) => handleEditDeposit(client, args as Parameters<typeof handleEditDeposit>[1], context));
toolHandlers.set("create_vendor_credit", (client, args, context) => handleCreateVendorCredit(client, args as Parameters<typeof handleCreateVendorCredit>[1], context));
toolHandlers.set("get_vendor_credit", (client, args, context) => handleGetVendorCredit(client, args as { id: string }, context));
toolHandlers.set("edit_vendor_credit", (client, args, context) => handleEditVendorCredit(client, args as Parameters<typeof handleEditVendorCredit>[1], context));
toolHandlers.set("create_bill_payment", (client, args, context) => handleCreateBillPayment(client, args as Parameters<typeof handleCreateBillPayment>[1], context));
toolHandlers.set("get_bill_payment", (client, args, context) => handleGetBillPayment(client, args as { id: string }, context));
toolHandlers.set("create_vendor", (client, args, context) => handleCreateVendor(client, args as unknown as Parameters<typeof handleCreateVendor>[1], context));
toolHandlers.set("get_vendor", (client, args, context) => handleGetVendor(client, args as { id: string }, context));
toolHandlers.set("edit_vendor", (client, args, context) => handleEditVendor(client, args as unknown as Parameters<typeof handleEditVendor>[1], context));
toolHandlers.set("deactivate_vendor", (client, args, context) => handleDeactivateVendor(client, args as Parameters<typeof handleDeactivateVendor>[1], context));
toolHandlers.set("create_customer", (client, args, context) => handleCreateCustomer(client, args as Parameters<typeof handleCreateCustomer>[1], context));
toolHandlers.set("get_customer", (client, args, context) => handleGetCustomer(client, args as { id: string }, context));
toolHandlers.set("edit_customer", (client, args, context) => handleEditCustomer(client, args as Parameters<typeof handleEditCustomer>[1], context));
toolHandlers.set("create_class", (client, args) => handleCreateClass(client, args as Parameters<typeof handleCreateClass>[1]));
toolHandlers.set("get_class", (client, args, context) => handleGetClass(client, args as { id: string }, context));
toolHandlers.set("edit_class", (client, args) => handleEditClass(client, args as Parameters<typeof handleEditClass>[1]));
toolHandlers.set("create_attachable", (client, args) => handleCreateAttachable(client, args as Parameters<typeof handleCreateAttachable>[1]));
toolHandlers.set("get_attachable", (client, args, context) => handleGetAttachable(client, args as { id: string }, context));
toolHandlers.set("edit_attachable", (client, args) => handleEditAttachable(client, args as Parameters<typeof handleEditAttachable>[1]));
toolHandlers.set("list_transaction_attachables", (client, args, context) => handleListTransactionAttachables(client, args as Parameters<typeof handleListTransactionAttachables>[1], context));
toolHandlers.set("read_attachable_content", (client, args, context) => handleReadAttachableContent(client, args as Parameters<typeof handleReadAttachableContent>[1], context));
toolHandlers.set("delete_entity", (client, args) => handleDeleteEntity(client, args as Parameters<typeof handleDeleteEntity>[1]));

// Execute tool with auth retry logic
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context?: QboRequestContext
): Promise<MCPToolResult> {
  if (!context && name !== "switch_qbo_profile") {
    return runLocalOperation(() => executeToolAttempt(name, args));
  }
  return executeToolAttempt(name, args, context);
}

async function executeToolAttempt(
  name: string,
  args: Record<string, unknown>,
  context?: QboRequestContext
): Promise<MCPToolResult> {
  // Defense-in-depth: reject disabled tools even if called directly
  if (isToolDisabled(name)) {
    return {
      content: [{ type: "text", text: `Tool "${name}" is disabled by server configuration.` }],
      isError: true,
    };
  }

  // Special case: qbo_authenticate doesn't need a QuickBooks client
  if (name === "qbo_authenticate") {
    return asMCPToolResult(await handleAuthenticate(args as { authorization_code?: string; realm_id?: string }));
  }

  // Special case: profile tools don't need a QuickBooks client
  if (name === "list_qbo_profiles") {
    return asMCPToolResult(await handleListProfiles());
  }
  if (name === "switch_qbo_profile") {
    return asMCPToolResult(await handleSwitchProfile(args as { profile: string }));
  }

  const handler = toolHandlers.get(name);
  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }

  let failedCredentialFingerprint: string | null = null;
  const effect = getToolEffect(name, args);
  const executeOperation = async () => {
    if (context) {
      const attempt = await context.runtime.createClientAttempt();
      failedCredentialFingerprint = attempt.credentialFingerprint;
      return handler(attempt.client, args, context);
    }
    const client = await getClient();
    return handler(client, args);
  };

  // Execute with retry on auth failure
  try {
    return asMCPToolResult(await executeOperation());
  } catch (error) {
    if (isQboOperationTimeoutError(error)) {
      return {
        content: [{
          type: "text",
          text: effect === "committed-mutation"
            ? indeterminateResultMessage(name, error)
            : timeoutResultMessage(name, effect, error.timeoutMs),
        }],
        isError: true,
      };
    }

    if (isAuthError(error)) {
      try {
        if (context && failedCredentialFingerprint) {
          await context.runtime.refreshAfterAuthError(failedCredentialFingerprint);
        } else {
          await refreshTokens();
        }
      } catch (refreshError) {
        if (context) context.runtime.clearCaches();
        else clearCredentialsCache();
        return {
          content: [{
            type: "text",
            text: effect === "committed-mutation"
              ? indeterminateResultMessage(name)
              : `Authentication refresh failed: ${formatQBOError(refreshError)}`,
          }],
          isError: true,
        };
      }

      if (effect === "committed-mutation") {
        return {
          content: [{ type: "text", text: indeterminateResultMessage(name) }],
          isError: true,
        };
      }
      try {
        return asMCPToolResult(await executeOperation());
      } catch (retryError) {
        if (isQboOperationTimeoutError(retryError)) {
          return {
            content: [{
              type: "text",
              text: timeoutResultMessage(name, effect, retryError.timeoutMs),
            }],
            isError: true,
          };
        }
        // If retry also fails, return that error
        return {
          content: [{ type: "text", text: `Error after retry: ${formatQBOError(retryError)}` }],
          isError: true,
        };
      }
    }

    if (effect === "committed-mutation" && isAmbiguousMutationError(error)) {
      return {
        content: [{ type: "text", text: indeterminateResultMessage(name, error) }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Error: ${formatQBOError(error)}` }],
      isError: true,
    };
  }
}

function timeoutResultMessage(
  name: string,
  effect: "read" | "preview",
  timeoutMs: number
): string {
  const guidance = effect === "read"
    ? "Retry the read."
    : "Retry the preview; no committed write was requested.";
  return `timeout: "${name}" exceeded the ${timeoutMs} ms QuickBooks callback deadline. ${guidance}`;
}

function indeterminateResultMessage(name: string, error?: unknown): string {
  const detail = error ? ` QuickBooks returned: ${formatQBOError(error)}.` : "";
  return `indeterminate_result: The result of "${name}" could not be confirmed. ` +
    `The operation may have reached QuickBooks, so it was not replayed.${detail} ` +
    "Fetch or search the relevant QuickBooks record to verify the result before retrying.";
}
