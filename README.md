# QuickBooks MCP Server

An MCP server for QuickBooks Online — built for bookkeepers, CFOs, and accountants who use AI assistants in their daily workflow.

Ask your AI assistant to pull a P&L report, create a journal entry, or investigate an account balance — using plain language, not API payloads.

## Why This Server?

Intuit provides an [official MCP server](https://github.com/intuit/quickbooks-online-mcp-server) that's a solid starting point for developers exploring the QuickBooks API. This server takes a different approach: it's designed for **financial professionals working in production books**.

### Use natural language, not internal IDs

Intuit's server requires QuickBooks internal IDs for every reference — you need to look up a vendor's ID before creating a bill. This server resolves names automatically:

```
"Create a bill for PG&E, $450 to Utilities, dated 2025-01-15"
→ Vendor, account, and department names are resolved automatically
```

### Financial reports built in

This is the only QuickBooks MCP server with report tools. Pull a P&L, Balance Sheet, or Trial Balance — broken down by month, department, or class — without leaving your AI conversation.

### Safe by default

Every create and edit operation defaults to **draft/preview mode**. You see exactly what will be written to your books before committing. No accidental journal entries or misclassified expenses.

### One query tool instead of dozens

Instead of separate search tools for each entity type, a single SQL-like `query` tool works across all QuickBooks entities. AI assistants write SQL naturally, and QuickBooks validates it — no field whitelists to maintain.

```
"SELECT * FROM Purchase WHERE TxnDate >= '2025-01-01' AND TxnDate <= '2025-01-31'"
```

### Production-ready credential management

Store credentials locally for personal use, or in AWS Secrets Manager for shared environments. OAuth tokens refresh automatically and persist across sessions.

### At a glance

| | Intuit Official | This Server |
|--|-----------------|-------------|
| **Audience** | Developers exploring the API | Bookkeepers, CFOs, accountants |
| **Name resolution** | Requires internal QB IDs | Resolves names automatically |
| **Financial reports** | None | P&L, Balance Sheet, Trial Balance |
| **Write safety** | Executes immediately | Draft preview by default |
| **Query approach** | Entity-specific search tools | SQL-like queries across all entities |
| **Credentials** | Local `.env` file | Local file or AWS Secrets Manager |
| **Distribution** | Clone from GitHub | `npx qbo-mcp` |

## Prerequisites

- **QuickBooks Developer Account**: Register at [developer.intuit.com](https://developer.intuit.com)
- **Node.js 18+**

## Installation Options

Choose the setup that fits your use case:

| Setup | Best For |
|-------|----------|
| [NPM Install](#option-1-npm-install) | Quick setup, using your own QuickBooks app |
| [Local Checkout](#option-2-local-checkout) | Development, customization |
| [AWS Mode](#option-3-aws-mode) | Shared/production environments |

---

## Option 1: NPM Install

The simplest way to get started. Credentials are stored locally on your machine.

### 1. Create a QuickBooks App

1. Go to [developer.intuit.com](https://developer.intuit.com) and sign in
2. Create a new app (or select an existing one)
3. Go to "Keys & credentials"
4. Note your **Client ID** and **Client Secret**
5. Under "Redirect URIs", add: `https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl`

### 2. Add to Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "quickbooks": {
      "command": "npx",
      "args": ["-y", "qbo-mcp"]
    }
  }
}
```

### 3. Configure Credentials

Create `~/.qbo-mcp/credentials.json`:

```json
{
  "client_id": "your_client_id",
  "client_secret": "your_client_secret"
}
```

### 4. Authenticate

Once Claude Code is running, use the `qbo_authenticate` tool:

1. Call `qbo_authenticate` with no arguments to get an authorization URL
2. Open the URL in your browser and authorize the app
3. Copy the `code` and `realmId` from the redirect URL
4. Call `qbo_authenticate` again with the authorization code and realm ID

Your OAuth tokens will be saved and automatically refreshed.

---

## Option 2: Local Checkout

For development or customization.

### 1. Create a QuickBooks App

Follow the same steps as Option 1 above.

### 2. Clone and Build

```bash
git clone https://github.com/shawnro/qbo-mcp.git
cd qbo-mcp
npm install
npm run build
```

### 3. Add to Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "quickbooks": {
      "command": "node",
      "args": ["/path/to/qbo-mcp/dist/index.js"]
    }
  }
}
```

### 4. Configure Credentials

Create `~/.qbo-mcp/credentials.json` with your client credentials (same as Option 1), then run `qbo_authenticate` to complete the OAuth flow.

---

## Option 3: AWS Mode

For shared or production environments. Stores credentials in AWS Secrets Manager.

### 1. Create AWS Resources

**Create the secret in Secrets Manager:**

```bash
aws secretsmanager create-secret \
  --name prod/qbo \
  --secret-string '{
    "client_id": "your_client_id",
    "client_secret": "your_client_secret",
    "access_token": "your_access_token",
    "refresh_token": "your_refresh_token",
    "redirect_url": "https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl"
  }'
```

**Store Company ID in SSM Parameter Store:**

```bash
aws ssm put-parameter \
  --name /prod/qbo/company_id \
  --value "your_company_id" \
  --type SecureString
```

### 2. Configure the Server

Create a `.env` file in the qbo-mcp directory:

```bash
QBO_CREDENTIAL_MODE=aws
AWS_REGION=us-east-2
QBO_SECRET_NAME=prod/qbo
QBO_COMPANY_ID_PARAM=/prod/qbo/company_id
```

> **Note**: Due to a [known Claude Code bug](https://github.com/anthropics/claude-code/issues/1254), environment variables from `.mcp.json` are not reliably passed to MCP servers. The `.env` file workaround is required.

### 3. Add to Claude Code

```json
{
  "mcpServers": {
    "quickbooks": {
      "command": "node",
      "args": ["/path/to/qbo-mcp/dist/index.js"]
    }
  }
}
```

### 4. IAM Permissions

The server needs these AWS permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:prod/qbo*"
    },
    {
      "Effect": "Allow",
      "Action": ["ssm:GetParameter"],
      "Resource": "arn:aws:ssm:*:*:parameter/prod/qbo/*"
    }
  ]
}
```

---

## Option 4: Azure Mode

For environments using Azure Key Vault for secret management. Stores all QuickBooks credentials (including company ID) in a single Key Vault secret.

### 1. Create the Key Vault Secret

Store your QuickBooks credentials as a JSON secret in Azure Key Vault:

```bash
az keyvault secret set \
  --vault-name myvault \
  --name qbo-credentials \
  --value '{
    "client_id": "your_client_id",
    "client_secret": "your_client_secret",
    "access_token": "your_access_token",
    "refresh_token": "your_refresh_token",
    "redirect_url": "https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl",
    "company_id": "your_company_id"
  }'
