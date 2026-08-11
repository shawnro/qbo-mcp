# QuickBooks MCP Server

## Project Overview

This is a Model Context Protocol (MCP) server that provides Claude with access to QuickBooks Online. It enables Claude to query, create, and edit accounting data including journal entries, bills, expenses, and reports.

## Git Workflow

This repo uses a branch-and-PR workflow — **never commit directly to `master`**. All changes land via pull request.

- **"commit and push"** means: branch off the latest `master`, commit, push, and open a PR to `master` with `gh pr create`. Then stop — PRs wait for review; do not auto-merge.
- Start from an up-to-date master: `git fetch origin && git switch -c <branch> origin/master`.
- **Branch naming**: `type/short-desc` — `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`. E.g. `fix/scraper-popup`, `chore/bump-deps`.
- Give the PR a descriptive title and a body summarizing what changed and why.

## Architecture

```
src/
├── index.ts           # MCP server entry point (stdio)
├── lambda.ts          # Thin API Gateway adapter
├── http/              # Provider-neutral Request → Response application
├── client/            # QuickBooks API client and caching
├── types/             # TypeScript type definitions
├── utils/             # Utility functions (files, URLs, money, output)
├── query/             # Query helpers and pagination
├── reports/           # Report extraction helpers (P&L, Balance Sheet)
└── tools/
    ├── definitions.ts # All tool schema definitions (single file)
    ├── index.ts       # Tool registry, handler map, auth retry dispatcher
    └── handlers/      # One file per tool (or per entity group)
```

## Key Conventions

### Cents-Based Money Handling

All monetary calculations use integer cents to avoid floating-point precision errors:

```typescript
import { validateAmount, toCents, toDollars, sumCents, validateBalance } from "./utils/index.js";

// Validate input (rejects >2 decimal places)
const cents = validateAmount(amount, "Line description");  // throws if 10.001

// Sum safely (integer addition)
const totalCents = sumCents([amountACents, amountBCents]);

// Journal entries must balance exactly
validateBalance(debitsCents, creditsCents);  // throws if not equal
```

### Authoritative Account Ledger Reads

`query_account_transactions` and `account_period_summary` use QBO's General Ledger report rather than manually reconstructing postings from selected transaction entities. A shared low-level normalizer validates report columns and rows; separate projections produce posting detail and period summaries.

GL `Amount` is a normal-balance delta, so debit/credit normalization must use `AccountType`: positive means debit only for debit-normal accounts, while positive means credit for credit-normal accounts. Returned account-posting amounts use positive debit / negative credit; `rawReportAmount` preserves QBO's value. Do not infer editable line IDs from report rows—fetch the source entity before edits.

### Draft Mode for Writes

All write operations (create/edit) default to `draft: true`:
- Shows a preview of what would be created/modified
- User must explicitly set `draft: false` to commit changes
- Prevents accidental modifications to accounting data

### Account/Department Resolution

Names are auto-resolved to IDs using cached lookups:
- `account_name: "Tips"` → looks up ID from cache
- `department_name: "Santa Rosa"` → looks up ID from cache
- Caches are session-scoped with TTL

## Adding a New Tool

Every new tool requires changes in **4 files** plus README:

1. **`src/tools/handlers/<name>.ts`** — Create handler function
2. **`src/tools/handlers/index.ts`** — Add barrel export
3. **`src/tools/definitions.ts`** — Add tool schema (name, description, inputSchema)
4. **`src/tools/index.ts`** — Import handler + register in `toolHandlers.set()`
5. **`README.md`** — Add row to Available Tools table

Follow the pattern of the nearest existing tool. Use `outputReport()` for any tool that returns data (handles stdio vs HTTP mode automatically).

### HTTP Mode Context Budget

`outputReport()` behaves differently by transport:
- **stdio**: Writes full data to a temp file, returns summary text + filepath. Data never enters LLM context.
- **HTTP**: Returns summary text + **inline JSON**. Everything in the data object goes directly into the LLM's context window.

When building the `reportData` object passed to `outputReport()`, ask: **does the HTTP user need this data inline?**
- **Yes**: Structured summaries, metadata, entity objects needed for follow-up edits (SyncToken, line IDs)
- **No**: Raw API responses, full transaction lists for summary-only tools, redundant data the summary already covers

For tools that return large datasets, cap the detail for HTTP mode using `isHttpMode()` from `src/utils/output.ts`. Compute summaries from the full data, then truncate the detail. See `account-transactions.ts` (`HTTP_TXN_LIMIT`) for the pattern.

### Hosted HTTP Boundary

The shared `src/http/` application owns remote routing, auth, OAuth, CORS, canonical URLs, MCP lifecycle, and hosted capabilities. Host adapters only convert their native request/response shapes. Hosted configuration requires `MCP_PUBLIC_BASE_URL` and complete JWT settings unless anonymous mode is explicitly enabled with `MCP_AUTH_DISABLED=true`.

