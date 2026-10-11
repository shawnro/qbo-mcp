# QuickBooks MCP Server

## Project Overview

This is a Model Context Protocol (MCP) server that gives compatible AI clients access to QuickBooks Online. It can query, create, and edit accounting data including journal entries, bills, expenses, and reports.

## Git Workflow

This repository uses a branch-and-PR workflow. Never commit directly to `master`; all changes land through a pull request.

- "Commit and push" means: branch from the latest `origin/master`, commit, push, and open a PR to `master`. Stop after opening the PR; do not auto-merge.
- Start from an up-to-date baseline: `git fetch origin && git switch -c <branch> origin/master`.
- Name branches `type/short-desc` using `feat/`, `fix/`, `docs/`, `chore/`, or `refactor/`.
- Give the PR a descriptive title and a body explaining what changed and why.
- Use `closes #N` in commit messages when applicable.
- Use a short imperative commit subject and explain the reason in the body.

## Architecture

```text
src/
|- index.ts           # MCP server entry point (stdio)
|- lambda.ts          # Thin API Gateway adapter
|- http/              # Provider-neutral Request -> Response application
|- client/            # QuickBooks API client and caching
|- credentials/       # Credential providers and OAuth client
|- query/              # Query helpers and pagination
|- reports/            # Report extraction helpers
|- runtime/            # Company runtime and refresh coordination
|- tools/
|  |- definitions.ts   # Tool schema definitions
|  |- index.ts         # Registry, handlers, auth retry dispatcher
|  `- handlers/        # Tool implementations
|- types/              # TypeScript definitions
`- utils/              # Files, URLs, money, output, validation
```

## Key Conventions

### Money

Use integer cents for all monetary calculations:

```typescript
import { validateAmount, sumCents, validateBalance } from "./utils/index.js";

const cents = validateAmount(amount, "Line description");
const totalCents = sumCents([amountACents, amountBCents]);
validateBalance(debitsCents, creditsCents);
```

### Authoritative Account Ledger Reads

`query_account_transactions` and `account_period_summary` use QBO's General Ledger report. The shared normalizer validates report columns and rows; separate projections produce posting detail and period summaries.

GL `Amount` is a normal-balance delta. Normalize debit and credit signs using `AccountType`: a positive amount is a debit only for debit-normal accounts and a credit for credit-normal accounts. Returned postings use positive debit and negative credit; `rawReportAmount` preserves QBO's value. Never infer editable line IDs from report rows; fetch the source entity before editing.

### Draft Writes

All create and edit tools default to `draft: true`. A committed write requires an explicit `draft: false`. Preserve this safeguard in new write tools.

### Name Resolution

Account, department, vendor, item, customer, and class resolution is ambiguity-safe and company-scoped. Resolve by ID or account number, then exact name, then one unique partial match. Return bounded candidates for ambiguity; never select the first partial match.

### Adding Tools

A new tool normally requires updates to:

1. `src/tools/handlers/<name>.ts`
2. `src/tools/handlers/index.ts`
3. `src/tools/definitions.ts`
4. `src/tools/index.ts`
5. The Available Tools table in `README.md`

Follow the closest existing tool. Use `outputReport()` for returned data. Encode structural contracts in JSON Schema, including non-empty identities, mutually exclusive and paired fields, and create-versus-edit requirements. `executeTool()` validates every invocation against that schema before credential access or handler dispatch. Add MCP SDK `AjvJsonSchemaValidator` fixtures for cross-field schema rules, and retain defensive handler checks for direct callers. Keep QBO-state-dependent and arithmetic validation authoritative in handlers.

### Output Budgets

`outputReport()` is transport-aware:

- stdio writes full data to a temporary file and returns summary text plus its path.
- HTTP returns bounded inline JSON. Generic queries and financial-report detail are capped at 100 records or rows, with a 100,000-character serialized backstop.

Local stdio report retention is write-triggered: report writes periodically remove expired files and abandoned report directories older than seven days. Preserve directories owned by live MCP processes; do not add timers, watchers, or scheduled cleanup tasks.

For large outputs, compute summaries from all data, then cap HTTP detail with `isHttpMode()` from `src/utils/output.ts`. Include original and returned counts plus continuation guidance. Do not use the generic size backstop as a substitute for a useful tool-specific projection.

Generic query results must pass through the shared privacy projection before output. Preserve accounting workflow fields, but remove tax/employer identifiers, payment-bank details, signed attachment URLs, and opaque extension metadata. CompanyInfo and Attachable queries must reuse their dedicated allowlisted projections.

### Hosted HTTP Boundary

The shared `src/http/` application owns remote routing, authentication, OAuth, CORS, canonical URLs, MCP lifecycle, and hosted capabilities. Host adapters only translate native request and response shapes.

Hosted mode requires `MCP_PUBLIC_BASE_URL`, `MCP_SINGLE_REPLICA=true`, and complete JWT settings unless anonymous mode is explicitly enabled with `MCP_AUTH_DISABLED=true`. It is one QBO company per endpoint. Enforce unavailable capabilities in both `tools/list` and `tools/call`.

