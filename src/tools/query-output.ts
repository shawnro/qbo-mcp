import type { QBAttachable } from "../types/index.js";
import { safeAttachableMetadata } from "./attachable-fields.js";

const SENSITIVE_QUERY_FIELDS = new Set([
  "employerid",
  "fileaccessuri",
  "namevalue",
  "primarytaxidentifier",
  "ssn",
  "taxidentifier",
  "tempdownloaduri",
  "thumbnailfileaccessuri",
  "thumbnailtempdownloaduri",
  "vendorpaymentbankdetail",
]);

interface CompanyInfo {
  Id?: string;
  CompanyName?: string;
  LegalName?: string;
  Country?: string;
  FiscalYearStartMonth?: string;
}

type FieldProjection = {
  readonly [field: string]: true | FieldProjection;
};

const referenceProjection: FieldProjection = { value: true, name: true, type: true };
const metadataProjection: FieldProjection = { CreateTime: true, LastUpdatedTime: true };
const addressProjection: FieldProjection = {
  Id: true,
  Line1: true,
  Line2: true,
  Line3: true,
  Line4: true,
  Line5: true,
  City: true,
  Country: true,
  CountrySubDivisionCode: true,
  PostalCode: true,
  Lat: true,
  Long: true,
};
const customFieldProjection: FieldProjection = {
  DefinitionId: true,
  Name: true,
  Type: true,
  StringValue: true,
  NumberValue: true,
  DateValue: true,
};
const entityProjection: FieldProjection = {
  Type: true,
  EntityRef: referenceProjection,
};
const linkedTransactionProjection: FieldProjection = {
  TxnId: true,
  TxnType: true,
  TxnLineId: true,
};
const transactionLineProjection: FieldProjection = {
  Id: true,
  LineNum: true,
  Description: true,
  Amount: true,
  DetailType: true,
  LinkedTxn: linkedTransactionProjection,
  JournalEntryLineDetail: {
    PostingType: true,
    AccountRef: referenceProjection,
    Entity: entityProjection,
    DepartmentRef: referenceProjection,
    ClassRef: referenceProjection,
    TaxCodeRef: referenceProjection,
    BillableStatus: true,
  },
  AccountBasedExpenseLineDetail: {
    AccountRef: referenceProjection,
    CustomerRef: referenceProjection,
    DepartmentRef: referenceProjection,
    ClassRef: referenceProjection,
    TaxCodeRef: referenceProjection,
    BillableStatus: true,
  },
  ItemBasedExpenseLineDetail: {
    ItemRef: referenceProjection,
    AccountRef: referenceProjection,
    CustomerRef: referenceProjection,
    DepartmentRef: referenceProjection,
    ClassRef: referenceProjection,
    TaxCodeRef: referenceProjection,
    BillableStatus: true,
    Qty: true,
    UnitPrice: true,
  },
  SalesItemLineDetail: {
    ItemRef: referenceProjection,
    ServiceDate: true,
    CustomerRef: referenceProjection,
    DepartmentRef: referenceProjection,
    ClassRef: referenceProjection,
    TaxCodeRef: referenceProjection,
    Qty: true,
    UnitPrice: true,
  },
  DepositLineDetail: {
    AccountRef: referenceProjection,
    Entity: entityProjection,
    ClassRef: referenceProjection,
    PaymentMethodRef: referenceProjection,
    CheckNum: true,
  },
  PaymentLineDetail: {
    ItemRef: referenceProjection,
    ServiceDate: true,
    Discount: true,
  },
};
const transactionProjection: FieldProjection = {
  Id: true,
  SyncToken: true,
  TxnDate: true,
  DocNumber: true,
  PrivateNote: true,
  CustomerMemo: { value: true },
  TotalAmt: true,
  Balance: true,
  HomeBalance: true,
  CurrencyRef: referenceProjection,
  ExchangeRate: true,
  DepartmentRef: referenceProjection,
  ClassRef: referenceProjection,
  CustomerRef: referenceProjection,
  VendorRef: referenceProjection,
  EntityRef: referenceProjection,
  AccountRef: referenceProjection,
  DepositToAccountRef: referenceProjection,
  ARAccountRef: referenceProjection,
  APAccountRef: referenceProjection,
  PaymentMethodRef: referenceProjection,
  PaymentType: true,
  PrintStatus: true,
  EmailStatus: true,
  DueDate: true,
  ShipDate: true,
  TrackingNum: true,
  ApplyTaxAfterDiscount: true,
  GlobalTaxCalculation: true,
  BillEmail: { Address: true },
  BillAddr: addressProjection,
  ShipAddr: addressProjection,
  TxnTaxDetail: {
    TotalTax: true,
    TxnTaxCodeRef: referenceProjection,
    TaxLine: {
      Amount: true,
      DetailType: true,
      TaxLineDetail: {
        TaxRateRef: referenceProjection,
        PercentBased: true,
        TaxPercent: true,
        NetAmountTaxable: true,
      },
    },
  },
  CustomField: customFieldProjection,
  Line: transactionLineProjection,
  MetaData: metadataProjection,
  QboLink: true,
};
const nameProjection: FieldProjection = {
  Id: true,
  SyncToken: true,
  Name: true,
  FullyQualifiedName: true,
  Active: true,
  ParentRef: referenceProjection,
  MetaData: metadataProjection,
};