Local stdio keeps profile switching, local OAuth setup, and local file uploads. Hosted HTTP is one QBO company per endpoint and must enforce unavailable capabilities in both `tools/list` and `tools/call`.

## Common Files

| Task | File |
|------|------|
| Change query behavior | `src/query/pagination.ts` |
| Money utilities | `src/utils/money.ts` |
| API client | `src/client/quickbooks.ts` |
| Output mode (stdio/http) | `src/utils/output.ts` |

## Critical Limitations

### Expenses Use One Header-Level Department

QBO expenses (Purchases) only support **one department at the header level**. You cannot create an expense with lines in different departments. If a charge covers multiple locations:
- **Use a reclassification JE** to move amounts between departments after the fact.
- **Use the bill-splitting workflow** (frontend) to create separate per-department bills from a single vendor invoice.

`edit_expense` line updates preserve header `AccountRef`, `EntityRef`, `DepartmentRef`, currency/tax metadata, linked transactions, and untouched line-detail fields. Customer assignment, replacement, and clearing were validated against disposable QBO sandbox bills, expenses, and vendor credits.

### Line-Level Customer/Job Tracking

Account-based lines on bills, expenses, and vendor credits support optional `customer_name` or `customer_id`. Fully qualified names such as `Customer:Job` resolve nested jobs. Edit behavior is explicit:
- Omit customer fields to preserve the existing `CustomerRef`
- Provide a name or ID to assign/replace it
- Use `clear_customer: true` to remove it from an existing non-billable line
- Do not combine customer directives with `delete: true`

Customer tagging does not make a line billable. New tagged lines remain `NotBillable`; `HasBeenBilled` lines cannot be reassigned, and `Billable` lines cannot have their customer cleared.

## Building and Testing

```bash
npm run build         # Compile TypeScript (tsc)
npm run build:lambda  # Bundle for Lambda (esbuild → dist-lambda/handler.mjs)
npm run watch         # Watch mode for development
```

Both builds must pass before committing. After changes, restart Claude Code to reload the MCP server.

## Workflow

- Feature backlog is tracked in `wmc-reconcile/docs/qbo-mcp-backlog.md` — move items to Completed when done
- Use `closes #N` in commit messages to auto-close GitHub issues
- Commit messages: short imperative subject, body explains the "why"

## QuickBooks API Notes

- All updates require `SyncToken` for optimistic concurrency
- Some entities require additional fields for sparse updates:
  - Bill: `VendorRef`
  - Purchase (Expense): `PaymentType`
- Department/Location filtering must be done client-side (not in QB queries)
- See `docs/quickbooks-api-limitations.md` for details

### Classes

- Classes are tracking categories for P&L segmentation (hierarchical, up to 5 levels)
- QBO infers `SubClass: true` from presence of `ParentRef` — do NOT send it explicitly
- Classes cannot be deleted — deactivate with `active: false` via `edit_class`
- Parent resolution accepts name (case-insensitive lookup) or numeric ID

### Attachables

- File upload uses `node-quickbooks` `upload()` method (multipart/form-data)
- qbo-mcp deliberately uses the upload-only overload, then performs one controlled sparse update for links, `IncludeOnSend`, note, and category. This preserves the created Attachable ID on partial failure and prevents duplicate-upload auth retries.
- `upload()` has an overloaded signature: callback as 4th arg means upload-only; never pass empty strings for entity type/ID.
- `edit_attachable` **replaces** the entire `AttachableRef` array (does not append)
- `entity_type` and `entity_id` must be supplied together
- File paths must be absolute, canonical, non-symlink files. When configured, the active profile's labeled `upload_roots` are enforced; single-company mode can use `QBO_UPLOAD_ROOTS`.
- File path security also blocks dotfiles, credential files, secret-key extensions, and non-QBO-approved file types
- Max file size: 100 MB (QBO limit)
- Cannot replace uploaded file bytes — must delete and re-create
- Ordinary Claude Chat uploads are not exposed as local MCP paths. Use the original local path or Cowork connected-folder access.
- Lambda/HTTP mode cannot access a user's local filesystem through `file_path`
- `list_transaction_attachables` queries linked IDs, then fetches full metadata without exposing signed URLs.
- `read_attachable_content` downloads only QBO-issued URLs: bounded UTF-8 text/CSV/XML (256 KB), JPEG/PNG/GIF images, and PDFs (10 MB default local mode, 4 MB inline/HTTP output). Local PDF reads render up to three pages at a time as bounded JPEG MCP image blocks, including scanned PDFs; use `page_start` for later pages. Lambda returns metadata only and does not bundle native rendering dependencies. It refreshes expired URLs once and never accepts arbitrary URLs. HTTP metadata lists are capped at 20.
- Attachment verification is read-only: compare content to the transaction getter output, and require a separate draft-first edit for corrections.