```

### 2. Configure the Server

Create a `.env` file in the qbo-mcp directory:

```bash
QBO_CREDENTIAL_MODE=azure
AZURE_KEY_VAULT_URL=https://myvault.vault.azure.net
```

Optionally override the secret name (default: `qbo-credentials`):

```bash
QBO_SECRET_NAME=my-custom-secret-name
```

### 3. Azure Identity

The provider uses `DefaultAzureCredential` from `@azure/identity`, which supports:

- **Managed Identity** (Azure VMs, App Service, Functions)
- **Azure CLI** (`az login`)
- **Environment variables** (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`)

Ensure the identity has **Secret Get** and **Secret Set** permissions on the Key Vault.

### 4. Add to Claude Code

```json
{
  "mcpServers": {
    "quickbooks": {
      "command": "node",
      "args": ["/path/to/qbo-mcp/dist/index.js"]
    }
  }
}
```

---

## Multi-Company Profiles

If you manage multiple QuickBooks companies, you can configure named profiles to switch between them from a single MCP server instance.

### 1. Create a Profiles Config File

Create `~/.qbo-mcp/profiles.json` (or set `QBO_PROFILES_FILE` to a custom path):

```json
{
  "default": "my-business",
  "profiles": {
    "my-business": {
      "mode": "azure",
      "secret_name": "qbo-my-business",
      "upload_roots": [
        { "label": "AP Invoices", "path": "C:\\Accounting\\My Business\\AP" },
        { "label": "Receipts", "path": "C:\\Accounting\\My Business\\Receipts" }
      ]
    },
    "side-project": {
      "mode": "azure",
      "secret_name": "qbo-side-project"
    },
    "division-a": {
      "mode": "azure",
      "secret_name": "qbo-shared-login",
      "company_id": "1234567890"
    },
    "division-b": {
      "mode": "azure",
      "secret_name": "qbo-shared-login",
      "company_id": "9876543210"
    }
  }
}
```

**Fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `mode` | Yes | Credential provider: `local`, `aws`, or `azure` |
| `secret_name` | Yes (aws/azure) | Provider-specific secret name |
| `company_id` | No | Override company ID (useful when one login has multiple companies) |
| `upload_roots` | No | Labeled absolute folders from which this profile may upload attachments. Paths are not exposed by `list_qbo_profiles`. |
| `default` | Yes (top-level) | Profile to use on startup |

### 2. Use the Profile Tools

- **`list_qbo_profiles`** — Shows all configured profiles and which is active
- **`switch_qbo_profile`** — Switches to a different company (validates the connection)

### Notes

- If the profiles file does not exist, the server runs in single-company mode (backward compatible)
- If the profiles file exists but is malformed, the server fails at startup with a descriptive error
- Switching profiles clears all cached data (accounts, departments, etc.)
- Attachment paths are checked against the active profile's `upload_roots`; different businesses can authorize entirely different folder structures
- Missing/offline upload roots do not prevent server startup or use of other configured roots
- On switch failure, the server automatically rolls back to the previous profile

---

## Inline Output Mode

By default, large responses (reports, query results) are written to `/tmp` files and the server returns a file path. This works well for Claude Code in terminal environments but breaks in **Claude Desktop** and **plugin environments** where the model cannot read from `/tmp`.

Set `QBO_INLINE_OUTPUT=true` to return bounded responses inline instead. Hosted HTTP uses the same inline policy automatically.

Inline output protects the model context as follows:

- Generic queries return at most 100 records per request, including when a larger `MAXRESULTS` is supplied. Use `STARTPOSITION` to continue.
- Profit & Loss, Balance Sheet, and Trial Balance reports return at most 100 detail rows. Totals and section summaries are calculated from and preserved from the full QBO response.
- Inline JSON above 100,000 serialized characters is replaced by compact size metadata and guidance to narrow or paginate the request.

Default stdio mode still writes the complete response to a temporary file; these inline limits do not truncate that file.

**Option A — via `.env` file** (recommended for local checkout):

Create a `.env` file in the qbo-mcp directory:

```bash
QBO_INLINE_OUTPUT=true
```

**Option B — via `.mcp.json` env block** (recommended for NPM install):

```json
{
  "mcpServers": {
    "quickbooks": {
      "command": "npx",
      "args": ["-y", "qbo-mcp"],
      "env": {
        "QBO_CREDENTIAL_MODE": "local",
        "QBO_CREDENTIAL_FILE": "~/.qbo-mcp/credentials.json",
        "QBO_INLINE_OUTPUT": "true"
      }
    }
  }
}
```

