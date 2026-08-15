// Tool definitions for QuickBooks MCP server

const lineCustomerRefCreateProperties = {
  customer_name: {
    type: "string",
    description: "Optional customer display or fully qualified job name for this line (e.g., 'Customer:Job'). Mutually exclusive with customer_id. Does not make the line billable.",
  },
  customer_id: {
    type: "string",
    description: "Optional customer/job ID for this line. Mutually exclusive with customer_name. Does not make the line billable.",
  },
};

const lineCustomerRefEditProperties = {
  customer_name: {
    type: "string",
    description: "Assign or replace the line customer/job by display or fully qualified name. Mutually exclusive with customer_id and clear_customer.",
  },
  customer_id: {
    type: "string",
    description: "Assign or replace the line customer/job by ID. Mutually exclusive with customer_name and clear_customer.",
  },
  clear_customer: {
    type: "boolean",
    description: "Set true to remove the line CustomerRef. Rejected for Billable or HasBeenBilled lines and new lines.",
  },
};

const addressSchemaProperties = {
  line1: { type: "string" },
  line2: { type: "string" },
  line3: { type: "string" },
  line4: { type: "string" },
  line5: { type: "string" },
  city: { type: "string" },
  country_sub_division_code: { type: "string", description: "State/province code" },
  postal_code: { type: "string" },
  country: { type: "string" },
  lat: { type: "string" },
  long: { type: "string" },
};

const vendorWriteProperties = {
  display_name: {
    type: "string",
    maxLength: 500,
    description: "Vendor display name. Required on create and unique across QBO vendors, customers, and employees. Cannot contain colon, tab, or newline characters.",
  },
  title: {
    type: "string",
    maxLength: 16,
    description: "Personal title, maximum 16 characters (optional)",
  },
  given_name: {
    type: "string",
    maxLength: 100,
    description: "First/given name, maximum 100 characters (optional)",
  },
  middle_name: {
    type: "string",
    maxLength: 100,
    description: "Middle name, maximum 100 characters (optional)",
  },
  family_name: {
    type: "string",
    maxLength: 100,
    description: "Last/family name, maximum 100 characters (optional)",
  },
  suffix: {
    type: "string",
    maxLength: 16,
    description: "Name suffix, maximum 16 characters (optional)",
  },
  company_name: {
    type: "string",
    maxLength: 100,
    description: "Company name, maximum 100 characters (optional)",
  },
  print_on_check_name: {
    type: "string",
    maxLength: 100,
    description: "Name printed on checks, maximum 100 characters (optional; defaults from display name)",
  },
  email: {
    type: "string",
    description: "Primary email address. Must contain @ and a domain (optional).",
  },
  phone: {
    type: "string",
    description: "Primary phone number (optional)",
  },
  mobile: {
    type: "string",
    description: "Mobile phone number (optional)",
  },
  fax: {
    type: "string",
    description: "Fax number (optional)",
  },
  web_address: {
    type: "string",
    description: "Website URI (optional)",
  },
  bill_address: {
    type: "object",
    description: "Default billing address (optional)",
    properties: addressSchemaProperties,
  },
  vendor_1099: {
    type: "boolean",
    description: "Whether this vendor is an independent contractor tracked for US 1099 reporting (optional)",
  },
  account_number: {
    type: "string",
    maxLength: 100,
    description: "Account number associated with this vendor, maximum 100 characters (optional)",
  },
  terms_ref: {
    type: "string",
    description: "Default payment term name or ID, such as 'Net 30'. Auto-resolved to a QBO Term (optional).",
  },
};

