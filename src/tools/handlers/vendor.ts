// Handlers for vendor master-data tools (create, get, edit, deactivate)

import QuickBooks from "node-quickbooks";
import { clearVendorCache, promisify } from "../../client/index.js";
import { formatQBOError, getQboUrl, outputReport } from "../../utils/index.js";
import {
  AddressInput,
  QBAddress,
  buildQBAddress,
  formatAddress,
  resolveTermRef,
} from "../entity-fields.js";

interface VendorFields {
  display_name?: string;
  title?: string;
  given_name?: string;
  middle_name?: string;
  family_name?: string;
  suffix?: string;
  company_name?: string;
  print_on_check_name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  fax?: string;
  web_address?: string;
  bill_address?: AddressInput;
  vendor_1099?: boolean;
  account_number?: string;
  terms_ref?: string;
}

interface VendorEditFields extends VendorFields {
  active?: boolean;
  clear_email?: boolean;
  clear_phone?: boolean;
  clear_mobile?: boolean;
  clear_fax?: boolean;
  clear_web_address?: boolean;
  clear_bill_address?: boolean;
  clear_terms?: boolean;
  clear_account_number?: boolean;
}

interface QBVendor {
  Id: string;
  SyncToken: string;
  DisplayName: string;
  Title?: string;
  GivenName?: string;
  MiddleName?: string;
  FamilyName?: string;
  Suffix?: string;
  CompanyName?: string;
  PrintOnCheckName?: string;
  PrimaryEmailAddr?: { Address?: string };
  PrimaryPhone?: { FreeFormNumber?: string };
  Mobile?: { FreeFormNumber?: string };
  Fax?: { FreeFormNumber?: string };
  WebAddr?: { URI?: string };
  BillAddr?: QBAddress;
  Vendor1099?: boolean;
  AcctNum?: string;
  TermRef?: { value: string; name?: string };
  Active?: boolean;
  Balance?: number;
  CurrencyRef?: { value: string; name?: string };
  MetaData?: { CreateTime?: string; LastUpdatedTime?: string };
}

const NAME_FIELD_LIMITS: Array<{
  key: keyof VendorFields;
  label: string;
  maxLength: number;
  forbidQboNameCharacters?: boolean;
}> = [
  { key: "display_name", label: "display_name", maxLength: 500, forbidQboNameCharacters: true },
  { key: "title", label: "title", maxLength: 16, forbidQboNameCharacters: true },
  { key: "given_name", label: "given_name", maxLength: 100, forbidQboNameCharacters: true },
  { key: "middle_name", label: "middle_name", maxLength: 100, forbidQboNameCharacters: true },
  { key: "family_name", label: "family_name", maxLength: 100, forbidQboNameCharacters: true },
  { key: "suffix", label: "suffix", maxLength: 16, forbidQboNameCharacters: true },
  { key: "company_name", label: "company_name", maxLength: 100 },
  { key: "print_on_check_name", label: "print_on_check_name", maxLength: 100, forbidQboNameCharacters: true },
  { key: "account_number", label: "account_number", maxLength: 100 },
];

const EDIT_CHANGE_KEYS: Array<keyof VendorEditFields> = [
  "display_name",
  "title",
  "given_name",
  "middle_name",
  "family_name",
  "suffix",
  "company_name",
  "print_on_check_name",
  "email",
  "phone",
  "mobile",
  "fax",
  "web_address",
  "bill_address",
  "vendor_1099",
  "account_number",
  "terms_ref",
  "active",
  "clear_email",
  "clear_phone",
  "clear_mobile",
  "clear_fax",
  "clear_web_address",
  "clear_bill_address",
  "clear_terms",
  "clear_account_number",
];