const hostedQueryProjections = {
  account: {
    ...nameProjection,
    AcctNum: true,
    Description: true,
    Classification: true,
    AccountType: true,
    AccountSubType: true,
    SubAccount: true,
    CurrentBalance: true,
    CurrentBalanceWithSubAccounts: true,
    CurrencyRef: referenceProjection,
  },
  bill: transactionProjection,
  billpayment: transactionProjection,
  class: { ...nameProjection, SubClass: true },
  creditmemo: transactionProjection,
  customer: {
    Id: true,
    SyncToken: true,
    DisplayName: true,
    GivenName: true,
    MiddleName: true,
    FamilyName: true,
    Suffix: true,
    CompanyName: true,
    FullyQualifiedName: true,
    Active: true,
    PrimaryEmailAddr: { Address: true },
    PrimaryPhone: { FreeFormNumber: true },
    Mobile: { FreeFormNumber: true },
    BillAddr: addressProjection,
    ShipAddr: addressProjection,
    Notes: true,
    Taxable: true,
    Balance: true,
    BalanceWithJobs: true,
    Job: true,
    BillWithParent: true,
    ParentRef: referenceProjection,
    PreferredDeliveryMethod: true,
    SalesTermRef: referenceProjection,
    CurrencyRef: referenceProjection,
    MetaData: metadataProjection,
  },
  department: { ...nameProjection, SubDepartment: true },
  deposit: transactionProjection,
  estimate: transactionProjection,
  invoice: transactionProjection,
  item: {
    ...nameProjection,
    Description: true,
    Type: true,
    Sku: true,
    SubItem: true,
    Level: true,
    Taxable: true,
    UnitPrice: true,
    PurchaseCost: true,
    QtyOnHand: true,
    InvStartDate: true,
    TrackQtyOnHand: true,
    IncomeAccountRef: referenceProjection,
    ExpenseAccountRef: referenceProjection,
    AssetAccountRef: referenceProjection,
  },
  journalentry: transactionProjection,
  payment: transactionProjection,
  purchase: transactionProjection,
  purchaseorder: transactionProjection,
  refundreceipt: transactionProjection,
  salesreceipt: transactionProjection,
  taxagency: {
    Id: true,
    SyncToken: true,
    DisplayName: true,
    TaxTrackedOnPurchases: true,
    TaxTrackedOnSales: true,
    LastFileDate: true,
    MetaData: metadataProjection,
  },
  term: {
    Id: true,
    SyncToken: true,
    Name: true,
    Active: true,
    Type: true,
    DiscountPercent: true,
    DueDays: true,
    DayOfMonthDue: true,
    DiscountDays: true,
    DiscountDayOfMonth: true,
    MetaData: metadataProjection,
  },
  transfer: transactionProjection,
  vendor: {
    Id: true,
    SyncToken: true,
    DisplayName: true,
    Title: true,
    GivenName: true,
    MiddleName: true,
    FamilyName: true,
    Suffix: true,
    CompanyName: true,
    PrintOnCheckName: true,
    Active: true,
    PrimaryEmailAddr: { Address: true },
    PrimaryPhone: { FreeFormNumber: true },
    Mobile: { FreeFormNumber: true },
    Fax: { FreeFormNumber: true },
    WebAddr: { URI: true },
    BillAddr: addressProjection,
    Vendor1099: true,
    AcctNum: true,
    TermRef: referenceProjection,
    Balance: true,
    CurrencyRef: referenceProjection,
    MetaData: metadataProjection,
  },
  vendorcredit: transactionProjection,
} satisfies Record<string, FieldProjection>;