Local stdio retains profile switching, local OAuth setup, and local file uploads.

### OAuth Refresh Coordination

Local stdio uses `proper-lockfile` under `~/.qbo-mcp/refresh-locks` to coordinate processes running as the same OS user on one machine. Lock scopes identify the credential store, not a profile display name. After acquiring the lock, re-read credentials and compare their fingerprint before contacting Intuit.

Never automatically replay OAuth token requests. Write a durable non-secret attempt journal before refresh and clear it only after persisting rotated credentials. An unresolved or malformed journal fails closed and requires deliberate reauthorization. `qbo_authenticate` uses the same lock and clears the journal only after replacement credentials are saved.

Hosted HTTP coordination remains process-local and requires `MCP_SINGLE_REPLICA=true`. Future Azure coordination requires a renewable Blob lease, durable shared attempt record, and stale-holder write protection; a Blob lease alone is insufficient. AWS can use a conditional DynamoDB lease. See `docs/oauth-refresh-coordination.md`.

## Common Files

| Task | File |
|---|---|
| Query behavior | `src/query/pagination.ts` |
| Money utilities | `src/utils/money.ts` |
| QBO API client | `src/client/quickbooks.ts` |
| OAuth refresh transaction | `src/runtime/credential-refresh.ts` |
| Local refresh coordination | `src/runtime/file-refresh-coordinator.ts` |
| Output mode | `src/utils/output.ts` |

## Critical Limitations

### Departments on Expenses

QBO Purchases support one department at the header level, not a department per line. Split the transaction or use a reclassification journal entry when charges span locations.

Expense edits preserve header `AccountRef`, `EntityRef`, `DepartmentRef`, currency and tax metadata, linked transactions, and untouched line-detail fields.

### Customer and Job Tracking

Account-based lines on bills, expenses, and vendor credits support `customer_name` or `customer_id`, including fully qualified names such as `Customer:Job`.

- Omit customer fields to preserve `CustomerRef`.
- Provide a name or ID to assign or replace it.
- Use `clear_customer: true` to remove it from an existing non-billable line.
- Do not combine customer directives with `delete: true`.
- Customer tagging does not make a line billable. Do not reassign `HasBeenBilled` lines or clear customers from `Billable` lines.

### Classes

- Classes are hierarchical P&L tracking categories, up to five levels deep.
- QBO infers `SubClass: true` from `ParentRef`; do not send it explicitly.
- Classes cannot be deleted; deactivate them with `active: false`.
- Journal entry, bill, expense, vendor credit, deposit, invoice, and sales receipt lines support `class_name` or `class_id`.
- Edits preserve omitted `ClassRef`; use `clear_class: true` for explicit removal.
- Journal entry entity IDs must be positive numeric QBO IDs. Line ID `"0"` is valid.

### Attachables

- Use the upload-only `node-quickbooks` overload, then one controlled sparse update for links, `IncludeOnSend`, note, and category. Never pass empty strings for entity type or ID.
- `edit_attachable` replaces the full `AttachableRef` array.
- Supply `entity_type` and `entity_id` together.
- Upload paths must be absolute, canonical, non-symlink files within configured roots. Dotfiles, credential files, secret-key extensions, and unsupported file types are blocked.
- The QBO file-size limit is 100 MB. Uploaded bytes cannot be replaced; delete and recreate the attachment.
- Chat uploads are not necessarily exposed as local MCP paths. Use an original local path or a client feature that explicitly provides connected-folder access.
- Hosted HTTP cannot access a user's local filesystem through `file_path`.
- Attachment getters return allowlisted metadata without signed URLs.
- Content reads accept only QBO-issued URLs and bounded supported content. Local PDF reads render up to three pages at a time; Lambda returns PDF metadata only.
- Verify attachments read-only. Require a separate draft-first edit for corrections.

## Build and Validation

Use Node.js 24.x. The package, CI, and Lambda bundle target this LTS major.

```bash
npm test
npm run build
npm run build:lambda
git diff --check
npm pack --dry-run
```

Both builds must pass before committing. Run focused tests first, then broaden validation according to risk. Use the package dry run for packaging or release-facing changes. Check editor diagnostics for touched files. Restart any long-running MCP process after rebuilding before integration validation.

All node-quickbooks callbacks and local operation queue waits use `QBO_REQUEST_TIMEOUT_MS`, defaulting to 60 seconds. An expired queued request is skipped. A callback deadline does not cancel an upstream request. Reads receive at most one automatic retry for narrowly classified transient failures; previews are not transport-retried. Committed mutations return `indeterminate_result` for ambiguous outcomes and must never be replayed automatically.

## QuickBooks API Notes

- All updates require `SyncToken` for optimistic concurrency.
- Some sparse updates require additional fields, including `VendorRef` for Bills and `PaymentType` for Purchases.
- Department filtering must be performed client-side where QBO queries do not support it.
- See `docs/quickbooks-api-limitations.md` for verified upstream behavior.