function validateVendorFields(fields: VendorFields, requireDisplayName = false): void {
  if ((requireDisplayName || fields.display_name !== undefined) &&
      (!fields.display_name || fields.display_name.trim().length === 0)) {
    throw new Error("display_name is required");
  }

  for (const field of NAME_FIELD_LIMITS) {
    const value = fields[field.key];
    if (typeof value !== "string") continue;
    if (value.length > field.maxLength) {
      throw new Error(`${field.label} must be ${field.maxLength} characters or fewer`);
    }
    if (field.forbidQboNameCharacters && /[:\t\r\n]/.test(value)) {
      throw new Error(`${field.label} cannot contain a colon, tab, or newline`);
    }
  }

  const nonEmptyFields: Array<[keyof VendorFields, string]> = [
    ["email", "email"],
    ["phone", "phone"],
    ["mobile", "mobile"],
    ["fax", "fax"],
    ["web_address", "web_address"],
    ["account_number", "account_number"],
    ["terms_ref", "terms_ref"],
  ];
  for (const [key, label] of nonEmptyFields) {
    const value = fields[key];
    if (typeof value === "string" && value.trim().length === 0) {
      throw new Error(`${label} cannot be empty; omit it or use its clear directive when editing`);
    }
  }

  if (fields.bill_address !== undefined &&
      !Object.values(fields.bill_address).some((value) => value?.trim().length)) {
    throw new Error("bill_address cannot be empty; omit it or use clear_bill_address when editing");
  }

  // QBO's Vendor business rule requires both an at sign and a dot.
  if (fields.email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) {
    throw new Error("email must contain a valid address with @ and a domain");
  }
}

function assertClearDirectives(fields: VendorEditFields): void {
  const conflicts: Array<[keyof VendorEditFields, keyof VendorEditFields, string]> = [
    ["email", "clear_email", "email"],
    ["phone", "clear_phone", "phone"],
    ["mobile", "clear_mobile", "mobile"],
    ["fax", "clear_fax", "fax"],
    ["web_address", "clear_web_address", "web_address"],
    ["bill_address", "clear_bill_address", "bill_address"],
    ["terms_ref", "clear_terms", "terms_ref"],
    ["account_number", "clear_account_number", "account_number"],
  ];

  for (const [assignment, clear, label] of conflicts) {
    if (fields[assignment] !== undefined && fields[clear] === true) {
      throw new Error(`Cannot provide ${label} and ${String(clear)} together`);
    }
  }
}

function hasEditChanges(fields: VendorEditFields): boolean {
  return EDIT_CHANGE_KEYS.some((key) =>
    key.startsWith("clear_") ? fields[key] === true : fields[key] !== undefined
  );
}

function applySimpleVendorFields(target: Record<string, unknown>, fields: VendorFields): void {
  if (fields.display_name !== undefined) target.DisplayName = fields.display_name;
  if (fields.title !== undefined) target.Title = fields.title;
  if (fields.given_name !== undefined) target.GivenName = fields.given_name;
  if (fields.middle_name !== undefined) target.MiddleName = fields.middle_name;
  if (fields.family_name !== undefined) target.FamilyName = fields.family_name;
  if (fields.suffix !== undefined) target.Suffix = fields.suffix;
  if (fields.company_name !== undefined) target.CompanyName = fields.company_name;
  if (fields.print_on_check_name !== undefined) target.PrintOnCheckName = fields.print_on_check_name;
  if (fields.email !== undefined) target.PrimaryEmailAddr = { Address: fields.email };
  if (fields.phone !== undefined) target.PrimaryPhone = { FreeFormNumber: fields.phone };
  if (fields.mobile !== undefined) target.Mobile = { FreeFormNumber: fields.mobile };
  if (fields.fax !== undefined) target.Fax = { FreeFormNumber: fields.fax };
  if (fields.web_address !== undefined) target.WebAddr = { URI: fields.web_address };
  if (fields.bill_address !== undefined) target.BillAddr = buildQBAddress(fields.bill_address);
  if (fields.vendor_1099 !== undefined) target.Vendor1099 = fields.vendor_1099;
  if (fields.account_number !== undefined) target.AcctNum = fields.account_number;
}

function addChange(
  lines: string[],
  label: string,
  currentValue: unknown,
  newValue: unknown
): void {
  const current = currentValue === undefined || currentValue === null || currentValue === ""
    ? "(none)"
    : String(currentValue);
  const next = newValue === undefined || newValue === null || newValue === ""
    ? "(none)"
    : String(newValue);
  lines.push(`  ${label}: ${current} → ${next}`);
}

