// Handlers for bill tools (create, get, edit)

import QuickBooks from "node-quickbooks";
import {
  promisify,
  getAccountCache,
  getDepartmentCache,
  getVendorCache,
} from "../../client/index.js";
import { validateAmount, toDollars, formatDollars, sumCents, outputReport, getQboUrl } from "../../utils/index.js";
import { createResolutionCoordinator, resolveOptionalCustomerRef, toEntityRef } from "../resolve.js";

interface CreateBillLine {
  account_id?: string;
  account_name?: string;
  customer_id?: string;
  customer_name?: string;
  amount: number;
  description?: string;
}

interface BillLineChange {
  line_id?: string;
  account_name?: string;
  amount?: number;
  description?: string;
  delete?: boolean;
}

export async function handleCreateBill(
  client: QuickBooks,
  args: {
    vendor_name?: string;
    vendor_id?: string;
    txn_date: string;
    due_date?: string;
    department_name?: string;
    department_id?: string;
    ap_account?: string;
    memo?: string;
    doc_number?: string;
    lines: CreateBillLine[];
    draft?: boolean;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const {
    vendor_name, vendor_id, txn_date, due_date,
    department_name, department_id, ap_account,
    memo, doc_number, lines, draft = true,
  } = args;

  if (!lines || lines.length === 0) {
    throw new Error("At least one line is required");
  }

  // Get cached lookups
  const [acctCache, deptCache, vendorCacheData] = await Promise.all([
    getAccountCache(client),
    getDepartmentCache(client),
    getVendorCache(client),
  ]);
  const resolver = createResolutionCoordinator(client, {
    account: acctCache,
    department: deptCache,
    vendor: vendorCacheData,
  });

  // Resolve vendor
  let vendorRef: { value: string; name: string };
  if (vendor_id) {
    vendorRef = await resolver.vendor(vendor_id);
  } else if (vendor_name) {
    vendorRef = await resolver.vendor(vendor_name);
  } else {
    throw new Error("Either vendor_name or vendor_id is required");
  }

  // Resolve department (header-level)
  let departmentRef: { value: string; name: string } | undefined;
  const deptInput = department_id || department_name;
  if (deptInput) {
    departmentRef = await resolver.department(deptInput);
  }

  // Resolve AP account if specified
  let apAccountRef: { value: string; name: string } | undefined;
  if (ap_account) {
    const acct = await resolver.account(ap_account);
    apAccountRef = { value: acct.value, name: acct.name };
  }

  // Resolve lines
  const resolvedLines = await Promise.all(lines.map(async (line) => {
    let accountId = line.account_id;
    let accountName = line.account_name;
    let accountNum: string | undefined;

    if (!accountId && accountName) {
      const account = await resolver.account(accountName);
      accountId = account.value;
      accountName = account.name;
      accountNum = account.acctNum;
    } else if (!accountId && !accountName) {
      throw new Error("Each line must have either account_id or account_name");
    }

    const amountCents = validateAmount(line.amount, `Line ${accountName || accountId}`);
    const customerRef = await resolveOptionalCustomerRef(resolver, line);

    return {
      ...line,
      account_id: accountId!,
      account_name: accountName,
      account_num: accountNum,
      amount_cents: amountCents,
      amount: toDollars(amountCents),
      customer_ref: customerRef,
    };
  }));

  // Calculate total
  const totalCents = sumCents(resolvedLines.map(l => l.amount_cents));

  // Build QuickBooks Bill object
  const billObject: Record<string, unknown> = {
    VendorRef: vendorRef,
    TxnDate: txn_date,
    ...(due_date && { DueDate: due_date }),
    ...(memo && { PrivateNote: memo }),
    ...(doc_number && { DocNumber: doc_number }),
    ...(departmentRef && { DepartmentRef: departmentRef }),
    ...(apAccountRef && { APAccountRef: apAccountRef }),
    Line: resolvedLines.map((line) => ({
      Amount: line.amount,
      DetailType: "AccountBasedExpenseLineDetail",
      ...(line.description && { Description: line.description }),
      AccountBasedExpenseLineDetail: {
        AccountRef: {
          value: line.account_id,
          name: line.account_name,
        },
        ...(line.customer_ref && { CustomerRef: line.customer_ref }),
        BillableStatus: "NotBillable",
      },
    })),
  };

  if (draft) {
    const formatAccount = (l: typeof resolvedLines[0]) => {
      const num = l.account_num ? `${l.account_num} ` : "";
      return `${num}${l.account_name || l.account_id}`;
    };

    const preview = [
      "DRAFT - Bill Preview",
      "",
      `Vendor: ${vendorRef.name}`,
      `Date: ${txn_date}`,
      `Due Date: ${due_date || "(none)"}`,
      `Ref no.: ${doc_number || "(auto-assign)"}`,
      `Department: ${departmentRef?.name || "(none)"}`,
      `AP Account: ${apAccountRef?.name || "(default)"}`,
      `Memo: ${memo || "(none)"}`,
      `Total: $${formatDollars(totalCents)}`,
      "",
      "Lines:",
      ...resolvedLines.map(l =>
        `  ${formatAccount(l)}${l.customer_ref ? ` [Customer/Job: ${l.customer_ref.name}]` : ""}: $${l.amount.toFixed(2)}${l.description ? ` "${l.description}"` : ""}`
      ),
      "",
      "Set draft=false to create this bill.",
    ].join("\n");

    return {
      content: [{ type: "text", text: preview }],
    };
  }

  // Create the bill
  const result = await promisify<unknown>((cb) =>
    client.createBill(billObject, cb)
  ) as { Id: string; DocNumber?: string };

  const qboUrl = getQboUrl("bill", result.Id)!;

  const response = [
    "Bill Created!",
    "",
    `Vendor: ${vendorRef.name}`,
    `Ref no.: ${result.DocNumber || "(auto-assigned)"}`,
    `Date: ${txn_date}`,
    `Total: $${formatDollars(totalCents)}`,
    "",
    `View in QuickBooks: ${qboUrl}`,
  ].join("\n");

  return {
    content: [{ type: "text", text: response }],
  };
}

export async function handleGetBill(
  client: QuickBooks,
  args: { id: string }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { id } = args;

  const bill = await promisify<unknown>((cb) =>
    client.getBill(id, cb)
  ) as {
    Id: string;
    SyncToken: string;
    TxnDate: string;
    DueDate?: string;
    DocNumber?: string;
    PrivateNote?: string;
    TotalAmt?: number;
    VendorRef?: { value: string; name?: string };
    APAccountRef?: { value: string; name?: string };
    Line?: Array<{
      Id: string;
      Amount: number;
      Description?: string;
      DetailType: string;
      AccountBasedExpenseLineDetail?: {
        AccountRef: { value: string; name?: string };
        DepartmentRef?: { value: string; name?: string };
        CustomerRef?: { value: string; name?: string };
        BillableStatus?: "Billable" | "NotBillable" | "HasBeenBilled";
      };
      ItemBasedExpenseLineDetail?: {
        ItemRef: { value: string; name?: string };
        Qty?: number;
        UnitPrice?: number;
      };
    }>;
  };
  const qboUrl = getQboUrl("bill", bill.Id)!;

  // Format summary
  const lines: string[] = [
    'Bill',
    '====',
    `ID: ${bill.Id}`,
    `SyncToken: ${bill.SyncToken}`,
    `Vendor: ${bill.VendorRef?.name || bill.VendorRef?.value || '(none)'}`,
    `Date: ${bill.TxnDate}`,
    `Due Date: ${bill.DueDate || '(none)'}`,
    `Ref no.: ${bill.DocNumber || '(none)'}`,
    `Memo: ${bill.PrivateNote || '(none)'}`,
    `AP Account: ${bill.APAccountRef?.name || bill.APAccountRef?.value || 'Accounts Payable'}`,
    `Total: $${(bill.TotalAmt || 0).toFixed(2)}`,
    '',
    'Lines:',
  ];

  for (const line of bill.Line || []) {
    if (line.AccountBasedExpenseLineDetail) {
      const detail = line.AccountBasedExpenseLineDetail;
      const acctName = detail.AccountRef.name || detail.AccountRef.value;
      const deptStr = detail.DepartmentRef?.name ? ` [${detail.DepartmentRef.name}]` : '';
      const customerName = detail.CustomerRef?.name || detail.CustomerRef?.value;
      const customerStr = customerName ? ` [Customer/Job: ${customerName}]` : '';
      const billableStr = detail.BillableStatus ? ` [${detail.BillableStatus}]` : '';
      const descStr = line.Description ? ` "${line.Description}"` : '';
      lines.push(`  Line ${line.Id}: ${acctName}${deptStr}${customerStr}${billableStr} $${line.Amount.toFixed(2)}${descStr}`);
    } else if (line.ItemBasedExpenseLineDetail) {
      const detail = line.ItemBasedExpenseLineDetail;
      const itemName = detail.ItemRef.name || detail.ItemRef.value;
      const descStr = line.Description ? ` "${line.Description}"` : '';
      lines.push(`  Line ${line.Id}: Item: ${itemName} (Qty: ${detail.Qty || 1}) $${line.Amount.toFixed(2)}${descStr}`);
    }
  }

  lines.push('');
  lines.push(`View in QuickBooks: ${qboUrl}`);

  return outputReport(`bill-${bill.Id}`, bill, lines.join('\n'));
}

export async function handleEditBill(
  client: QuickBooks,
  args: {
    id: string;
    vendor_name?: string;
    txn_date?: string;
    due_date?: string;
    memo?: string;
    department_name?: string;
    doc_number?: string;
    lines?: BillLineChange[];
    draft?: boolean;
  }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { id, vendor_name, txn_date, due_date, memo, department_name, doc_number, lines: lineChanges, draft = true } = args;

  // Fetch current Bill
  const current = await promisify<unknown>((cb) =>
    client.getBill(id, cb)
  ) as {
    Id: string;
    SyncToken: string;
    TxnDate: string;
    DueDate?: string;
    DocNumber?: string;
    PrivateNote?: string;
    DepartmentRef?: { value: string; name?: string };
    VendorRef: { value: string; name?: string };
    Line: Array<{
      Id: string;
      Amount: number;
      Description?: string;
      DetailType: string;
      AccountBasedExpenseLineDetail?: {
        AccountRef: { value: string; name?: string };
        DepartmentRef?: { value: string; name?: string };
        CustomerRef?: { value: string; name?: string };
        BillableStatus?: "Billable" | "NotBillable" | "HasBeenBilled";
      };
    }>;
  };
  const resolver = createResolutionCoordinator(client);

  // Resolve vendor if changing
  let vendorRef: { value: string; name: string };
  if (vendor_name) {
    vendorRef = await resolver.vendor(vendor_name);
  } else {
    vendorRef = { value: current.VendorRef.value, name: current.VendorRef.name || "" };
  }

  // Determine if we're modifying lines - requires full update (not sparse)
  const needsFullUpdate = lineChanges && lineChanges.length > 0;

  // Build updated Bill
  // Note: VendorRef is required by QB API even for sparse updates
  const updated: Record<string, unknown> = {
    Id: current.Id,
    SyncToken: current.SyncToken,
    VendorRef: vendorRef,
  };

  // Only use sparse for non-line updates; full update needed for line modifications
  // Note: node-quickbooks auto-sets sparse=true, so we must explicitly set sparse=false for full updates
  if (!needsFullUpdate) {
    updated.sparse = true;
  } else {
    // Full update: explicitly set sparse=false (node-quickbooks defaults to true)
    updated.sparse = false;
    updated.TxnDate = current.TxnDate;
    updated.DueDate = current.DueDate;
    updated.DocNumber = current.DocNumber;
    updated.PrivateNote = current.PrivateNote;
    if (current.DepartmentRef) {
      updated.DepartmentRef = current.DepartmentRef;
    }
    // Copy lines and strip read-only fields
    updated.Line = current.Line.map(line => {
      const { LineNum, ...rest } = line as Record<string, unknown>;
      return rest;
    });
  }

  if (txn_date !== undefined) updated.TxnDate = txn_date;
  if (due_date !== undefined) updated.DueDate = due_date;
  if (memo !== undefined) updated.PrivateNote = memo;
  if (doc_number !== undefined) updated.DocNumber = doc_number;

  // Resolve department if changing
  if (department_name !== undefined) {
    updated.DepartmentRef = await resolver.department(department_name);
  }

  // Process line changes if provided
  // Use updated.Line if available (for full updates with stripped read-only fields), else current.Line
  let finalLines = [...((updated.Line as typeof current.Line) || current.Line)];

  if (lineChanges && lineChanges.length > 0) {
    for (const change of lineChanges) {
      if (change.line_id) {
        const lineIndex = finalLines.findIndex(l => l.Id === change.line_id);
        if (lineIndex === -1) {
          throw new Error(`Line ID ${change.line_id} not found in bill`);
        }

        if (change.delete) {
          finalLines.splice(lineIndex, 1);
        } else {
          const line = { ...finalLines[lineIndex] };
          const detail = { ...(line.AccountBasedExpenseLineDetail || {}) } as {
            AccountRef: { value: string; name?: string };
            DepartmentRef?: { value: string; name?: string };
          };

          if (change.amount !== undefined) {
            const amountCents = validateAmount(change.amount, `Line ${change.line_id}`);
            line.Amount = toDollars(amountCents);
          }
          if (change.description !== undefined) line.Description = change.description;
          if (change.account_name !== undefined) detail.AccountRef = toEntityRef(await resolver.account(change.account_name));

          line.AccountBasedExpenseLineDetail = detail;
          line.DetailType = 'AccountBasedExpenseLineDetail';
          finalLines[lineIndex] = line;
        }
      } else {
        if (!change.amount || !change.account_name) {
          throw new Error('New lines require amount and account_name');
        }

        // Validate and normalize the amount
        const amountCents = validateAmount(change.amount, `New line for ${change.account_name}`);

        // Id omitted for new lines - QB will assign
        const newLine = {
          Amount: toDollars(amountCents),
          Description: change.description,
          DetailType: 'AccountBasedExpenseLineDetail',
          AccountBasedExpenseLineDetail: {
            AccountRef: toEntityRef(await resolver.account(change.account_name)),
          }
        } as typeof finalLines[0];
        finalLines.push(newLine);
      }
    }

    updated.Line = finalLines;
  }

  const qboUrl = getQboUrl("bill", id)!;

  if (draft) {
    const previewLines: string[] = [
      'DRAFT - Bill Edit Preview',
      '',
      `ID: ${id}`,
      `SyncToken: ${current.SyncToken}`,
      '',
      'Changes:',
    ];

    if (vendor_name) previewLines.push(`  Vendor: ${current.VendorRef?.name || current.VendorRef?.value} → ${(vendorRef as { name?: string }).name || vendor_name}`);
    if (txn_date !== undefined) previewLines.push(`  Date: ${current.TxnDate} → ${txn_date}`);
    if (due_date !== undefined) previewLines.push(`  Due Date: ${current.DueDate || '(none)'} → ${due_date}`);
    if (memo !== undefined) previewLines.push(`  Memo: ${current.PrivateNote || '(none)'} → ${memo}`);
    if (doc_number !== undefined) previewLines.push(`  Ref no.: ${current.DocNumber || '(none)'} → ${doc_number}`);
    if (department_name !== undefined) previewLines.push(`  Department: ${current.DepartmentRef?.name || '(none)'} → ${(updated.DepartmentRef as { name?: string })?.name || department_name}`);

    if (updated.Line) {
      previewLines.push('');
      previewLines.push('Updated Lines:');
      for (const line of updated.Line as typeof finalLines) {
        const detail = line.AccountBasedExpenseLineDetail;
        if (detail) {
          const acctName = detail.AccountRef.name || detail.AccountRef.value;
          const deptStr = detail.DepartmentRef?.name ? ` [${detail.DepartmentRef.name}]` : '';
          previewLines.push(`  ${acctName}${deptStr}: $${line.Amount.toFixed(2)}`);
        }
      }
    }

    previewLines.push('');
    previewLines.push('Set draft=false to apply these changes.');

    return {
      content: [{ type: "text", text: previewLines.join('\n') }],
    };
  }

  const result = await promisify<unknown>((cb) =>
    client.updateBill(updated, cb)
  ) as { Id: string; SyncToken: string };

  return {
    content: [{ type: "text", text: `Bill ${id} updated successfully.\nNew SyncToken: ${result.SyncToken}\nView in QuickBooks: ${qboUrl}` }],
  };
}
