import QuickBooks from "node-quickbooks";
import { promisify } from "../client/index.js";

export interface AddressInput {
  line1?: string;
  line2?: string;
  line3?: string;
  line4?: string;
  line5?: string;
  city?: string;
  country_sub_division_code?: string;
  postal_code?: string;
  country?: string;
  lat?: string;
  long?: string;
}

export interface QBAddress {
  Line1?: string;
  Line2?: string;
  Line3?: string;
  Line4?: string;
  Line5?: string;
  City?: string;
  CountrySubDivisionCode?: string;
  PostalCode?: string;
  Country?: string;
  Lat?: string;
  Long?: string;
}

export function buildQBAddress(input: AddressInput): QBAddress {
  const address: QBAddress = {};
  if (input.line1) address.Line1 = input.line1;
  if (input.line2) address.Line2 = input.line2;
  if (input.line3) address.Line3 = input.line3;
  if (input.line4) address.Line4 = input.line4;
  if (input.line5) address.Line5 = input.line5;
  if (input.city) address.City = input.city;
  if (input.country_sub_division_code) address.CountrySubDivisionCode = input.country_sub_division_code;
  if (input.postal_code) address.PostalCode = input.postal_code;
  if (input.country) address.Country = input.country;
  if (input.lat) address.Lat = input.lat;
  if (input.long) address.Long = input.long;
  return address;
}

export function formatAddress(address: QBAddress | undefined, label: string): string[] {
  if (!address) return [`${label}: (none)`];
  const parts: string[] = [];
  for (const key of ["Line1", "Line2", "Line3", "Line4", "Line5"] as const) {
    if (address[key]) parts.push(address[key]);
  }
  if (address.City || address.CountrySubDivisionCode || address.PostalCode) {
    const cityState = [address.City, address.CountrySubDivisionCode].filter(Boolean).join(", ");
    parts.push([cityState, address.PostalCode].filter(Boolean).join(" "));
  }
  if (address.Country) parts.push(address.Country);
  if (parts.length === 0) return [`${label}: (none)`];
  return [`${label}:`, ...parts.map((part) => `  ${part}`)];
}

export async function resolveTermRef(
  client: QuickBooks,
  nameOrId: string
): Promise<{ value: string; name: string }> {
  const result = await promisify<unknown>((callback) => client.findTerms(callback)) as {
    QueryResponse?: { Term?: Array<{ Id: string; Name: string }> };
  };
  const terms = result.QueryResponse?.Term ?? [];
  const match = terms.find((term) =>
    term.Id === nameOrId || term.Name.toLowerCase() === nameOrId.toLowerCase()
  );
  if (!match) {
    const available = terms.map((term) => term.Name).join(", ");
    throw new Error(`Term not found: "${nameOrId}". Available: ${available}`);
  }
  return { value: match.Id, name: match.Name };
}