export async function handleCreateVendor(
  client: QuickBooks,
  args: VendorFields & { display_name: string; draft?: boolean }
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const { draft = true, ...fields } = args;
  validateVendorFields(fields, true);

  const vendorObject: Record<string, unknown> = {};
  applySimpleVendorFields(vendorObject, fields);

  let termRef: { value: string; name: string } | undefined;
  if (fields.terms_ref) {
    termRef = await resolveTermRef(client, fields.terms_ref);
  }

  if (draft) {
    const preview = [
      "DRAFT - Vendor Preview",
      "",
      `Display Name: ${fields.display_name}`,
      ...(fields.title || fields.given_name || fields.middle_name || fields.family_name || fields.suffix
        ? [`Name: ${[fields.title, fields.given_name, fields.middle_name, fields.family_name, fields.suffix].filter(Boolean).join(" ")}`]
        : []),
      `Company: ${fields.company_name || "(none)"}`,
      `Print on Check: ${fields.print_on_check_name || "(default)"}`,
      `Email: ${fields.email || "(none)"}`,
      `Phone: ${fields.phone || "(none)"}`,
      `Mobile: ${fields.mobile || "(none)"}`,
      `Fax: ${fields.fax || "(none)"}`,
      `Website: ${fields.web_address || "(none)"}`,
      ...formatAddress(fields.bill_address ? buildQBAddress(fields.bill_address) : undefined, "Billing Address"),
      `1099 Vendor: ${fields.vendor_1099 ?? false}`,
      `Account Number: ${fields.account_number || "(none)"}`,
      `Terms: ${termRef?.name || "(none)"}`,
      "",
      "Set draft=false to create this vendor.",
    ].join("\n");

    return { content: [{ type: "text", text: preview }] };
  }

  let result = await promisify<unknown>((callback) =>
    client.createVendor(vendorObject, callback)
  ) as QBVendor;

  // QBO silently ignores TermRef during Vendor creation. Apply it through the
  // supported sparse-update path after the Vendor has an ID and SyncToken.
  if (termRef) {
    try {
      result = await promisify<unknown>((callback) =>
        client.updateVendor({
          Id: result.Id,
          SyncToken: result.SyncToken,
          sparse: true,
          TermRef: termRef,
        }, callback)
      ) as QBVendor;
    } catch (error) {
      clearVendorCache();
      // Return rather than throw: the Vendor already exists, so the global
      // auth retry must not execute the entire create operation a second time.
      return {
        content: [{
          type: "text",
          text: `Vendor ${result.DisplayName} (ID: ${result.Id}) was created, but default terms could not be applied: ${formatQBOError(error)}. Use edit_vendor to apply terms after resolving the error.`,
        }],
        isError: true,
      };
    }
  }
  clearVendorCache();

  const response = [
    "Vendor Created!",
    "",
    `ID: ${result.Id}`,
    `Display Name: ${result.DisplayName}`,
    ...(result.SyncToken !== undefined ? [`SyncToken: ${result.SyncToken}`] : []),
    "",
    `View in QuickBooks: ${getQboUrl("vendor", result.Id)}`,
  ].join("\n");

  return { content: [{ type: "text", text: response }] };
}

