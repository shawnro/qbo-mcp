// Account and department caching for QuickBooks lookups

import QuickBooks from "node-quickbooks";
import { promisify } from "./promisify.js";
import {
  CachedAccount,
  CachedCustomer,
  CachedDepartment,
  CachedVendor,
  CachedItem,
  AccountCache,
  DepartmentCache,
  VendorCache,
  QBQueryResponse,
} from "../types/index.js";

// Cache TTL (15 minutes)
const LOOKUP_CACHE_TTL_MS = 15 * 60 * 1000;

export interface LookupCacheOptions {
  forceRefresh?: boolean;
}

// Module-level cache state
let departmentCache: DepartmentCache | null = null;
let accountCache: AccountCache | null = null;
let vendorCache: VendorCache | null = null;
// Item cache: lazy per-entry lookup (not bulk-loaded like others)
const itemCacheById = new Map<string, CachedItem>();
const itemCacheByName = new Map<string, CachedItem>(); // lowercase key
// Customer cache: lazy per-entry lookup (companies can have thousands)
const customerCacheById = new Map<string, CachedCustomer>();
const customerCacheByName = new Map<string, CachedCustomer>(); // lowercase key

export function clearLookupCache(): void {
  departmentCache = null;
  accountCache = null;
  vendorCache = null;
  itemCacheById.clear();
  itemCacheByName.clear();
  customerCacheById.clear();
  customerCacheByName.clear();
}

// Helper to extract entities from QB query response with type safety
function extractQueryResults<T>(result: unknown, entityKey: string): T[] {
  const response = result as QBQueryResponse<T> | undefined;
  const entities = response?.QueryResponse?.[entityKey];
  return Array.isArray(entities) ? entities : [];
}

export async function getDepartmentCache(
  client: QuickBooks,
  options: LookupCacheOptions = {}
): Promise<DepartmentCache> {
  if (!options.forceRefresh && departmentCache && (Date.now() - departmentCache.fetchedAt) < LOOKUP_CACHE_TTL_MS) {
    return departmentCache;
  }

  const result = await promisify<unknown>((cb) => client.findDepartments({ fetchAll: true }, cb));
  const items = extractQueryResults<CachedDepartment>(result, 'Department');

  const byId = new Map<string, CachedDepartment>();
  const byName = new Map<string, CachedDepartment>();
  for (const dept of items) {
    byId.set(dept.Id, dept);
    byName.set(dept.Name.toLowerCase(), dept);
  }

  departmentCache = { items, byId, byName, fetchedAt: Date.now() };
  return departmentCache;
}

export async function getAccountCache(
  client: QuickBooks,
  options: LookupCacheOptions = {}
): Promise<AccountCache> {
  if (!options.forceRefresh && accountCache && (Date.now() - accountCache.fetchedAt) < LOOKUP_CACHE_TTL_MS) {
    return accountCache;
  }

  const result = await promisify<unknown>((cb) => client.findAccounts({ fetchAll: true }, cb));
  const items = extractQueryResults<CachedAccount>(result, 'Account');

  const byId = new Map<string, CachedAccount>();
  const byName = new Map<string, CachedAccount>();
  const byAcctNum = new Map<string, CachedAccount>();
  for (const acct of items) {
    byId.set(acct.Id, acct);
    byName.set(acct.Name.toLowerCase(), acct);
    if (acct.AcctNum) {
      byAcctNum.set(acct.AcctNum.toLowerCase(), acct);
    }
  }

  accountCache = { items, byId, byName, byAcctNum, fetchedAt: Date.now() };
  return accountCache;
}

// Resolve account by name, AcctNum, or ID using cache
export async function resolveAccount(client: QuickBooks, account: string): Promise<CachedAccount> {
  const findAccount = (cache: AccountCache): CachedAccount | undefined => {
    const lower = account.toLowerCase();
    return cache.byId.get(account)
      || cache.byAcctNum.get(lower)
      || cache.byName.get(lower)
      || cache.items.find(a => a.FullyQualifiedName?.toLowerCase().includes(lower));
  };

  let match = findAccount(await getAccountCache(client));
  if (match) return match;

  match = findAccount(await getAccountCache(client, { forceRefresh: true }));
  if (match) return match;

  throw new Error(`Account not found: "${account}". Try using account name, number (AcctNum), or ID.`);
}