const hostedQueryEntityNames = {
  account: "Account",
  bill: "Bill",
  billpayment: "BillPayment",
  class: "Class",
  creditmemo: "CreditMemo",
  customer: "Customer",
  department: "Department",
  deposit: "Deposit",
  estimate: "Estimate",
  invoice: "Invoice",
  item: "Item",
  journalentry: "JournalEntry",
  payment: "Payment",
  purchase: "Purchase",
  purchaseorder: "PurchaseOrder",
  refundreceipt: "RefundReceipt",
  salesreceipt: "SalesReceipt",
  taxagency: "TaxAgency",
  term: "Term",
  transfer: "Transfer",
  vendor: "Vendor",
  vendorcredit: "VendorCredit",
} satisfies Record<keyof typeof hostedQueryProjections, string>;

export const HOSTED_QUERY_ENTITIES = Object.freeze([
  ...Object.values(hostedQueryEntityNames),
  "Attachable",
  "CompanyInfo",
].sort());

export function projectCompanyInfo(company: unknown): CompanyInfo {
  const source = company as CompanyInfo;
  return {
    Id: source.Id,
    CompanyName: source.CompanyName,
    LegalName: source.LegalName,
    Country: source.Country,
    FiscalYearStartMonth: source.FiscalYearStartMonth,
  };
}

export function projectQueryEntities(
  entity: string,
  entities: Array<Record<string, unknown>>,
  mode: "local" | "hosted" = "local"
): unknown[] {
  const normalizedEntity = entity.toLowerCase();
  if (normalizedEntity === "attachable") {
    return entities.map((record) => safeAttachableMetadata(record as unknown as QBAttachable));
  }
  if (normalizedEntity === "company" || normalizedEntity === "companyinfo") {
    return entities.map(projectCompanyInfo);
  }
  if (mode === "hosted") {
    const projection = getHostedQueryProjection(normalizedEntity);
    if (!projection) throw unsupportedHostedQueryEntity(entity);
    return entities.map((record) => projectFields(record, projection));
  }
  return entities.map(redactSensitiveQueryFields);
}

export function assertHostedQueryEntitySupported(entity: string): void {
  const normalizedEntity = entity.toLowerCase();
  if (
    normalizedEntity !== "attachable" &&
    normalizedEntity !== "company" &&
    normalizedEntity !== "companyinfo" &&
    !getHostedQueryProjection(normalizedEntity)
  ) {
    throw unsupportedHostedQueryEntity(entity);
  }
}

function getHostedQueryProjection(entity: string): FieldProjection | undefined {
  if (!Object.prototype.hasOwnProperty.call(hostedQueryProjections, entity)) return undefined;
  return hostedQueryProjections[entity as keyof typeof hostedQueryProjections];
}

function unsupportedHostedQueryEntity(entity: string): Error {
  return new Error(
    `Entity type ${entity} is unavailable in hosted generic queries because it does not have a reviewed privacy projection. Supported entities: ${HOSTED_QUERY_ENTITIES.join(", ")}`
  );
}

function projectFields(
  value: Record<string, unknown>,
  projection: FieldProjection
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [field, fieldProjection] of Object.entries(projection)) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    const projected = projectValue(value[field], fieldProjection);
    if (projected !== undefined) result[field] = projected;
  }
  return result;
}

function projectValue(value: unknown, projection: true | FieldProjection): unknown {
  if (projection === true) {
    return typeof value === "object" && value !== null ? undefined : value;
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => projectFields(entry, projection));
  }
  if (typeof value !== "object" || value === null) return undefined;
  return projectFields(value as Record<string, unknown>, projection);
}

function redactSensitiveQueryFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveQueryFields);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_QUERY_FIELDS.has(key.toLowerCase()))
      .map(([key, nestedValue]) => [key, redactSensitiveQueryFields(nestedValue)])
  );
}