export async function handleGetVendor(
  client: QuickBooks,
  args: { id: string }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const vendor = await promisify<unknown>((callback) =>
    client.getVendor(args.id, callback)
  ) as QBVendor;

  const lines: string[] = [
    "Vendor",
    "======",
    `ID: ${vendor.Id}`,
    `SyncToken: ${vendor.SyncToken}`,
    `Display Name: ${vendor.DisplayName}`,
    `Active: ${vendor.Active !== false}`,
  ];

  if (vendor.Title || vendor.GivenName || vendor.MiddleName || vendor.FamilyName || vendor.Suffix) {
    lines.push(`Name: ${[vendor.Title, vendor.GivenName, vendor.MiddleName, vendor.FamilyName, vendor.Suffix].filter(Boolean).join(" ")}`);
  }
  lines.push(`Company: ${vendor.CompanyName || "(none)"}`);
  lines.push(`Print on Check: ${vendor.PrintOnCheckName || "(default)"}`);
  lines.push(`Email: ${vendor.PrimaryEmailAddr?.Address || "(none)"}`);
  lines.push(`Phone: ${vendor.PrimaryPhone?.FreeFormNumber || "(none)"}`);
  lines.push(`Mobile: ${vendor.Mobile?.FreeFormNumber || "(none)"}`);
  lines.push(`Fax: ${vendor.Fax?.FreeFormNumber || "(none)"}`);
  lines.push(`Website: ${vendor.WebAddr?.URI || "(none)"}`);
  lines.push(...formatAddress(vendor.BillAddr, "Billing Address"));
  lines.push(`Terms: ${vendor.TermRef?.name || vendor.TermRef?.value || "(none)"}`);
  lines.push(`1099 Vendor: ${vendor.Vendor1099 ?? false}`);
  lines.push(`Account Number: ${vendor.AcctNum || "(none)"}`);
  lines.push(`Balance: $${(vendor.Balance || 0).toFixed(2)}`);
  if (vendor.CurrencyRef) {
    lines.push(`Currency: ${vendor.CurrencyRef.name || vendor.CurrencyRef.value}`);
  }
  if (vendor.MetaData?.CreateTime) lines.push(`Created: ${vendor.MetaData.CreateTime}`);
  if (vendor.MetaData?.LastUpdatedTime) lines.push(`Last Updated: ${vendor.MetaData.LastUpdatedTime}`);
  lines.push("", `View in QuickBooks: ${getQboUrl("vendor", vendor.Id)}`);

  // Allowlist report fields so excluded tax identifiers, payment-bank details,
  // and other unsupported Vendor data never enter HTTP model context.
  const reportData: QBVendor = {
    Id: vendor.Id,
    SyncToken: vendor.SyncToken,
    DisplayName: vendor.DisplayName,
    Title: vendor.Title,
    GivenName: vendor.GivenName,
    MiddleName: vendor.MiddleName,
    FamilyName: vendor.FamilyName,
    Suffix: vendor.Suffix,
    CompanyName: vendor.CompanyName,
    PrintOnCheckName: vendor.PrintOnCheckName,
    PrimaryEmailAddr: vendor.PrimaryEmailAddr,
    PrimaryPhone: vendor.PrimaryPhone,
    Mobile: vendor.Mobile,
    Fax: vendor.Fax,
    WebAddr: vendor.WebAddr,
    BillAddr: vendor.BillAddr,
    Vendor1099: vendor.Vendor1099,
    AcctNum: vendor.AcctNum,
    TermRef: vendor.TermRef,
    Active: vendor.Active,
    Balance: vendor.Balance,
    CurrencyRef: vendor.CurrencyRef,
    MetaData: vendor.MetaData,
  };

  return outputReport(`vendor-${vendor.Id}`, reportData, lines.join("\n"));
}

