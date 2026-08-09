# QuickBooks Online API Limitations

## Query Filtering Limitations

Only fields marked as **"filterable"** in the [Intuit API reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account) are queryable in WHERE clauses.

### Non-Filterable Reference Fields

The following reference fields are **NOT queryable** on transaction entities:

| Field | Entities Tested | Result |
|-------|-----------------|--------|
| `DepartmentRef` | SalesReceipt, JournalEntry, Purchase, Invoice | `QueryValidationError: property 'DepartmentRef' is not queryable` |
| `AccountRef` | JournalEntry, Invoice, Deposit | `QueryValidationError: Property AccountRef not found for Entity` |

### Commonly Filterable Fields

Based on API documentation, these fields are typically filterable:

- `TxnDate` - Transaction date
- `CreateTime` / `LastUpdatedTime` - Metadata timestamps
- `DocNumber` - Document/reference number
- `CustomerRef` - Customer reference (on some entities)
- `Active` - Active status (on master data entities)

### Workarounds

Since DepartmentRef and AccountRef cannot be filtered server-side:

1. **For Reports**: Use the `department` parameter on P&L and Balance Sheet reports (these use a different API endpoint that supports department filtering)

2. **For Queries**: Fetch all records and filter client-side using tools like `jq`:
   ```bash
   # Filter SalesReceipts by department
   cat results.json | jq '.QueryResponse.SalesReceipt[] | select(.DepartmentRef.value == "5")'

   # Filter JournalEntry lines by account
   cat results.json | jq '.QueryResponse.JournalEntry[].Line[] | select(.JournalEntryLineDetail.AccountRef.value == "123")'
   ```

## Other Query Limitations