> **Note**: Due to a [known Claude Code bug](https://github.com/anthropics/claude-code/issues/1254), environment variables from `.mcp.json` are not reliably passed to MCP servers in some configurations. If Option B doesn't work, use the `.env` file workaround.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QBO_CREDENTIAL_MODE` | `local` | Credential storage: `local`, `aws`, or `azure` |
| `QBO_CLIENT_ID` | - | QuickBooks app Client ID (local mode) |
| `QBO_CLIENT_SECRET` | - | QuickBooks app Client Secret (local mode) |
| `QBO_CREDENTIAL_FILE` | `~/.qbo-mcp/credentials.json` | Custom credential file path |
| `QBO_INLINE_OUTPUT` | `false` | Return bounded responses inline instead of writing complete data to `/tmp` files. Required when using Claude Desktop or plugin environments where file-based output is not accessible to the model. |
| `QBO_SANDBOX` | `false` | Use QuickBooks sandbox environment |
| `QBO_REQUEST_TIMEOUT_MS` | `60000` | Maximum wait for a QuickBooks callback, from 1 to 600000 ms. Hosted deployments should keep this below the platform request timeout. |
| `AWS_REGION` | `us-east-2` | AWS region (aws mode) |
| `QBO_SECRET_NAME` | `prod/qbo` | Secrets Manager secret name (aws mode) |
| `QBO_COMPANY_ID_PARAM` | `/prod/qbo/company_id` | SSM parameter path (aws mode) |
| `AZURE_KEY_VAULT_URL` | - | Key Vault URI, e.g. `https://myvault.vault.azure.net` (azure mode) |
| `QBO_COMPANY_ID` | - | Fallback company ID if not in Key Vault secret (azure mode) |
| `QBO_PROFILES_FILE` | `~/.qbo-mcp/profiles.json` | Path to multi-company profiles config |
| `QBO_UPLOAD_ROOTS` | - | Optional platform-delimited attachment roots for single-company mode (Windows uses `;`). Profile roots take precedence. |
| `QBO_DISABLE_CREATE` | `false` | Hide all `create_*` tools (read-only mode for creates) |
| `QBO_DISABLE_UPDATE` | `false` | Hide all `edit_*` tools (prevent modifications) |
| `QBO_DISABLE_DELETE` | `false` | Hide `delete_entity` tool (prevent deletions) |
| `MCP_PUBLIC_BASE_URL` | - | Required canonical base URL for hosted HTTP, including any API Gateway stage path |
| `MCP_SINGLE_REPLICA` | - | Must be `true` for hosted HTTP until distributed token-refresh coordination is available |
| `MCP_AUTH_JWKS_URI` | - | HTTPS JWKS endpoint for hosted bearer-token validation |
| `MCP_AUTH_AUDIENCE` | - | Required JWT audience for hosted authentication |
| `MCP_AUTH_ISSUER` | - | Required HTTPS JWT issuer for hosted authentication |
| `MCP_AUTH_SCOPE` | - | Optional required JWT scope |
| `MCP_AUTH_SERVER_URL` | - | Optional OAuth authorization-server URL for hosted interactive login proxy |
| `MCP_RESOURCE_NAME` | `QuickBooks MCP Server` | Display name in protected-resource metadata |
| `MCP_AUTH_DISABLED` | `false` | Explicitly allow anonymous hosted MCP access; cannot be combined with auth/OAuth settings |

### Hosted HTTP Security and Capabilities

Hosted HTTP deployments require `MCP_PUBLIC_BASE_URL`. Use the externally reachable base URL and include the stage path for a raw API Gateway endpoint, for example `https://abc123.execute-api.us-east-2.amazonaws.com/prod`. OAuth and protected-resource URLs are built only from this trusted value, never from an incoming `Host` header.

Authentication is fail-closed. Configure `MCP_AUTH_JWKS_URI`, `MCP_AUTH_AUDIENCE`, and `MCP_AUTH_ISSUER` together. Missing, partial, malformed, or conflicting settings return a bounded `503 configuration_error`; they never make the server anonymous. `MCP_AUTH_DISABLED=true` is an explicit development option and disables OAuth discovery and proxy routes.

The hosted transport uses one configured QuickBooks company per endpoint. Local stdio retains named profiles, `qbo_authenticate`, profile switching, and local file uploads. Hosted clients do not see or invoke those process-local tools. `create_attachable` remains available remotely for notes and entity links, but not for `file_path` uploads because a hosted process cannot read files from a customer's computer. Multi-company customers can register one hosted endpoint per company; secure in-process hosted multi-company selection requires a later principal-to-company authorization and state-isolation layer.

Hosted deployments must currently run as one process/replica and set `MCP_SINGLE_REPLICA=true`. Refresh coordination is process-local, so Lambda reserved concurrency and container replica limits must both be one. Do not scale a hosted endpoint beyond one replica until distributed refresh locking is implemented and validated; that work is planned with the Azure deployment adapters.

Remote routing, authentication, OAuth, CORS, MCP lifecycle, and capability policy live in a provider-neutral Web `Request` to `Response` application. AWS Lambda is an API Gateway adapter over that application; Azure Functions and Node/container adapters can use the same core without duplicating accounting or security policy.

QuickBooks callback operations have a configurable deadline through `QBO_REQUEST_TIMEOUT_MS`. A deadline stops the MCP request from waiting but cannot cancel a request already sent by `node-quickbooks`. Timed-out reads and draft previews can be retried. A timed-out committed mutation returns `indeterminate_result` and is never replayed automatically; verify the record in QuickBooks before deciding whether to retry.

---

## Available Tools

| Tool | Description |
|------|-------------|
| **Setup** | |
| `qbo_authenticate` | Set up OAuth credentials (local mode only) |
| `get_company_info` | Get connected company information |
| **Query & Reports** | |
| `query` | Run SQL-like queries against any QuickBooks entity |
| `list_accounts` | List chart of accounts with filtering |
| `get_profit_loss` | Profit & Loss report (by month, department, class, etc.) |
| `get_balance_sheet` | Balance Sheet report |
| `get_trial_balance` | Trial Balance report |
| `query_account_transactions` | Authoritative General Ledger postings for an account, with Cash/Accrual and department filters |
| `account_period_summary` | GL period summary for an account (opening/closing balance, normalized debits/credits, count) |
| **Journal Entries** | |
| `create_journal_entry` | Create a journal entry (validates debits = credits) |
| `get_journal_entry` | Fetch a journal entry by ID |
| `edit_journal_entry` | Modify an existing journal entry |
| **Bills** | |
| `create_bill` | Create a vendor bill; account lines support optional customer/job tracking |
| `get_bill` | Fetch a bill by ID, including line customer/job and billable status |
| `edit_bill` | Modify a bill and preserve, assign, change, or clear account-line customer/jobs |
| **Expenses** | |
| `create_expense` | Create an expense (Cash, Check, or Credit Card) with optional line customer/job tracking |
| `get_expense` | Fetch an expense by ID, including line customer/job and billable status |
| `edit_expense` | Modify an expense and preserve, assign, change, or clear account-line customer/jobs |
| **Sales Receipts** | |
| `create_sales_receipt` | Create a sales receipt with item lines |
| `get_sales_receipt` | Fetch a sales receipt by ID |
| `edit_sales_receipt` | Modify an existing sales receipt |
| **Invoices** | |
| `create_invoice` | Create an invoice with item lines (customer required) |
| `get_invoice` | Fetch an invoice by ID |
| `edit_invoice` | Modify an existing invoice |
| **Deposits** | |
| `create_deposit` | Create a bank deposit |
| `get_deposit` | Fetch a deposit by ID |
| `edit_deposit` | Modify an existing deposit |
| **Vendor Credits** | |
| `create_vendor_credit` | Create a vendor credit with optional line customer/job tracking |
| `get_vendor_credit` | Fetch a vendor credit by ID, including line customer/job and billable status |
| `edit_vendor_credit` | Modify a vendor credit and preserve, assign, change, or clear account-line customer/jobs |
| **Bill Payments** | |
| `create_bill_payment` | Pay bills and apply vendor credits (the QBO "check" / pay-bills flow) |
| `get_bill_payment` | Fetch a bill payment by ID; flags unapplied amounts |
| **Vendors** | |
| `create_vendor` | Create a vendor master record with contact, address, terms, account number, and 1099 details |
| `get_vendor` | Fetch a vendor by ID with SyncToken, contact details, balance, active state, and metadata |
| `edit_vendor` | Modify vendor details, explicitly clear optional values, or reactivate an inactive vendor |
| `deactivate_vendor` | Safely deactivate a vendor while preserving historical transactions; draft-first and reversible |
| **Delete** | |
| `delete_entity` | Delete any transaction (journal entry, bill, invoice, deposit, sales receipt, expense, vendor credit, bill payment, attachable) |
| **Classes** | |
| `create_class` | Create a class for categorizing transactions (supports sub-classes) |
| `get_class` | Fetch a class by ID |
| `edit_class` | Modify a class (name, active status, parent). Deactivate instead of delete. |
| **Attachables** | |
| `create_attachable` | Create an attachable — upload a local file or add a note, optionally linked to a transaction |
| `list_transaction_attachables` | List safe metadata for attachments linked to a QBO transaction or entity |
| `get_attachable` | Fetch safe attachable metadata by ID; temporary download URLs are excluded |
| `read_attachable_content` | Safely download QBO attachment content for Claude to inspect (text, images, and PDFs) |
| `edit_attachable` | Update attachable metadata (note, category, entity links). Cannot replace files. |
| **Profiles** | |
| `list_qbo_profiles` | List all configured company profiles and show which is active |
| `switch_qbo_profile` | Switch to a different company profile |

---

## Account Ledger Workflow

`query_account_transactions` and `account_period_summary` use QuickBooks' General Ledger report as the accounting source of truth. This includes control-account entries, item-inherited accounts, bill payments, vendor credits, credit memos, and other posting types without reconstructing them from selected entity APIs.

- `query_account_transactions` returns read-only postings with QBO transaction IDs, document number, counterparty, memo, split account, debit/credit, amount, running balance, and a direct QBO link when the report type has a known route.
- Use `accounting_method: "Accrual"` (default) or `"Cash"`; QBO applies the selected basis server-side.
- Optional department/location filtering is also applied by the report endpoint.
- GL report amounts are changes in each account's normal balance. qbo-mcp normalizes them so returned posting amounts use a consistent convention: positive = debit, negative = credit. `rawReportAmount` is retained for auditability.
- Report postings do not contain editable line IDs or SyncTokens. Fetch the source Bill, Invoice, Journal Entry, etc. before any edit.
- QBO does not publish report pagination or a total-row/truncation indicator. For high-volume accounts, use narrower date ranges; qbo-mcp reports the row count and warns on large responses rather than silently treating failed entity queries as empty activity.

---

## File Attachment Workflow

`create_attachable` can upload a file from the computer running qbo-mcp and link it to an existing QBO transaction. A file uploaded only into ordinary Claude Chat is not automatically available to local MCP tools; provide the original absolute local path, or use Claude Cowork with the relevant business folder connected.

Recommended Bill workflow:

1. Select or confirm the correct QBO profile.
2. Create the Bill and retain its returned ID.
3. Call `create_attachable` with the absolute `file_path`, `entity_type: "Bill"`, and the Bill ID.
4. Review the draft and call again with `draft: false`.
5. Use `get_attachable` to verify metadata and the QBO link.

Attachment safeguards and limitations:

- Profile-specific `upload_roots` can authorize multiple existing business folders; no shared staging folder is required.
- Paths must be absolute, canonical, readable, non-symlink files within the active profile's configured roots when roots are present.
- QBO-approved business-document types only; maximum 100 MB; dotfiles and credential/secret files are blocked.
- `entity_type` and `entity_id` must be provided together.
- File upload is performed first, then linking/note/category metadata is applied in one controlled update. If that update fails, the tool returns the created Attachable ID so `edit_attachable` can recover without uploading a duplicate.
- `edit_attachable` replaces the complete entity-link array.
- Uploaded file bytes cannot be replaced; delete and recreate the Attachable.
- QBO temporary download URLs expire after approximately 15 minutes.
- Lambda/HTTP servers cannot access files on a user's local computer through `file_path`.

To verify a transaction against an attachment already stored in QBO:

1. Call the transaction getter, such as `get_bill`.
2. Call `list_transaction_attachables` with the transaction type and ID.
3. Select the relevant attachment ID and call `read_attachable_content`.
4. Ask Claude to compare vendor/payee, document number, dates, total, and line details. Reading is non-mutating; any correction remains a separate draft-first edit.

Content-reading limits:

- Text, CSV, and XML must be UTF-8 and are limited to 256 KB to protect Claude's context budget.
- JPEG, PNG, GIF, and PDF downloads are limited to 10 MB in default local stdio mode and 4 MB when inline/HTTP output is enabled.
- Attachment metadata lists are capped at 20 records in HTTP mode and clearly report when a larger requested limit was reduced.
- Images are returned as MCP image content. In the local server, PDFs are rendered to JPEG page images and returned through the same native image channel, including image-only scanned PDFs.
- PDF reads render at most three pages per call. Use `page_start` to continue with later pages and `page_count` to request one to three pages.
- The stateless Lambda transport returns PDF metadata and directs visual PDF analysis to the local server; native rendering dependencies are not included in the Lambda artifact.
- QBO-signed URLs are fetched server-side, are never returned by metadata tools or accepted from user input, and are refreshed once after expiry.
- Office and other binary files remain available as metadata but are not yet parsed for Claude.

---

## Line-Level Customer and Job Tracking

Account-based lines on bills, expenses, and vendor credits can be associated with a customer, sub-customer, or job without making the line billable.

- On create, provide either `customer_name` or `customer_id` on a line.
- For nested jobs, `customer_name` accepts the fully qualified form `Customer:Job:Sub-job`.
- On edit, omitting customer fields preserves the existing `CustomerRef`.
- Use `customer_name` or `customer_id` to assign or replace the reference.
- Use `clear_customer: true` on an existing line to remove a non-billable reference.
- Customer mutations apply only to `AccountBasedExpenseLineDetail`; item-based expense lines are left unchanged.

Customer/job tracking is independent from QBO's billable-expense workflow. New tagged lines remain `NotBillable`, writable `BillableStatus` is not exposed, `HasBeenBilled` lines cannot be reassigned, and a `Billable` line cannot have its customer cleared.

Line edits use QBO full updates. The handlers preserve required header references, linked transactions, currency/tax fields, and untouched nested line metadata. Customer/job creation, replacement, and clearing were validated with disposable QBO sandbox bills, expenses, and vendor credits; unrelated header and line metadata remained unchanged.

---

## Token Refresh

The server automatically refreshes OAuth tokens on each request and persists them back to your credential store (local file or AWS Secrets Manager).

---

## Development

```bash
npm run dev      # Run in development mode
npm run build    # Build
npm run typecheck # Type check
```

---

## Troubleshooting

### "QuickBooks credentials not configured"

Run the `qbo_authenticate` tool to set up OAuth credentials (local mode only).

### "Authorization code expired"

Authorization codes are only valid for a few minutes. Start the OAuth flow again.

### Token refresh fails

- Check that your refresh token hasn't expired (~100 days)
- Verify your client credentials are correct
- Try re-authenticating with `qbo_authenticate`

### AWS credential errors

- Ensure `.env` file has `QBO_CREDENTIAL_MODE=aws`
- Check your AWS credentials and permissions
- Verify the secret and parameter names match your configuration
