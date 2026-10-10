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
  entities: Array<Record<string, unknown>>
): unknown[] {
  const normalizedEntity = entity.toLowerCase();
  if (normalizedEntity === "attachable") {
    return entities.map((record) => safeAttachableMetadata(record as unknown as QBAttachable));
  }
  if (normalizedEntity === "company" || normalizedEntity === "companyinfo") {
    return entities.map(projectCompanyInfo);
  }
  return entities.map(redactSensitiveQueryFields);
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