export async function handleEditVendor(
  client: QuickBooks,
  args: VendorEditFields & { id: string; draft?: boolean }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { id, draft = true, ...fields } = args;
  validateVendorFields(fields);
  assertClearDirectives(fields);
  if (!hasEditChanges(fields)) {
    throw new Error("At least one vendor change is required");
  }

  const current = await promisify<unknown>((callback) =>
    client.getVendor(id, callback)
  ) as QBVendor;

  const updated: Record<string, unknown> = {
    Id: current.Id,
    SyncToken: current.SyncToken,
    sparse: true,
  };
  applySimpleVendorFields(updated, fields);
  if (fields.active !== undefined) updated.Active = fields.active;

  let termRef: { value: string; name: string } | undefined;
  if (fields.terms_ref !== undefined) {
    termRef = await resolveTermRef(client, fields.terms_ref);
    updated.TermRef = termRef;
  }

  if (fields.clear_email) updated.PrimaryEmailAddr = {};
  if (fields.clear_phone) updated.PrimaryPhone = {};
  if (fields.clear_mobile) updated.Mobile = {};
  if (fields.clear_fax) updated.Fax = {};
  if (fields.clear_web_address) updated.WebAddr = {};
  if (fields.clear_bill_address) updated.BillAddr = {};
  if (fields.clear_terms) updated.TermRef = { value: "" };
  if (fields.clear_account_number) updated.AcctNum = "";

  if (draft) {
    const previewLines = [
      "DRAFT - Vendor Edit Preview",
      "",
      `ID: ${current.Id}`,
      `SyncToken: ${current.SyncToken}`,
      "",
      "Changes:",
    ];

    if (fields.display_name !== undefined) addChange(previewLines, "Display Name", current.DisplayName, fields.display_name);
    if (fields.title !== undefined) addChange(previewLines, "Title", current.Title, fields.title);
    if (fields.given_name !== undefined) addChange(previewLines, "Given Name", current.GivenName, fields.given_name);
    if (fields.middle_name !== undefined) addChange(previewLines, "Middle Name", current.MiddleName, fields.middle_name);
    if (fields.family_name !== undefined) addChange(previewLines, "Family Name", current.FamilyName, fields.family_name);
    if (fields.suffix !== undefined) addChange(previewLines, "Suffix", current.Suffix, fields.suffix);
    if (fields.company_name !== undefined) addChange(previewLines, "Company", current.CompanyName, fields.company_name);
    if (fields.print_on_check_name !== undefined) addChange(previewLines, "Print on Check", current.PrintOnCheckName, fields.print_on_check_name);
    if (fields.email !== undefined || fields.clear_email) addChange(previewLines, "Email", current.PrimaryEmailAddr?.Address, fields.clear_email ? null : fields.email);
    if (fields.phone !== undefined || fields.clear_phone) addChange(previewLines, "Phone", current.PrimaryPhone?.FreeFormNumber, fields.clear_phone ? null : fields.phone);
    if (fields.mobile !== undefined || fields.clear_mobile) addChange(previewLines, "Mobile", current.Mobile?.FreeFormNumber, fields.clear_mobile ? null : fields.mobile);
    if (fields.fax !== undefined || fields.clear_fax) addChange(previewLines, "Fax", current.Fax?.FreeFormNumber, fields.clear_fax ? null : fields.fax);
    if (fields.web_address !== undefined || fields.clear_web_address) addChange(previewLines, "Website", current.WebAddr?.URI, fields.clear_web_address ? null : fields.web_address);
    if (fields.bill_address !== undefined || fields.clear_bill_address) previewLines.push(`  Billing Address: ${fields.clear_bill_address ? "clearing" : "updating"}`);
    if (fields.vendor_1099 !== undefined) addChange(previewLines, "1099 Vendor", current.Vendor1099 ?? false, fields.vendor_1099);
    if (fields.account_number !== undefined || fields.clear_account_number) addChange(previewLines, "Account Number", current.AcctNum, fields.clear_account_number ? null : fields.account_number);
    if (fields.terms_ref !== undefined || fields.clear_terms) addChange(previewLines, "Terms", current.TermRef?.name || current.TermRef?.value, fields.clear_terms ? null : termRef?.name);
    if (fields.active !== undefined) addChange(previewLines, "Active", current.Active !== false, fields.active);

    previewLines.push("", "Set draft=false to apply these changes.");
    return { content: [{ type: "text", text: previewLines.join("\n") }] };
  }

  const result = await promisify<unknown>((callback) =>
    client.updateVendor(updated, callback)
  ) as QBVendor;
  clearVendorCache();

  return {
    content: [{
      type: "text",
      text: [
        `Vendor ${result.DisplayName || current.DisplayName} updated successfully.`,
        `ID: ${result.Id || current.Id}`,
        `New SyncToken: ${result.SyncToken}`,
        `View in QuickBooks: ${getQboUrl("vendor", result.Id || current.Id)}`,
      ].join("\n"),
    }],
  };
}

export async function handleDeactivateVendor(
  client: QuickBooks,
  args: { id: string; draft?: boolean }
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { id, draft = true } = args;
  const current = await promisify<unknown>((callback) =>
    client.getVendor(id, callback)
  ) as QBVendor;

  if (current.Active === false) {
    return {
      content: [{
        type: "text",
        text: `Vendor ${current.DisplayName} (${current.Id}) is already inactive. No changes were made.`,
      }],
    };
  }

  if (draft) {
    const preview = [
      "DRAFT - Vendor Deactivation Preview",
      "",
      `ID: ${current.Id}`,
      `Display Name: ${current.DisplayName}`,
      `SyncToken: ${current.SyncToken}`,
      `Balance: $${(current.Balance || 0).toFixed(2)}`,
      "",
      "Historical transactions will remain unchanged.",
      "The vendor can be reactivated with edit_vendor using active=true.",
      "",
      "Set draft=false to deactivate this vendor.",
    ].join("\n");
    return { content: [{ type: "text", text: preview }] };
  }

  const result = await promisify<unknown>((callback) =>
    client.updateVendor({
      Id: current.Id,
      SyncToken: current.SyncToken,
      sparse: true,
      Active: false,
    }, callback)
  ) as QBVendor;
  clearVendorCache();

  return {
    content: [{
      type: "text",
      text: [
        `Vendor ${result.DisplayName || current.DisplayName} deactivated successfully.`,
        `ID: ${result.Id || current.Id}`,
        `New SyncToken: ${result.SyncToken}`,
        "Historical transactions remain unchanged.",
        `View in QuickBooks: ${getQboUrl("vendor", result.Id || current.Id)}`,
      ].join("\n"),
    }],
  };
}