export async function getVendorCache(
  client: QuickBooks,
  options: LookupCacheOptions = {}
): Promise<VendorCache> {
  if (!options.forceRefresh && vendorCache && (Date.now() - vendorCache.fetchedAt) < LOOKUP_CACHE_TTL_MS) {
    return vendorCache;
  }

  const result = await promisify<unknown>((cb) => client.findVendors({ fetchAll: true }, cb));
  const items = extractQueryResults<CachedVendor>(result, 'Vendor');

  const byId = new Map<string, CachedVendor>();
  const byName = new Map<string, CachedVendor>();
  for (const vendor of items) {
    byId.set(vendor.Id, vendor);
    byName.set(vendor.DisplayName.toLowerCase(), vendor);
  }

  vendorCache = { items, byId, byName, fetchedAt: Date.now() };
  return vendorCache;
}

// Resolve vendor by name or ID using cache
// Returns { value, name } ref object for QuickBooks API
export async function resolveVendor(client: QuickBooks, nameOrId: string): Promise<{ value: string; name: string }> {
  const findVendor = (cache: VendorCache): CachedVendor | undefined => {
    const lower = nameOrId.toLowerCase();
    return cache.byId.get(nameOrId)
      || cache.byName.get(lower)
      || cache.items.find(v => v.DisplayName.toLowerCase().includes(lower));
  };

  let match = findVendor(await getVendorCache(client));
  if (match) return { value: match.Id, name: match.DisplayName };

  match = findVendor(await getVendorCache(client, { forceRefresh: true }));
  if (match) return { value: match.Id, name: match.DisplayName };

  throw new Error(`Vendor not found: "${nameOrId}". Try using vendor display name or ID.`);
}

// Resolve item by name or ID using lazy per-entry cache
// Unlike other caches, items are fetched on demand (companies can have thousands)
export async function resolveItem(client: QuickBooks, nameOrId: string): Promise<{ value: string; name: string }> {
  // Check cache first (with TTL)
  const cached = itemCacheById.get(nameOrId) || itemCacheByName.get(nameOrId.toLowerCase());
  if (cached && (Date.now() - cached.fetchedAt) < LOOKUP_CACHE_TTL_MS) {
    return { value: cached.Id, name: cached.Name };
  }

  // Query QB for this specific item
  // Try exact name match first, then partial
  const result = await promisify<unknown>((cb) =>
    client.findItems([
      { field: 'Name', value: nameOrId, operator: '=' },
      { field: 'Active', value: true, operator: '=' },
    ], cb)
  );
  let items = extractQueryResults<{ Id: string; Name: string; FullyQualifiedName?: string; Type?: string; UnitPrice?: number; Active?: boolean }>(result, 'Item');

  // If no exact match, try LIKE for partial matching
  if (items.length === 0) {
    const partialResult = await promisify<unknown>((cb) =>
      client.findItems([
        { field: 'Name', value: `%${nameOrId}%`, operator: 'LIKE' },
        { field: 'Active', value: true, operator: '=' },
      ], cb)
    );
    items = extractQueryResults<typeof items[0]>(partialResult, 'Item');
  }

  if (items.length === 0) {
    throw new Error(`Item not found: "${nameOrId}". Try using the exact item name or ID.`);
  }

  // Use first match and cache it
  const item = items[0];
  const entry: CachedItem = {
    Id: item.Id,
    Name: item.Name,
    FullyQualifiedName: item.FullyQualifiedName,
    Type: item.Type,
    UnitPrice: item.UnitPrice,
    Active: item.Active,
    fetchedAt: Date.now(),
  };
  itemCacheById.set(item.Id, entry);
  itemCacheByName.set(item.Name.toLowerCase(), entry);

  return { value: item.Id, name: item.Name };
}

// Helper to resolve department name to ID using cache
// Accepts: internal ID (e.g., "5"), name (e.g., "20400"), or partial match
export async function resolveDepartmentId(client: QuickBooks, department: string): Promise<string> {
  const findDepartment = (cache: DepartmentCache): CachedDepartment | undefined => {
    const lower = department.toLowerCase();
    return cache.byId.get(department)
      || cache.byName.get(lower)
      || cache.items.find(d => d.FullyQualifiedName?.toLowerCase().includes(lower));
  };

  let match = findDepartment(await getDepartmentCache(client));
  if (match) return match.Id;

  match = findDepartment(await getDepartmentCache(client, { forceRefresh: true }));
  if (match) return match.Id;

  // If nothing found, return as-is (let API handle error)
  return department;
}