export const toolDefinitions = [
  {
    name: "qbo_authenticate",
    description: "Authenticate with QuickBooks using OAuth (local credential mode only). " +
      "Step 1: Call with no arguments to get the authorization URL. " +
      "Step 2: After authorizing in browser, call with authorization_code and realm_id from the callback URL. " +
      "This tool only works when QBO_CREDENTIAL_MODE is 'local' (the default).",
    inputSchema: {
      type: "object",
      properties: {
        authorization_code: {
          type: "string",
          description: "Authorization code from the QuickBooks OAuth callback URL (the 'code' parameter)",
        },
        realm_id: {
          type: "string",
          description: "Company/realm ID from the callback URL (the 'realmId' parameter). Required when providing authorization_code.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_company_info",
    description: "Get information about the connected QuickBooks company.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "query",
    description: "Execute a QuickBooks query using SQL-like syntax. Supports querying any entity type (Customer, Vendor, Invoice, Bill, Account, Item, Department, etc.). Results are written to a file to preserve context. Defaults to MAXRESULTS 1000 if not specified. Examples: 'SELECT * FROM Customer', 'SELECT * FROM SalesReceipt WHERE TxnDate >= \\'2025-11-01\\' AND TxnDate <= \\'2025-11-30\\''",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The SQL-like query string. Common entities: Customer, Vendor, Invoice, Bill, Account, Item, Department, JournalEntry, Purchase, Payment, SalesReceipt, Deposit. Add MAXRESULTS N to limit results (default: 1000). Note: Most transaction fields (DepartmentRef, AccountRef, Line) are not filterable. Error responses include valid filterable fields for the entity. Use query_account_transactions for account/department filtering.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_accounts",
    description: "List all accounts in the chart of accounts. Returns AcctNum (the user-facing account number), Name, AccountType, AccountSubType, and CurrentBalance. Use AcctNum to reference accounts in other queries or operations.",
    inputSchema: {
      type: "object",
      properties: {
        account_type: {
          type: "string",
          description: "Optional filter by account type (e.g., 'Bank', 'Expense', 'Income', 'Other Current Asset', 'Fixed Asset', 'Other Current Liability', 'Equity')",
        },
        active_only: {
          type: "boolean",
          description: "If true, only return active accounts (default: true)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_profit_loss",
    description: "Get a Profit and Loss (Income Statement) report. Can be broken down by department/location.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description: "Start date in YYYY-MM-DD format",
        },
        end_date: {
          type: "string",
          description: "End date in YYYY-MM-DD format",
        },
        summarize_by: {
          type: "string",
          description: "How to summarize columns: 'Total' (default), 'Month', 'Week', 'Days', 'Quarter', 'Year', 'Customers', 'Vendors', 'Classes', 'Departments', 'Employees', 'ProductsAndServices'",
        },
        department: {
          type: "string",
          description: "Filter to a specific department/location ID",
        },
        accounting_method: {
          type: "string",
          description: "Accounting method: 'Accrual' (default) or 'Cash'",
        },
      },
      required: [],
    },
  },
  {
    name: "get_balance_sheet",
    description: "Get a Balance Sheet report. Can be broken down by department/location.",
    inputSchema: {
      type: "object",
      properties: {
        as_of_date: {
          type: "string",
          description: "Report as of this date in YYYY-MM-DD format (defaults to today)",
        },
        summarize_by: {
          type: "string",
          description: "How to summarize columns: 'Total' (default), 'Month', 'Week', 'Days', 'Quarter', 'Year', 'Customers', 'Vendors', 'Classes', 'Departments', 'Employees', 'ProductsAndServices'",
        },
        department: {
          type: "string",
          description: "Filter to a specific department/location ID",
        },
        accounting_method: {
          type: "string",
          description: "Accounting method: 'Accrual' (default) or 'Cash'",
        },
      },
      required: [],
    },
  },
  {
    name: "get_trial_balance",
    description: "Get a Trial Balance report. Useful for month-end close and reconciliation. Note: Trial Balance does not support department/location breakdown in QuickBooks Online.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description: "Start date in YYYY-MM-DD format",
        },
        end_date: {
          type: "string",
          description: "End date in YYYY-MM-DD format",
        },
        accounting_method: {
          type: "string",
          description: "Accounting method: 'Accrual' (default) or 'Cash'",
        },
      },
      required: [],
    },
  },
  {
    name: "query_account_transactions",
    description: "Return authoritative General Ledger postings affecting a specific account. Includes QBO transaction IDs, type, date, document number, counterparty, memo, split account, debit/credit, amount, running balance, and direct QBO links where supported. Supports department and Cash/Accrual filtering. This is read-only detail; fetch the source entity separately before edits to obtain current SyncToken and line IDs.",
    inputSchema: {
      type: "object",
      properties: {
        account: {
          type: "string",
          description: "Account name, number (AcctNum), or ID. Examples: 'Tips', '2320', '116'"
        },
        start_date: {
          type: "string",
          description: "Start date YYYY-MM-DD (default: start of year)"
        },
        end_date: {
          type: "string",
          description: "End date YYYY-MM-DD (default: today)"
        },
        department: {
          type: "string",
          description: "Filter to specific department/location (optional)"
        },
        accounting_method: {
          type: "string",
          enum: ["Accrual", "Cash"],
          description: "Accounting method: 'Accrual' (default) or 'Cash'"
        }
      },
      required: ["account"]
    }
  },
  {
    name: "account_period_summary",
    description: "Get a period summary for an account: opening balance, total debits/credits, closing balance, and transaction count. Uses the General Ledger report. Supports department filtering.",
    inputSchema: {
      type: "object",
      properties: {
        account: {
          type: "string",
          description: "Account name, number (AcctNum), or ID",
        },
        start_date: {
          type: "string",
          description: "Start date YYYY-MM-DD (default: start of year)",
        },
        end_date: {
          type: "string",
          description: "End date YYYY-MM-DD (default: today)",
        },
        department: {
          type: "string",
          description: "Filter to specific department/location (optional)",
        },
        accounting_method: {
          type: "string",
          enum: ["Accrual", "Cash"],
          description: "Accounting method: 'Accrual' (default) or 'Cash'",
        },
      },
      required: ["account"],
    },
  },
  {
    name: "create_journal_entry",
    description: "Create a journal entry. Accepts account/department names (will lookup IDs automatically). Validates debits=credits before creating. Returns entry details and a link to view in QuickBooks.",
    inputSchema: {
      type: "object",
      properties: {
        txn_date: {
          type: "string",
          description: "Transaction date in YYYY-MM-DD format",
        },
        memo: {
          type: "string",
          description: "Private memo for the journal entry",
        },
        lines: {
          type: "array",
          description: "Array of line items. Provide account_name OR account_id (name preferred). Optionally provide department_name OR department_id.",
          items: {
            type: "object",
            properties: {
              account_name: {
                type: "string",
                description: "Account name (e.g., 'Tips', '2320 Tips'). Will be looked up to get ID.",
              },
              account_id: {
                type: "string",
                description: "Account ID (use if you already know it, otherwise use account_name)",
              },
              amount: {
                type: "number",
                description: "Line amount (positive number)",
              },
              posting_type: {
                type: "string",
                enum: ["Debit", "Credit"],
                description: "Whether this line is a Debit or Credit",
              },
              department_name: {
                type: "string",
                description: "Department/Location name (e.g., '20358', 'Santa Rosa'). Will be looked up to get ID.",
              },
              department_id: {
                type: "string",
                description: "Department/Location ID (use if you already know it, otherwise use department_name)",
              },
              description: {
                type: "string",
                description: "Line description (optional)",
              },
            },
            required: ["amount", "posting_type"],
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without creating (default: true)",
        },
        doc_number: {
          type: "string",
          maxLength: 21,
          description: "Journal number, maximum 21 characters (shown as 'Journal no.' in QuickBooks). If not specified, QuickBooks will auto-assign the next number.",
        },
      },
      required: ["txn_date", "lines"],
    },
  },
  {
    name: "get_journal_entry",
    description: "Fetch a single journal entry by ID with full details including SyncToken (needed for edits). Returns formatted summary and writes full object to temp file.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The journal entry ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "edit_journal_entry",
    description: "Modify an existing journal entry. Can update date, memo, doc_number, and/or lines. For lines: provide line_id to update existing line, omit line_id to add new line, set delete=true to remove a line. Validates debits=credits before saving.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Journal entry ID to edit",
        },
        txn_date: {
          type: "string",
          description: "New transaction date in YYYY-MM-DD format (optional)",
        },
        memo: {
          type: "string",
          description: "New private memo (optional)",
        },
        doc_number: {
          type: "string",
          maxLength: 21,
          description: "New journal number, maximum 21 characters (optional)",
        },
        lines: {
          type: "array",
          description: "Line modifications. Provide line_id to update existing line, omit to add new line.",
          items: {
            type: "object",
            properties: {
              line_id: {
                type: "string",
                description: "ID of existing line to update (omit for new line)",
              },
              account_name: {
                type: "string",
                description: "Account name/number (auto-resolved to ID)",
              },
              amount: {
                type: "number",
                description: "Line amount (positive number)",
              },
              posting_type: {
                type: "string",
                enum: ["Debit", "Credit"],
                description: "Whether this line is a Debit or Credit",
              },
              department_name: {
                type: "string",
                description: "Department/Location name (auto-resolved to ID)",
              },
              description: {
                type: "string",
                description: "Line description",
              },
              delete: {
                type: "boolean",
                description: "Set true to remove this line (requires line_id)",
              },
            },
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without saving (default: true)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "create_bill",
    description: "Create a vendor bill. Accepts vendor/account/department names and optional line-level customer/job assignments (will lookup IDs automatically). Customer/job tagging does not make a line billable. Note: DepartmentRef is header-level only — for multi-department splits, create separate bills (one per department). Returns bill details and a link to view in QuickBooks.",
    inputSchema: {
      type: "object",
      properties: {
        vendor_name: {
          type: "string",
          description: "Vendor display name (e.g., 'Simplisafe', 'PG&E'). Will be looked up to get ID.",
        },
        vendor_id: {
          type: "string",
          description: "Vendor ID (use if you already know it, otherwise use vendor_name)",
        },
        txn_date: {
          type: "string",
          description: "Transaction date in YYYY-MM-DD format",
        },
        due_date: {
          type: "string",
          description: "Due date in YYYY-MM-DD format (optional)",
        },
        department_name: {
          type: "string",
          description: "Header-level department/location name (e.g., '20358', 'Cotati'). Will be looked up to get ID.",
        },
        department_id: {
          type: "string",
          description: "Header-level department/location ID (use if you already know it, otherwise use department_name)",
        },
        ap_account: {
          type: "string",
          description: "Accounts Payable account name or number (optional, defaults to standard AP)",
        },
        memo: {
          type: "string",
          description: "Private memo for the bill",
        },
        doc_number: {
          type: "string",
          maxLength: 21,
          description: "Reference number for the bill, maximum 21 characters (optional)",
        },
        lines: {
          type: "array",
          description: "Array of expense line items. Provide account_name OR account_id (name preferred).",
          items: {
            type: "object",
            properties: {
              account_name: {
                type: "string",
                description: "Account name (e.g., 'Alarm', '6123'). Will be looked up to get ID.",
              },
              account_id: {
                type: "string",
                description: "Account ID (use if you already know it, otherwise use account_name)",
              },
              amount: {
                type: "number",
                description: "Line amount (positive number)",
              },
              description: {
                type: "string",
                description: "Line description (optional)",
              },
              ...lineCustomerRefCreateProperties,
            },
            required: ["amount"],
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without creating (default: true)",
        },
      },
      required: ["txn_date", "lines"],
    },
  },
  {
    name: "get_bill",
    description: "Fetch a single bill by ID with full details including SyncToken (needed for edits). Returns vendor, date, due date, amount, AP account, and line details including customer/job and billable status when present.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The bill ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "edit_bill",
    description: "Modify an existing bill. Can update vendor, date, due date, memo, and/or lines. Account-based lines can preserve, assign, change, or clear a customer/job without changing billable status. Provide line_id to update existing, omit to add new, or set delete=true to remove. Note: DepartmentRef is header-level only.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Bill ID to edit",
        },
        vendor_name: {
          type: "string",
          description: "New vendor display name (e.g., 'Simplisafe', 'PG&E'). Auto-resolved to ID.",
        },
        txn_date: {
          type: "string",
          description: "New transaction date in YYYY-MM-DD format (optional)",
        },
        due_date: {
          type: "string",
          description: "New due date in YYYY-MM-DD format (optional)",
        },
        memo: {
          type: "string",
          description: "New private memo (optional)",
        },
        department_name: {
          type: "string",
          description: "Header-level department/location name (auto-resolved to ID)",
        },
        doc_number: {
          type: "string",
          maxLength: 21,
          description: "Reference number for the bill, maximum 21 characters (optional)",
        },
        lines: {
          type: "array",
          description: "Line modifications. Provide line_id to update existing, omit to add new.",
          items: {
            type: "object",
            properties: {
              line_id: {
                type: "string",
                description: "ID of existing line to update (omit for new line)",
              },
              account_name: {
                type: "string",
                description: "Account name/number (auto-resolved to ID)",
              },
              amount: {
                type: "number",
                description: "Line amount (positive number)",
              },
              description: {
                type: "string",
                description: "Line description",
              },
              ...lineCustomerRefEditProperties,
              delete: {
                type: "boolean",
                description: "Set true to remove this line (requires line_id)",
              },
            },
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without saving (default: true)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "get_expense",
    description: "Fetch a single expense (Purchase) by ID with full details including SyncToken. Covers Expenses, Checks, and Credit Card charges. Returns payment type, account, date, amount, and line details including customer/job and billable status when present.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The expense (Purchase) ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "edit_expense",
    description: "Modify an existing expense (Purchase). Can update date, memo, payment account, vendor/payee, department, and/or lines. Account-based lines can preserve, assign, change, or clear a customer/job without changing billable status. PaymentType cannot be changed after creation.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Expense (Purchase) ID to edit",
        },
        txn_date: {
          type: "string",
          description: "New transaction date in YYYY-MM-DD format (optional)",
        },
        memo: {
          type: "string",
          description: "New private memo (optional)",
        },
        payment_account: {
          type: "string",
          description: "New payment account name/number (Bank or Credit Card account)",
        },
        lines: {
          type: "array",
          description: "Line modifications. Provide line_id to update existing, omit to add new.",
          items: {
            type: "object",
            properties: {
              line_id: {
                type: "string",
                description: "ID of existing line to update (omit for new line)",
              },
              account_name: {
                type: "string",
                description: "Account name/number (auto-resolved to ID)",
              },
              amount: {
                type: "number",
                description: "Line amount (positive number)",
              },
              description: {
                type: "string",
                description: "Line description",
              },
              ...lineCustomerRefEditProperties,
              delete: {
                type: "boolean",
                description: "Set true to remove this line (requires line_id)",
              },
            },
          },
        },
        department_name: {
          type: "string",
          description: "Header-level department/location name (auto-resolved to ID)",
        },
        entity_name: {
          type: "string",
          description: "Payee/vendor display name (e.g., 'Cozzini Bros., Inc.'). Will be looked up to get ID.",
        },
        entity_id: {
          type: "string",
          description: "Payee/vendor ID (use if you already know it, otherwise use entity_name)",
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without saving (default: true)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "create_expense",
    description: "Create an expense (Purchase). Accepts account/department/vendor names and optional line-level customer/job assignments (will lookup IDs automatically). Customer/job tagging does not make a line billable. Covers Cash, Check, and Credit Card payment types. Note: PaymentType cannot be changed after creation. DepartmentRef is header-level only. Returns expense details and a link to view in QuickBooks.",
    inputSchema: {
      type: "object",
      properties: {
        payment_type: {
          type: "string",
          enum: ["Cash", "Check", "CreditCard"],
          description: "Payment method: 'Cash', 'Check', or 'CreditCard'. Cannot be changed after creation.",
        },
        payment_account: {
          type: "string",
          description: "Bank or credit card account name or number (e.g., 'PLAT BUS CHECKING', '5752'). Will be looked up to get ID.",
        },
        txn_date: {
          type: "string",
          description: "Transaction date in YYYY-MM-DD format",
        },
        entity_name: {
          type: "string",
          description: "Payee/vendor display name (e.g., 'Simplisafe', 'PG&E'). Will be looked up to get ID.",
        },
        entity_id: {
          type: "string",
          description: "Payee/vendor ID (use if you already know it, otherwise use entity_name)",
        },
        department_name: {
          type: "string",
          description: "Header-level department/location name (e.g., '20358', 'Cotati'). Will be looked up to get ID.",
        },
        department_id: {
          type: "string",
          description: "Header-level department/location ID (use if you already know it, otherwise use department_name)",
        },
        memo: {
          type: "string",
          description: "Private memo for the expense",
        },
        doc_number: {
          type: "string",
          maxLength: 21,
          description: "Reference number for the expense, maximum 21 characters (optional)",
        },
        lines: {
          type: "array",
          description: "Array of expense line items. Provide account_name OR account_id (name preferred).",
          items: {
            type: "object",
            properties: {
              account_name: {
                type: "string",
                description: "Account name (e.g., 'Alarm', '6123'). Will be looked up to get ID.",
              },
              account_id: {
                type: "string",
                description: "Account ID (use if you already know it, otherwise use account_name)",
              },
              amount: {
                type: "number",
                description: "Line amount (positive number)",
              },
              description: {
                type: "string",
                description: "Line description (optional)",
              },
              ...lineCustomerRefCreateProperties,
            },
            required: ["amount"],
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without creating (default: true)",
        },
      },
      required: ["payment_type", "payment_account", "txn_date", "lines"],
    },
  },
  {
    name: "get_sales_receipt",
    description: "Fetch a single sales receipt by ID with full details including SyncToken (needed for edits). Returns customer, date, deposit account, department, line details with items/qty/price.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The sales receipt ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "edit_sales_receipt",
    description: "Modify an existing sales receipt. Can update date, memo, deposit account, department, and/or lines. For lines: provide line_id to update existing line, omit line_id to add new line (requires item_name), set delete=true to remove.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Sales receipt ID to edit",
        },
        txn_date: {
          type: "string",
          description: "New transaction date in YYYY-MM-DD format (optional)",
        },
        memo: {
          type: "string",
          description: "New private memo (optional)",
        },
        deposit_to_account: {
          type: "string",
          description: "New deposit account name/number (Bank account)",
        },
        department_name: {
          type: "string",
          description: "Header-level department/location name (auto-resolved to ID)",
        },
        lines: {
          type: "array",
          description: "Line modifications. Provide line_id to update existing line, omit to add new line.",
          items: {
            type: "object",
            properties: {
              line_id: {
                type: "string",
                description: "ID of existing line to update (omit for new line)",
              },
              item_name: {
                type: "string",
                description: "Item (product/service) name for new lines (e.g., 'Sales', 'Catering'). Auto-resolved to ID.",
              },
              item_id: {
                type: "string",
                description: "Item ID (use if you already know it, otherwise use item_name)",
              },
              amount: {
                type: "number",
                description: "Line amount (positive number)",
              },
              qty: {
                type: "number",
                description: "Quantity (default: 1)",
              },
              unit_price: {
                type: "number",
                description: "Price per unit (if omitted, computed from amount / qty)",
              },
              description: {
                type: "string",
                description: "Line description",
              },
              delete: {
                type: "boolean",
                description: "Set true to remove this line (requires line_id)",
              },
            },
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without saving (default: true)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "create_sales_receipt",
    description: "Create a sales receipt. Accepts item/customer/department names (will lookup IDs automatically). Provide at most one of customer_name or customer_id. Lines reference items (products/services) not accounts. Returns receipt details and a link to view in QuickBooks.",
    inputSchema: {
      type: "object",
      properties: {
        txn_date: {
          type: "string",
          description: "Transaction date in YYYY-MM-DD format",
        },
        customer_name: {
          type: "string",
          description: "Customer display or fully qualified job name (e.g., 'Customer:Job'). Mutually exclusive with customer_id.",
        },
        customer_id: {
          type: "string",
          description: "Customer ID (use if you already know it, otherwise use customer_name)",
        },
        deposit_to_account: {
          type: "string",
          description: "Bank account name or number to deposit into (e.g., 'Undeposited Funds', '1000'). Will be looked up to get ID.",
        },
        department_name: {
          type: "string",
          description: "Header-level department/location name (e.g., '20358', 'Cotati'). Will be looked up to get ID.",
        },
        department_id: {
          type: "string",
          description: "Header-level department/location ID (use if you already know it, otherwise use department_name)",
        },
        memo: {
          type: "string",
          description: "Private memo for the sales receipt",
        },
        doc_number: {
          type: "string",
          maxLength: 21,
          description: "Reference number for the sales receipt, maximum 21 characters (optional)",
        },
        lines: {
          type: "array",
          description: "Array of line items. Each line references an item (product/service). Provide item_name OR item_id (name preferred).",
          items: {
            type: "object",
            properties: {
              item_name: {
                type: "string",
                description: "Item (product/service) name (e.g., 'Sales', 'Catering'). Will be looked up to get ID.",
              },
              item_id: {
                type: "string",
                description: "Item ID (use if you already know it, otherwise use item_name)",
              },
              amount: {
                type: "number",
                description: "Line amount (positive or negative). Negative for adjustments/discounts.",
              },
              qty: {
                type: "number",
                description: "Quantity (default: 1)",
              },
              unit_price: {
                type: "number",
                description: "Price per unit (if omitted, computed from amount / qty)",
              },
              description: {
                type: "string",
                description: "Line description (optional)",
              },
            },
            required: [],
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without creating (default: true)",
        },
      },
      required: ["txn_date", "lines"],
    },
  },
  {
    name: "create_invoice",
    description: "Create an invoice. Accepts item/customer/department names (will lookup IDs automatically). Exactly one of customer_name or customer_id is REQUIRED — invoices must have a customer. Lines use SalesItemLineDetail (product/service references, not accounts). Returns invoice details and a link to view in QuickBooks.",
    inputSchema: {
      type: "object",
      properties: {
        txn_date: {
          type: "string",
          description: "Transaction date in YYYY-MM-DD format",
        },
        customer_name: {
          type: "string",
          description: "Customer display or fully qualified job name (e.g., 'Customer:Job'). Mutually exclusive with customer_id.",
        },
        customer_id: {
          type: "string",
          description: "Customer ID (use if you already know it, otherwise use customer_name)",
        },
        due_date: {
          type: "string",
          description: "Due date in YYYY-MM-DD format (optional)",
        },
        department_name: {
          type: "string",
          description: "Header-level department/location name (e.g., '20358', 'Cotati'). Will be looked up to get ID.",
        },
        department_id: {
          type: "string",
          description: "Header-level department/location ID (use if you already know it, otherwise use department_name)",
        },
        memo: {
          type: "string",
          description: "Private memo for the invoice (internal, not visible to customer)",
        },
        customer_memo: {
          type: "string",
          description: "Customer-facing message visible on the invoice",
        },
        bill_email: {
          type: "string",
          description: "Email address to send the invoice to. Required if you want QuickBooks to email the invoice.",
        },
        sales_term_ref: {
          type: "string",
          description: "Payment terms name (e.g., 'Net 30', 'Due on receipt'). Will be looked up to get ID.",
        },
        allow_online_credit_card_payment: {
          type: "boolean",
          description: "Allow customer to pay this invoice with a credit card online. Must be explicitly set — company defaults do not apply via API.",
        },
        allow_online_ach_payment: {
          type: "boolean",
          description: "Allow customer to pay this invoice via bank transfer (ACH) online. Must be explicitly set — company defaults do not apply via API.",
        },
        doc_number: {
          type: "string",
          maxLength: 21,
          description: "Reference number for the invoice, maximum 21 characters (optional)",
        },
        lines: {
          type: "array",
          description: "Array of line items. Each line references an item (product/service). Provide item_name OR item_id (name preferred).",
          items: {
            type: "object",
            properties: {
              item_name: {
                type: "string",
                description: "Item (product/service) name (e.g., 'Sales', 'Catering'). Will be looked up to get ID.",
              },
              item_id: {
                type: "string",
                description: "Item ID (use if you already know it, otherwise use item_name)",
              },
              amount: {
                type: "number",
                description: "Line amount (positive or negative). Negative for adjustments/discounts.",
              },
              qty: {
                type: "number",
                description: "Quantity (default: 1)",
              },
              unit_price: {
                type: "number",
                description: "Price per unit (if omitted, computed from amount / qty)",
              },
              description: {
                type: "string",
                description: "Line description (optional)",
              },
            },
            required: [],
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without creating (default: true)",
        },
      },
      required: ["txn_date", "lines"],
    },
  },
  {
    name: "get_invoice",
    description: "Fetch a single invoice by ID with full details including SyncToken (needed for edits). Returns customer, date, due date, balance, department, line details with items/qty/price.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The invoice ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "edit_invoice",
    description: "Modify an existing invoice. Can update date, due date, memo, customer, department, terms, email, online payment settings, and/or lines. For lines: provide line_id to update existing line, omit line_id to add new line (requires item_name), set delete=true to remove.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Invoice ID to edit",
        },
        txn_date: {
          type: "string",
          description: "New transaction date in YYYY-MM-DD format (optional)",
        },
        due_date: {
          type: "string",
          description: "New due date in YYYY-MM-DD format (optional)",
        },
        memo: {
          type: "string",
          description: "New private memo (optional)",
        },
        customer_memo: {
          type: "string",
          description: "New customer-facing message visible on the invoice",
        },
        bill_email: {
          type: "string",
          description: "New email address to send the invoice to",
        },
        sales_term_ref: {
          type: "string",
          description: "Payment terms name (e.g., 'Net 30'). Auto-resolved to ID.",
        },
        allow_online_credit_card_payment: {
          type: "boolean",
          description: "Allow customer to pay with credit card online",
        },
        allow_online_ach_payment: {
          type: "boolean",
          description: "Allow customer to pay via bank transfer (ACH) online",
        },
        customer_name: {
          type: "string",
          description: "New customer display name (auto-resolved to ID)",
        },
        department_name: {
          type: "string",
          description: "Header-level department/location name (auto-resolved to ID)",
        },
        lines: {
          type: "array",
          description: "Line modifications. Provide line_id to update existing line, omit to add new line.",
          items: {
            type: "object",
            properties: {
              line_id: {
                type: "string",
                description: "ID of existing line to update (omit for new line)",
              },
              item_name: {
                type: "string",
                description: "Item (product/service) name for new lines (e.g., 'Sales', 'Catering'). Auto-resolved to ID.",
              },
              item_id: {
                type: "string",
                description: "Item ID (use if you already know it, otherwise use item_name)",
              },
              amount: {
                type: "number",
                description: "Line amount (positive number)",
              },
              qty: {
                type: "number",
                description: "Quantity (default: 1)",
              },
              unit_price: {
                type: "number",
                description: "Price per unit (if omitted, computed from amount / qty)",
              },
              description: {
                type: "string",
                description: "Line description",
              },
              delete: {
                type: "boolean",
                description: "Set true to remove this line (requires line_id)",
              },
            },
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without saving (default: true)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "create_deposit",
    description: "Create a bank deposit. Accepts account/department/vendor names (will lookup IDs automatically). Lines represent the sources of the deposit — amounts can be positive (income) or negative (fees, deductions). QuickBooks computes the total from line amounts. Returns deposit details and a link to view in QuickBooks.",
    inputSchema: {
      type: "object",
      properties: {
        deposit_to_account: {
          type: "string",
          description: "Bank account name or number receiving the deposit (e.g., 'PLAT BUS CHECKING', '5752'). Will be looked up to get ID.",
        },
        txn_date: {
          type: "string",
          description: "Transaction date in YYYY-MM-DD format",
        },
        lines: {
          type: "array",
          description: "Array of deposit line items. Each line represents a source of the deposit. Amounts can be positive or negative.",
          items: {
            type: "object",
            properties: {
              amount: {
                type: "number",
                description: "Line amount (positive or negative). Negative for fees/deductions.",
              },
              account_name: {
                type: "string",
                description: "Source account name or number (e.g., 'House Account', '1340', '6210 Bank Service Charges'). Will be looked up to get ID.",
              },
              account_id: {
                type: "string",
                description: "Account ID (use if you already know it, otherwise use account_name)",
              },
              description: {
                type: "string",
                description: "Line description (optional)",
              },
              entity_name: {
                type: "string",
                description: "Vendor or customer name (e.g., 'Square Inc.'). Sets Entity on the deposit line. Will be looked up to get ID.",
              },
              entity_id: {
                type: "string",
                description: "Entity ID (use if you already know it, otherwise use entity_name)",
              },
            },
            required: ["amount"],
          },
        },
        department_name: {
          type: "string",
          description: "Header-level department/location name (e.g., '20358', 'Cotati'). Will be looked up to get ID.",
        },
        department_id: {
          type: "string",
          description: "Header-level department/location ID (use if you already know it, otherwise use department_name)",
        },
        memo: {
          type: "string",
          description: "Private memo for the deposit",
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without creating (default: true)",
        },
      },
      required: ["deposit_to_account", "txn_date", "lines"],
    },
  },
  {
    name: "get_deposit",
    description: "Fetch a single deposit by ID with full details including SyncToken (needed for edits). Returns deposit account, date, memo, and line details showing source accounts and amounts.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The deposit ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "edit_deposit",
    description: "Modify an existing deposit. Can update date, memo, deposit account, department, and/or lines. CRITICAL for line changes: The QB Deposit API does NOT replace lines - it merges them. Lines WITH line_id update existing lines. Lines WITHOUT line_id are ADDED as new. Lines NOT included are KEPT unchanged. To 'delete' a line, you must include ALL existing lines with their line_ids and set unwanted lines to amount: 0. Line amounts must sum to the original deposit total (use expected_total to override for corrupted deposits).",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Deposit ID to edit",
        },
        txn_date: {
          type: "string",
          description: "New transaction date in YYYY-MM-DD format (optional)",
        },
        memo: {
          type: "string",
          description: "New private memo (optional)",
        },
        deposit_to_account: {
          type: "string",
          description: "New deposit account name/number (Bank account)",
        },
        department_name: {
          type: "string",
          description: "Header-level department/location name (auto-resolved to ID)",
        },
        lines: {
          type: "array",
          description: "IMPORTANT: You MUST include ALL existing lines with their line_ids. Lines without line_id are ADDED (not replaced). Lines not included are KEPT (not deleted). To 'delete' a line, set its amount to 0. Line amounts must sum to original deposit total.",
          items: {
            type: "object",
            properties: {
              line_id: {
                type: "string",
                description: "ID of existing line to update (preserves Entity/Vendor reference). Omit to create new line.",
              },
              amount: {
                type: "number",
                description: "Line amount (positive or negative number)",
              },
              account_name: {
                type: "string",
                description: "Source account name/number (auto-resolved to ID)",
              },
              description: {
                type: "string",
                description: "Line description",
              },
            },
            required: ["amount", "account_name"],
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without saving (default: true)",
        },
        expected_total: {
          type: "number",
          description: "Override total validation with this expected amount (for fixing corrupted deposits). Lines must sum to this value instead of current deposit total.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "create_vendor_credit",
    description: "Create a vendor credit. Accepts vendor/account/department names and optional line-level customer/job assignments (will lookup IDs automatically). Customer/job tagging does not make a line billable. Lines represent credit amounts applied to expense accounts. Returns credit details and a link to view in QuickBooks.",
    inputSchema: {
      type: "object",
      properties: {
        vendor_name: {
          type: "string",
          description: "Vendor display name (e.g., 'Acme Corp'). Will be looked up to get ID.",
        },
        vendor_id: {
          type: "string",
          description: "Vendor ID (use if you already know it, otherwise use vendor_name)",
        },
        txn_date: {
          type: "string",
          description: "Transaction date in YYYY-MM-DD format",
        },
        department_name: {
          type: "string",
          description: "Header-level department/location name (e.g., '20358', 'Cotati'). Will be looked up to get ID.",
        },
        department_id: {
          type: "string",
          description: "Header-level department/location ID (use if you already know it, otherwise use department_name)",
        },
        ap_account: {
          type: "string",
          description: "Accounts Payable account name or number (optional, defaults to standard AP)",
        },
        memo: {
          type: "string",
          description: "Private memo for the vendor credit",
        },
        doc_number: {
          type: "string",
          maxLength: 21,
          description: "Reference number for the vendor credit, maximum 21 characters (optional)",
        },
        lines: {
          type: "array",
          description: "Array of line items. Each line credits an expense account.",
          items: {
            type: "object",
            properties: {
              amount: {
                type: "number",
                description: "Line amount (positive number)",
              },
              account_name: {
                type: "string",
                description: "Account name or number (e.g., '5000 Cost of Goods Sold'). Will be looked up to get ID.",
              },
              account_id: {
                type: "string",
                description: "Account ID (use if you already know it, otherwise use account_name)",
              },
              description: {
                type: "string",
                description: "Line description (optional)",
              },
              ...lineCustomerRefCreateProperties,
            },
            required: ["amount"],
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without creating (default: true)",
        },
      },
      required: ["txn_date", "lines"],
    },
  },
  {
    name: "get_vendor_credit",
    description: "Fetch a single vendor credit by ID with full details including SyncToken (needed for edits). Returns vendor, date, memo, ref number, AP account, and line details including expense account, customer/job, billable status, and amount.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The vendor credit ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "edit_vendor_credit",
    description: "Modify an existing vendor credit. Can update vendor, date, memo, ref number, and/or lines. Account-based lines can preserve, assign, change, or clear a customer/job without changing billable status. Provide line_id to update existing, omit to add new, or set delete=true to remove. Note: DepartmentRef is header-level only.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Vendor Credit ID to edit",
        },
        vendor_name: {
          type: "string",
          description: "New vendor display name (auto-resolved to ID)",
        },
        txn_date: {
          type: "string",
          description: "New transaction date in YYYY-MM-DD format (optional)",
        },
        memo: {
          type: "string",
          description: "New private memo (optional)",
        },
        doc_number: {
          type: "string",
          maxLength: 21,
          description: "New reference number, maximum 21 characters (optional)",
        },
        lines: {
          type: "array",
          description: "Line modifications. Provide line_id to update existing line, omit to add new line.",
          items: {
            type: "object",
            properties: {
              line_id: {
                type: "string",
                description: "ID of existing line to update (omit for new line)",
              },
              amount: {
                type: "number",
                description: "Line amount (positive number)",
              },
              account_name: {
                type: "string",
                description: "Account name or number (auto-resolved to ID)",
              },
              description: {
                type: "string",
                description: "Line description",
              },
              ...lineCustomerRefEditProperties,
              delete: {
                type: "boolean",
                description: "Set true to remove this line (requires line_id)",
              },
            },
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without saving (default: true)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "create_bill_payment",
    description: "Create a bill payment (the QBO 'check' / 'pay bills' flow). Pays one or more existing bills and optionally applies vendor credits, clearing Accounts Payable. Use this to record vendor ACH/EFT debits or checks so the bank feed can match them — especially when a bank charge equals bills minus credit memos. Amounts default to each bill's open balance and each credit's remaining balance. Returns payment details and a link to view in QuickBooks.",
    inputSchema: {
      type: "object",
      properties: {
        vendor_name: {
          type: "string",
          description: "Vendor display name (e.g., 'US Foods'). Will be looked up to get ID.",
        },
        vendor_id: {
          type: "string",
          description: "Vendor ID (use if you already know it, otherwise use vendor_name)",
        },
        payment_account: {
          type: "string",
          description: "Bank account name or number the payment is drawn from (e.g., 'PLAT BUS CHECKING', '5752'). Will be looked up to get ID.",
        },
        txn_date: {
          type: "string",
          description: "Payment date in YYYY-MM-DD format (use the bank debit date for bank-feed matching)",
        },
        memo: {
          type: "string",
          description: "Private memo for the payment",
        },
        doc_number: {
          type: "string",
          maxLength: 21,
          description: "Reference number, maximum 21 characters, e.g., check number or EFT reference (optional)",
        },
        bills: {
          type: "array",
          description: "Bills to pay. Each bill must belong to the vendor and have an open balance.",
          items: {
            type: "object",
            properties: {
              bill_id: {
                type: "string",
                description: "Bill ID to pay",
              },
              amount: {
                type: "number",
                description: "Amount to apply (optional, defaults to the bill's full open balance)",
              },
            },
            required: ["bill_id"],
          },
        },
        credits: {
          type: "array",
          description: "Vendor credits to apply against the bills (optional). Each credit must belong to the vendor and have remaining balance.",
          items: {
            type: "object",
            properties: {
              vendor_credit_id: {
                type: "string",
                description: "Vendor credit ID to apply",
              },
              amount: {
                type: "number",
                description: "Amount of credit to apply (optional, defaults to the credit's full remaining balance)",
              },
            },
            required: ["vendor_credit_id"],
          },
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without creating (default: true)",
        },
      },
      required: ["payment_account", "txn_date", "bills"],
    },
  },
  {
    name: "get_bill_payment",
    description: "Fetch a single bill payment by ID with full details including SyncToken. Shows vendor, date, pay type, bank account, linked bills/credits with applied amounts, and flags any unapplied amount (payment total not matching net applied lines).",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The bill payment ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "create_vendor",
    description: "Create a QBO vendor master record. Supports identity, contact, billing address, payment terms, account number, and 1099 status. Defaults to draft mode so the vendor is previewed before creation.",
    inputSchema: {
      type: "object",
      properties: {
        ...vendorWriteProperties,
        draft: {
          type: "boolean",
          description: "If true, validate and preview without creating (default: true)",
        },
      },
      required: ["display_name"],
    },
  },
  {
    name: "get_vendor",
    description: "Fetch a Vendor by ID with SyncToken, identity, contact details, billing address, terms, 1099 status, account number, balance, active state, currency, metadata, and a QBO link.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Vendor ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "edit_vendor",
    description: "Modify a Vendor using its latest QBO SyncToken. Omitted fields are preserved. Use explicit clear_* directives to remove optional contact, address, terms, or account-number values. Defaults to draft mode. Set active=true to reactivate a vendor.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Vendor ID to edit",
        },
        ...vendorWriteProperties,
        active: {
          type: "boolean",
          description: "Set true to reactivate or false to deactivate. Prefer deactivate_vendor for an explicit deactivation preview.",
        },
        clear_email: {
          type: "boolean",
          description: "Set true to remove the primary email. Do not combine with email.",
        },
        clear_phone: {
          type: "boolean",
          description: "Set true to remove the primary phone. Do not combine with phone.",
        },
        clear_mobile: {
          type: "boolean",
          description: "Set true to remove the mobile phone. Do not combine with mobile.",
        },
        clear_fax: {
          type: "boolean",
          description: "Set true to remove the fax number. Do not combine with fax.",
        },
        clear_web_address: {
          type: "boolean",
          description: "Set true to remove the website. Do not combine with web_address.",
        },
        clear_bill_address: {
          type: "boolean",
          description: "Set true to remove the billing address. Do not combine with bill_address.",
        },
        clear_terms: {
          type: "boolean",
          description: "Set true to remove the default payment terms. Do not combine with terms_ref.",
        },
        clear_account_number: {
          type: "boolean",
          description: "Set true to remove the vendor account number. Do not combine with account_number.",
        },
        draft: {
          type: "boolean",
          description: "If true, validate and preview without saving (default: true)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "deactivate_vendor",
    description: "Safely deactivate a Vendor using its latest QBO SyncToken. Historical transactions remain unchanged, and the vendor can be reactivated with edit_vendor active=true. Defaults to draft mode.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Vendor ID to deactivate",
        },
        draft: {
          type: "boolean",
          description: "If true, preview without deactivating (default: true)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_entity",
    description: "Permanently delete a QuickBooks transaction. Supports journal entries, bills, invoices, deposits, sales receipts, expenses, vendor credits, and bill payments. Uses a two-step flow: first call previews what will be deleted, second call with confirm=true executes the deletion. Note: Customers cannot be deleted — use edit_customer with active=false to deactivate instead.",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: {
          type: "string",
          enum: ["journal_entry", "bill", "invoice", "deposit", "sales_receipt", "expense", "vendor_credit", "bill_payment", "attachable"],
          description: "The type of entity to delete.",
        },
        id: {
          type: "string",
          description: "The entity ID to delete.",
        },
        confirm: {
          type: "boolean",
          description: "If true, execute the deletion. If false (default), show a preview of what will be deleted.",
        },
      },
      required: ["entity_type", "id"],
    },
  },
  {
    name: "create_customer",
    description: "Create a customer or sub-customer. Accepts name parts, contact info, addresses, and hierarchy settings. Use parent_ref to create sub-customers or jobs. Returns customer details and a link to view in QuickBooks.",
    inputSchema: {
      type: "object",
      properties: {
        display_name: {
          type: "string",
          description: "Primary display name (must be unique in QuickBooks)",
        },
        given_name: {
          type: "string",
          description: "First/given name (optional)",
        },
        middle_name: {
          type: "string",
          description: "Middle name (optional)",
        },
        family_name: {
          type: "string",
          description: "Last/family name (optional)",
        },
        suffix: {
          type: "string",
          description: "Name suffix, e.g., 'Jr.' (optional)",
        },
        company_name: {
          type: "string",
          description: "Company name (optional)",
        },
        email: {
          type: "string",
          description: "Primary email address (optional)",
        },
        phone: {
          type: "string",
          description: "Primary phone number (optional)",
        },
        mobile: {
          type: "string",
          description: "Mobile phone number (optional)",
        },
        bill_address: {
          type: "object",
          description: "Billing address (optional)",
          properties: {
            line1: { type: "string" },
            line2: { type: "string" },
            line3: { type: "string" },
            line4: { type: "string" },
            line5: { type: "string" },
            city: { type: "string" },
            country_sub_division_code: { type: "string", description: "State/province code" },
            postal_code: { type: "string" },
            country: { type: "string" },
            lat: { type: "string" },
            long: { type: "string" },
          },
        },
        ship_address: {
          type: "object",
          description: "Shipping address (optional, same shape as bill_address)",
          properties: {
            line1: { type: "string" },
            line2: { type: "string" },
            line3: { type: "string" },
            line4: { type: "string" },
            line5: { type: "string" },
            city: { type: "string" },
            country_sub_division_code: { type: "string", description: "State/province code" },
            postal_code: { type: "string" },
            country: { type: "string" },
            lat: { type: "string" },
            long: { type: "string" },
          },
        },
        notes: {
          type: "string",
          description: "Notes about the customer (optional)",
        },
        taxable: {
          type: "boolean",
          description: "Whether the customer is taxable (optional)",
        },
        parent_ref: {
          type: "string",
          description: "Parent customer name or ID to create a sub-customer or job. Will be looked up to get ID.",
        },
        job: {
          type: "boolean",
          description: "Mark this customer as a job (default: false). Jobs track work for a parent customer.",
        },
        bill_with_parent: {
          type: "boolean",
          description: "If true, invoices for this sub-customer are billed to the parent (default: false)",
        },
        preferred_delivery_method: {
          type: "string",
          enum: ["Print", "Email", "None"],
          description: "How invoices are delivered: Print, Email, or None",
        },
        sales_term_ref: {
          type: "string",
          description: "Default payment terms name (e.g., 'Net 30'). Will be looked up to get ID.",
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without creating (default: true)",
        },
      },
      required: ["display_name"],
    },
  },
  {
    name: "get_customer",
    description: "Fetch a single customer by ID with full details including SyncToken (needed for edits). Returns name, contact info, addresses, balance, hierarchy (parent/sub-customer), and active status.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The customer ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "edit_customer",
    description: "Modify an existing customer. Can update name, contact info, addresses, notes, taxable status, active status, hierarchy (parent/sub-customer), delivery method, and payment terms. Set active=false to deactivate (QuickBooks equivalent of delete).",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Customer ID to edit",
        },
        display_name: {
          type: "string",
          description: "New display name (must be unique in QuickBooks)",
        },
        given_name: {
          type: "string",
          description: "New first/given name",
        },
        middle_name: {
          type: "string",
          description: "New middle name",
        },
        family_name: {
          type: "string",
          description: "New last/family name",
        },
        suffix: {
          type: "string",
          description: "New name suffix",
        },
        company_name: {
          type: "string",
          description: "New company name",
        },
        email: {
          type: "string",
          description: "New primary email address",
        },
        phone: {
          type: "string",
          description: "New primary phone number",
        },
        mobile: {
          type: "string",
          description: "New mobile phone number",
        },
        bill_address: {
          type: "object",
          description: "New billing address",
          properties: {
            line1: { type: "string" },
            line2: { type: "string" },
            line3: { type: "string" },
            line4: { type: "string" },
            line5: { type: "string" },
            city: { type: "string" },
            country_sub_division_code: { type: "string", description: "State/province code" },
            postal_code: { type: "string" },
            country: { type: "string" },
            lat: { type: "string" },
            long: { type: "string" },
          },
        },
        ship_address: {
          type: "object",
          description: "New shipping address",
          properties: {
            line1: { type: "string" },
            line2: { type: "string" },
            line3: { type: "string" },
            line4: { type: "string" },
            line5: { type: "string" },
            city: { type: "string" },
            country_sub_division_code: { type: "string", description: "State/province code" },
            postal_code: { type: "string" },
            country: { type: "string" },
            lat: { type: "string" },
            long: { type: "string" },
          },
        },
        notes: {
          type: "string",
          description: "New notes about the customer",
        },
        taxable: {
          type: "boolean",
          description: "Whether the customer is taxable",
        },
        active: {
          type: "boolean",
          description: "Set to false to deactivate customer (QuickBooks equivalent of delete)",
        },
        parent_ref: {
          type: "string",
          description: "Parent customer name or ID (makes this a sub-customer). Auto-resolved to ID.",
        },
        job: {
          type: "boolean",
          description: "Mark as a job (tracks work for a parent customer)",
        },
        bill_with_parent: {
          type: "boolean",
          description: "Bill this sub-customer with its parent",
        },
        preferred_delivery_method: {
          type: "string",
          enum: ["Print", "Email", "None"],
          description: "How invoices are delivered: Print, Email, or None",
        },
        sales_term_ref: {
          type: "string",
          description: "Default payment terms name (e.g., 'Net 30'). Auto-resolved to ID.",
        },
        draft: {
          type: "boolean",
          description: "If true, validate and show preview without saving (default: true)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "create_class",
    description: "Create a class for categorizing transactions (e.g., business segments, locations, departments). Classes can be hierarchical — use parent_name or parent_id to create sub-classes. Set active=false to create in deactivated state.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Class name (must be unique at its level)",
        },
        parent_name: {
          type: "string",
          description: "Parent class name to create a sub-class. Looked up by name.",
        },
        parent_id: {
          type: "string",
          description: "Parent class ID to create a sub-class. Use instead of parent_name if you have the ID.",
        },
        active: {
          type: "boolean",
          description: "Whether the class is active (default: true)",
        },
        draft: {
          type: "boolean",
          description: "If true, show preview without creating (default: true)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "get_class",
    description: "Fetch a single class by ID with full details including SyncToken (needed for edits). Returns name, active status, hierarchy (parent/sub-class), and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The class ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "edit_class",
    description: "Modify an existing class. Can update name, active status, and parent. Set active=false to deactivate (QuickBooks does not support deleting classes). Clear parent by passing empty string for parent_name.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Class ID to edit",
        },
        name: {
          type: "string",
          description: "New class name",
        },
        active: {
          type: "boolean",
          description: "Set to false to deactivate class",
        },
        parent_name: {
          type: "string",
          description: "New parent class name. Empty string removes parent (makes top-level).",
        },
        parent_id: {
          type: "string",
          description: "New parent class ID. Use instead of parent_name if you have the ID.",
        },
        draft: {
          type: "boolean",
          description: "If true, show preview without saving (default: true)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "create_attachable",
    description: "Create an attachable — either a file upload or a note. file_path must be an absolute path on the computer running qbo-mcp; files uploaded only to Claude Chat are not automatically available. Maximum 100 MB. At least one of file_path or note is required. Optionally link to a transaction using both entity_type and entity_id.",
    inputSchema: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description: "Absolute path on the qbo-mcp computer. If the active QBO profile defines upload_roots, the file must be inside one of them. Supports QBO-approved PDF, image, Office, CSV, TXT, RTF, XML, ODS, EPS, and AI files.",
        },
        note: {
          type: "string",
          maxLength: 2000,
          description: "Note text. For file uploads, this becomes the file description.",
        },
        entity_type: {
          type: "string",
          enum: ["Bill", "BillPayment", "Customer", "Deposit", "Invoice", "Item", "JournalEntry", "Purchase", "SalesReceipt", "Vendor", "VendorCredit"],
          description: "Entity type to link to (e.g., 'Invoice', 'Bill', 'Purchase', 'JournalEntry')",
        },
        entity_id: {
          type: "string",
          description: "Entity ID to link to. Must be used with entity_type.",
        },
        include_on_send: {
          type: "boolean",
          description: "If true, include this attachment when emailing the linked transaction",
        },
        category: {
          type: "string",
          enum: ["Contact Photo", "Document", "Image", "Receipt", "Signature", "Sound", "Other"],
          description: "QBO category for the attachable (optional; case-sensitive)",
        },
        draft: {
          type: "boolean",
          description: "If true, validate file and show preview without uploading (default: true)",
        },
      },
      required: [],
    },
  },
  {
    name: "list_transaction_attachables",
    description: "List safe metadata for QBO Attachables linked to a specific transaction or entity. Returns attachment IDs, filenames, content types, sizes, notes, categories, timestamps, and links without downloading bytes or exposing signed URLs.",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: {
          type: "string",
          enum: ["Bill", "BillPayment", "Customer", "Deposit", "Invoice", "Item", "JournalEntry", "Purchase", "SalesReceipt", "Vendor", "VendorCredit"],
          description: "QBO entity type whose attachments should be listed",
        },
        entity_id: {
          type: "string",
          description: "Numeric QBO entity ID",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of attachments to return (default: 20; HTTP mode detail is capped at 20)",
        },
      },
      required: ["entity_type", "entity_id"],
    },
  },
  {
    name: "get_attachable",
    description: "Fetch safe attachable metadata by ID. Returns file metadata (name, size, content type), note text, linked entities, and SyncToken for edits. Temporary download URLs are intentionally excluded; use read_attachable_content to inspect file content.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The attachable ID",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "read_attachable_content",
    description: "Download a QBO Attachable through its fresh temporary URL and return content Claude can inspect. Supports bounded UTF-8 text/CSV/XML, JPEG/PNG/GIF images, and locally rendered PDF page images (including scanned PDFs). PDF calls return at most 3 pages and can be repeated with page_start. Downloads are capped at 10 MB in default local mode or 4 MB with inline/HTTP output. Lambda returns PDF metadata only; visual PDF reading requires the local server. Unsupported or oversized files return actionable errors.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Numeric QBO Attachable ID",
        },
        page_start: {
          type: "integer",
          minimum: 1,
          description: "For PDF files, first 1-based page to render (default: 1)",
        },
        page_count: {
          type: "integer",
          minimum: 1,
          maximum: 3,
          description: "For PDF files, number of pages to render (default and maximum: 3)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "edit_attachable",
    description: "Update an attachable's metadata. Can change note text, category, or set an entity link (replaces all existing links). Cannot replace the uploaded file — to change a file, delete and re-create.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Attachable ID to edit",
        },
        note: {
          type: "string",
          maxLength: 2000,
          description: "New note text",
        },
        category: {
          type: "string",
          enum: ["Contact Photo", "Document", "Image", "Receipt", "Signature", "Sound", "Other"],
          description: "New QBO category (case-sensitive)",
        },
        entity_type: {
          type: "string",
          enum: ["Bill", "BillPayment", "Customer", "Deposit", "Invoice", "Item", "JournalEntry", "Purchase", "SalesReceipt", "Vendor", "VendorCredit"],
          description: "Entity type to link to (e.g., 'Invoice', 'Bill'). Replaces all existing links.",
        },
        entity_id: {
          type: "string",
          description: "Entity ID to link to. Must be used with entity_type. Replaces all existing links.",
        },
        include_on_send: {
          type: "boolean",
          description: "Include this attachment when emailing the linked transaction",
        },
        draft: {
          type: "boolean",
          description: "If true, show preview without saving (default: true)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "list_qbo_profiles",
    description: "List all configured QuickBooks company profiles and show which is currently active. " +
      "Returns profile names, credential modes, and company IDs from the config file. " +
      "No QBO API calls are made.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "switch_qbo_profile",
    description: "Switch to a different QuickBooks company profile. " +
      "This changes the active company for all subsequent tool calls. " +
      "Validates the switch by connecting to the new company. " +
      "On failure, automatically rolls back to the previous profile.",
    inputSchema: {
      type: "object",
      properties: {
        profile: {
          type: "string",
          description: "Name of the profile to switch to (as defined in profiles.json)",
        },
      },
      required: ["profile"],
    },
  },
];