From [Intuit's Data Queries documentation](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries):

- **No projections**: Response returns all properties for each object
- **No OR operator**: WHERE clauses don't support OR
- **No GROUP BY**: Aggregation not supported
- **No JOIN**: Cannot join entities
- **Single quotes required**: Comparison values must use single quotes (`'value'`), not double quotes
- **Max 1000 results**: Use `STARTPOSITION` for pagination
- **Wildcard limited to %**: Only `LIKE '%pattern%'` supported, no other wildcards

## Sparse Update Required Fields

When performing sparse updates (`sparse: true`), certain fields are **required** beyond just `Id` and `SyncToken`, even though you're only updating a subset of the entity.

| Entity | Required Fields | Notes |
|--------|-----------------|-------|
| **JournalEntry** | `Id`, `SyncToken` | Minimal requirements |
| **Bill** | `Id`, `SyncToken`, `VendorRef` | Must include vendor reference |
| **Purchase** (Expense) | `Id`, `SyncToken`, `PaymentType` | PaymentType cannot be changed, but must be included |

### Example Error

If you omit a required field like `PaymentType` on a Purchase update:

```json
{
  "Fault": {
    "Error": [{
      "Message": "Required param missing, need to supply the required value for the API",
      "Detail": "Required parameter PaymentType is missing in the request",
      "code": "2020",
      "element": "PaymentType"
    }],
    "type": "ValidationFault"
  }
}
```

### Implementation Notes

The MCP edit tools (`edit_journal_entry`, `edit_bill`, `edit_expense`) automatically include these required fields by:
1. Fetching the current entity state
2. Copying the required fields to the update payload
3. Applying only the requested changes

## Expense (Purchase) Department Limitations

### Single Department Per Expense

QBO expenses (Purchases) support only **one department at the header level**. While the API schema includes `DepartmentRef` on line-level `AccountBasedExpenseLineDetail`, the API rejects attempts to set line-level departments when lines are added or modified (error: "failed to parse json object; a property specified is unsupported or invalid").

This means an expense transaction **cannot be split across multiple departments**. If a single vendor charge covers multiple locations (e.g., a $59.98 SimpliSafe charge for two stores), it cannot be represented as one expense with two department-tagged lines.

### Workarounds

1. **Split Bills (preferred for recurring)**: Use the bill-splitting workflow in the frontend to create separate bills per department from a single vendor invoice. Each bill gets its own header-level department.

2. **Reclassification Journal Entry (for corrections)**: When expenses are already recorded under the wrong department, create a JE to move the amounts:
   - Debit the expense account in the correct department
   - Credit the expense account in the incorrect department

3. **Separate Expenses**: Manually create individual expense records per department (loses the connection to the single bank/card transaction).

### Expense Full-Update Preservation

Line changes require a full update (`sparse: false`); QBO does not support sparse updates to individual lines. The handler fetches the current expense and carries forward required and optional writable metadata, including:

- `PaymentType`, payment `AccountRef`, `EntityRef`, and `DepartmentRef`
- Currency, exchange rate, payment method, tax, print/credit, and annual-reporting fields when present
- `LinkedTxn` relationships
- Untouched nested line details such as `TaxCodeRef`, `CustomerRef`, and `BillableStatus`

Customer/job assignment, replacement, and clearing were validated against disposable QBO sandbox bills, expenses, and vendor credits. Required header references, document fields, line account/amount/description, billable status, totals, and balances remained unchanged across full updates.

### Account-Line Customer and Job References

`AccountBasedExpenseLineDetail.CustomerRef` is supported on bills, expenses, and vendor credits. The MCP tools accept customer IDs, display names, and fully qualified job names. Customer tagging remains separate from billable-expense state: new tagged lines are `NotBillable`, QBO-managed `HasBeenBilled` state is not writable, and customer removal is blocked for billable lines.

For edits, omission preserves the current reference, customer name/ID replaces it, and `clear_customer: true` removes it through full-update omission. Customer mutation is intentionally unsupported on item-based expense lines.

## Vendor Master Data

QBO Vendor names are shared with customers and employees: `DisplayName` must be unique across all three entity types. QBO also rejects colons, tabs, and newlines in display and personal-name fields. The Vendor tools validate documented field lengths and name characters locally, while QBO remains authoritative for cross-entity uniqueness.

Vendor edits fetch the current entity immediately before preview or commit and use its latest `SyncToken`. Updates are sparse, so omitted fields are preserved. Removing optional contact, address, terms, or account-number values requires an explicit `clear_*` directive rather than omission.

Vendors are not hard-deleted. `deactivate_vendor` sets `Active: false`, preserves historical transactions, and warns about the current open balance in draft mode. Deactivation is reversible through `edit_vendor` with `active: true`.

Sandbox validation confirmed that sparse Vendor clears require empty values rather than JSON `null`: `{}` for wrapped contact/address fields, `{ value: "" }` for `TermRef`, and `""` for `AcctNum`. QBO silently ignores `TermRef` during Vendor creation, so `create_vendor` applies requested default terms in a follow-up sparse update using the newly returned ID and SyncToken.

If that follow-up terms update fails, the tool returns a non-retriable partial-success result containing the created Vendor ID and instructions to use `edit_vendor`; it does not retry the create operation. `get_vendor` allowlists supported fields before inline output and excludes tax identifiers, payment-bank details, and other unsupported Vendor data from model context.

## Attachables

QBO supports file and note Attachables linked to existing transactions. The transaction must exist before an Attachable can reference it. Phase 0 sandbox validation confirmed a local text file could be draft-previewed, uploaded, linked to a Bill, read back with metadata, downloaded byte-for-byte, and deleted with the disposable Bill.

File upload uses a local absolute path on the machine running qbo-mcp. Files uploaded only to ordinary Claude Chat are not automatically forwarded to local MCP servers. Cowork connected folders or an explicit original path provide the supported local workflow.

For multi-company use, each QBO profile may define multiple labeled `upload_roots`; qbo-mcp canonicalizes the file and configured roots before enforcing containment. Symbolic links, dotfiles, credential/secret files, unsupported file types, unreadable/empty files, and files over QBO's 100 MB limit are rejected. In single-company mode, `QBO_UPLOAD_ROOTS` provides an optional platform-delimited fallback.

The node-quickbooks combined upload/link overload silently ignored `IncludeOnSend` during sandbox validation and hides partial success behind its internal follow-up update. qbo-mcp therefore uploads the file without linking, then performs one controlled sparse update containing the entity link, `IncludeOnSend`, note, and category. If the update fails, the tool returns a non-retriable partial-success result with the created Attachable ID for recovery through `edit_attachable`.

QBO temporary download URLs expire after approximately 15 minutes. Uploaded file bytes are immutable; changing a file requires deleting and recreating the Attachable. Updating entity links replaces the complete `AttachableRef` array.

QBO supports querying attachment IDs by `AttachableRef.EntityRef.Type` and `.value`. These query results are sparse, so `list_transaction_attachables` performs bounded full reads before returning allowlisted metadata. Temporary signed URLs are intentionally excluded from list results.

`read_attachable_content` re-reads current metadata, downloads only a QBO-issued HTTPS URL with timeout/redirect/byte limits, and retries once after a 401/403 by obtaining a fresh temporary URL. It returns UTF-8 text/CSV/XML capped at 256 KB and MCP image content for JPEG/PNG/GIF. In the local server, PDFs are rendered with PDF.js and a bounded native canvas to JPEG MCP image blocks, which supports both text PDFs and image-only scans without relying on Claude Desktop's unsupported embedded-PDF/resource-link channels. Each call returns at most three pages and accepts `page_start` for continuation. Binary downloads are capped at 10 MB in default local mode and 4 MB in inline/HTTP output mode; HTTP metadata lists are capped at 20 records. The stateless Lambda transport returns PDF metadata only and excludes native rendering dependencies. Office and unsupported binary formats are reported without downloading. Downloaded PDF bytes and rendered pages are held only for the tool call and are not persisted.

The intended reconciliation workflow is read-only: fetch the QBO transaction, list/read its source document, and let Claude report matching or conflicting vendor, document number, dates, total, and line details. Any correction requires a separate draft-first edit operation.

## References

- [Data Queries - Intuit Developer](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries)
- [Deep Dive into QuickBooks Online Data Queries](https://blogs.intuit.com/2017/02/08/deep-dive-sql-queries/)
- [Purchase API Reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/Purchase)
- [Vendor API Reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/vendor)
- [Attachable API Reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/attachable)