function cacheCustomer(customer: {
  Id: string;
  DisplayName: string;
  FullyQualifiedName?: string;
  Active?: boolean;
}): CachedCustomer {
  const entry: CachedCustomer = {
    ...customer,
    fetchedAt: Date.now(),
  };
  customerCacheById.set(entry.Id, entry);
  customerCacheByName.set(entry.DisplayName.toLowerCase(), entry);
  if (entry.FullyQualifiedName) {
    customerCacheByName.set(entry.FullyQualifiedName.toLowerCase(), entry);
  }
  return entry;
}

function customerRef(customer: CachedCustomer): { value: string; name: string } {
  return {
    value: customer.Id,
    name: customer.FullyQualifiedName || customer.DisplayName,
  };
}

// Resolve customer by ID using direct read and lazy per-entry cache.
export async function resolveCustomerById(
  client: QuickBooks,
  id: string
): Promise<{ value: string; name: string }> {
  const cached = customerCacheById.get(id);
  if (cached && (Date.now() - cached.fetchedAt) < LOOKUP_CACHE_TTL_MS) {
    return customerRef(cached);
  }

  const customer = await promisify<unknown>((cb) => client.getCustomer(id, cb)) as {
    Id?: string;
    DisplayName?: string;
    FullyQualifiedName?: string;
    Active?: boolean;
  };

  if (!customer.Id || !customer.DisplayName || customer.Active === false) {
    throw new Error(`Customer not found or inactive: "${id}".`);
  }

  return customerRef(cacheCustomer({
    Id: customer.Id,
    DisplayName: customer.DisplayName,
    FullyQualifiedName: customer.FullyQualifiedName,
    Active: customer.Active,
  }));
}

// Resolve customer by display name or hierarchical FullyQualifiedName using
// lazy per-entry cache. Unlike bulk caches, customers are fetched on demand
// because companies can have thousands.
export async function resolveCustomer(client: QuickBooks, nameOrId: string): Promise<{ value: string; name: string }> {
  // Check cache first (with TTL)
  const cached = customerCacheByName.get(nameOrId.toLowerCase());
  if (cached && (Date.now() - cached.fetchedAt) < LOOKUP_CACHE_TTL_MS) {
    return customerRef(cached);
  }

  // DisplayName cannot contain a colon, so hierarchical input unambiguously
  // targets FullyQualifiedName (for example, "Customer:Job").
  const nameField = nameOrId.includes(':') ? 'FullyQualifiedName' : 'DisplayName';

  // Query QB for this specific customer/job — exact match first.
  const result = await promisify<unknown>((cb) =>
    client.findCustomers([
      { field: nameField, value: nameOrId, operator: '=' },
      { field: 'Active', value: true, operator: '=' },
    ], cb)
  );
  let customers = extractQueryResults<{
    Id: string;
    DisplayName: string;
    FullyQualifiedName?: string;
    Active?: boolean;
  }>(result, 'Customer');

  // If no exact match, try LIKE for partial matching
  if (customers.length === 0) {
    const partialResult = await promisify<unknown>((cb) =>
      client.findCustomers([
        { field: nameField, value: `%${nameOrId}%`, operator: 'LIKE' },
        { field: 'Active', value: true, operator: '=' },
      ], cb)
    );
    customers = extractQueryResults<typeof customers[0]>(partialResult, 'Customer');
  }

  if (customers.length === 0) {
    throw new Error(`Customer not found: "${nameOrId}". Try using the exact customer display name or ID.`);
  }

  if (customers.length > 1) {
    const matches = customers
      .slice(0, 5)
      .map(customer => customer.FullyQualifiedName || customer.DisplayName)
      .join(', ');
    throw new Error(
      `Customer name is ambiguous: "${nameOrId}". ` +
      `Use an exact display/fully qualified name or ID. Matches: ${matches}`
    );
  }

  // Use first match and cache it
  return customerRef(cacheCustomer(customers[0]));
}
