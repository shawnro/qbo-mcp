// Account and department caching for QuickBooks lookups

import QuickBooks from "node-quickbooks";
import { promisify } from "./promisify.js";
import { resolveUniqueName } from "./name-resolution.js";
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

export interface QboLookupCache {
  department: DepartmentCache | null;
  account: AccountCache | null;
  vendor: VendorCache | null;
  vendorGeneration: number;
  readonly itemById: Map<string, CachedItem>;
  readonly itemByName: Map<string, CachedItem>;
  readonly customerById: Map<string, CachedCustomer>;
  readonly customerByName: Map<string, CachedCustomer>;
}

export function createLookupCache(): QboLookupCache {
  return {
    department: null,
    account: null,
    vendor: null,
    vendorGeneration: 0,
    itemById: new Map(),
    itemByName: new Map(),
    customerById: new Map(),
    customerByName: new Map(),
  };
}

const defaultLookupCache = createLookupCache();

export function clearVendorCache(cache: QboLookupCache = defaultLookupCache): void {
  cache.vendor = null;
  cache.vendorGeneration++;
}

export function clearLookupCache(cache: QboLookupCache = defaultLookupCache): void {
  cache.department = null;
  cache.account = null;
  clearVendorCache(cache);
  cache.itemById.clear();
  cache.itemByName.clear();
  cache.customerById.clear();
  cache.customerByName.clear();
}

// Helper to extract entities from QB query response with type safety
function extractQueryResults<T>(result: unknown, entityKey: string): T[] {
  const response = result as QBQueryResponse<T> | undefined;
  const entities = response?.QueryResponse?.[entityKey];
  return Array.isArray(entities) ? entities : [];
}

export async function getDepartmentCache(
  client: QuickBooks,
  options: LookupCacheOptions = {},
  cache: QboLookupCache = defaultLookupCache
): Promise<DepartmentCache> {
  if (!options.forceRefresh && cache.department && (Date.now() - cache.department.fetchedAt) < LOOKUP_CACHE_TTL_MS) {
    return cache.department;
  }

  const result = await promisify<unknown>((cb) => client.findDepartments({ fetchAll: true }, cb));
  const items = extractQueryResults<CachedDepartment>(result, 'Department');

  const byId = new Map<string, CachedDepartment>();
  const byName = new Map<string, CachedDepartment>();
  for (const dept of items) {
    byId.set(dept.Id, dept);
    byName.set(dept.Name.toLowerCase(), dept);
  }

  cache.department = { items, byId, byName, fetchedAt: Date.now() };
  return cache.department;
}

export async function getAccountCache(
  client: QuickBooks,
  options: LookupCacheOptions = {},
  cache: QboLookupCache = defaultLookupCache
): Promise<AccountCache> {
  if (!options.forceRefresh && cache.account && (Date.now() - cache.account.fetchedAt) < LOOKUP_CACHE_TTL_MS) {
    return cache.account;
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

  cache.account = { items, byId, byName, byAcctNum, fetchedAt: Date.now() };
  return cache.account;
}

// Resolve account by name, AcctNum, or ID using cache
export async function resolveAccount(
  client: QuickBooks,
  account: string,
  cache: QboLookupCache = defaultLookupCache
): Promise<CachedAccount> {
  const findAccount = (cache: AccountCache): CachedAccount | undefined => {
    const lower = account.toLowerCase();
    return cache.byId.get(account)
      || cache.byAcctNum.get(lower)
      || resolveUniqueName("Account", account, cache.items.map(item => ({
        value: item,
        names: [item.FullyQualifiedName, item.Name],
        label: `${item.FullyQualifiedName || item.Name} (ID: ${item.Id}${item.AcctNum ? `, AcctNum: ${item.AcctNum}` : ""})`,
      })));
  };

  let match = findAccount(await getAccountCache(client, {}, cache));
  if (match) return match;

  match = findAccount(await getAccountCache(client, { forceRefresh: true }, cache));
  if (match) return match;

  throw new Error(`Account not found: "${account}". Try using account name, number (AcctNum), or ID.`);
}

export async function getVendorCache(
  client: QuickBooks,
  options: LookupCacheOptions = {},
  cache: QboLookupCache = defaultLookupCache
): Promise<VendorCache> {
  if (!options.forceRefresh && cache.vendor && (Date.now() - cache.vendor.fetchedAt) < LOOKUP_CACHE_TTL_MS) {
    return cache.vendor;
  }

  const generation = cache.vendorGeneration;
  const result = await promisify<unknown>((cb) => client.findVendors({ fetchAll: true }, cb));
  const items = extractQueryResults<CachedVendor>(result, 'Vendor');

  const byId = new Map<string, CachedVendor>();
  const byName = new Map<string, CachedVendor>();
  for (const vendor of items) {
    byId.set(vendor.Id, vendor);
    byName.set(vendor.DisplayName.toLowerCase(), vendor);
  }

  const refreshed = { items, byId, byName, fetchedAt: Date.now() };
  if (generation === cache.vendorGeneration) {
    cache.vendor = refreshed;
  }
  return refreshed;
}

// Resolve vendor by name or ID using cache
// Returns { value, name } ref object for QuickBooks API
export async function resolveVendor(
  client: QuickBooks,
  nameOrId: string,
  cache: QboLookupCache = defaultLookupCache
): Promise<{ value: string; name: string }> {
  const findVendor = (cache: VendorCache): CachedVendor | undefined => {
    return cache.byId.get(nameOrId)
      || resolveUniqueName("Vendor", nameOrId, cache.items.map(item => ({
        value: item,
        names: [item.DisplayName],
        label: `${item.DisplayName} (ID: ${item.Id})`,
      })));
  };

  let match = findVendor(await getVendorCache(client, {}, cache));
  if (match) return { value: match.Id, name: match.DisplayName };

  match = findVendor(await getVendorCache(client, { forceRefresh: true }, cache));
  if (match) return { value: match.Id, name: match.DisplayName };

  throw new Error(`Vendor not found: "${nameOrId}". Try using vendor display name or ID.`);
}

// Resolve item by name or ID using lazy per-entry cache
// Unlike other caches, items are fetched on demand (companies can have thousands)
export async function resolveItem(
  client: QuickBooks,
  nameOrId: string,
  cache: QboLookupCache = defaultLookupCache
): Promise<{ value: string; name: string }> {
  // Check cache first (with TTL)
  const cached = cache.itemById.get(nameOrId) || cache.itemByName.get(nameOrId.toLowerCase());
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

  const item = resolveUniqueName("Item", nameOrId, items.map(candidate => ({
    value: candidate,
    names: [candidate.FullyQualifiedName, candidate.Name],
    label: `${candidate.FullyQualifiedName || candidate.Name} (ID: ${candidate.Id})`,
  })));
  if (!item) {
    throw new Error(`Item not found: "${nameOrId}". Try using the exact item name or ID.`);
  }
  const entry: CachedItem = {
    Id: item.Id,
    Name: item.Name,
    FullyQualifiedName: item.FullyQualifiedName,
    Type: item.Type,
    UnitPrice: item.UnitPrice,
    Active: item.Active,
    fetchedAt: Date.now(),
  };
  cache.itemById.set(item.Id, entry);
  cache.itemByName.set(item.Name.toLowerCase(), entry);

  return { value: item.Id, name: item.Name };
}

// Helper to resolve department name to ID using cache
// Accepts: internal ID (e.g., "5"), name (e.g., "20400"), or partial match
export async function resolveDepartmentId(
  client: QuickBooks,
  department: string,
  cache: QboLookupCache = defaultLookupCache
): Promise<string> {
  const findDepartment = (cache: DepartmentCache): CachedDepartment | undefined => {
    return cache.byId.get(department)
      || resolveUniqueName("Department", department, cache.items.map(item => ({
        value: item,
        names: [item.FullyQualifiedName, item.Name],
        label: `${item.FullyQualifiedName || item.Name} (ID: ${item.Id})`,
      })));
  };

  let match = findDepartment(await getDepartmentCache(client, {}, cache));
  if (match) return match.Id;

  match = findDepartment(await getDepartmentCache(client, { forceRefresh: true }, cache));
  if (match) return match.Id;

  throw new Error(`Department not found: "${department}". Try using the exact department name or ID.`);
}

function cacheCustomer(cache: QboLookupCache, customer: {
  Id: string;
  DisplayName: string;
  FullyQualifiedName?: string;
  Active?: boolean;
}): CachedCustomer {
  const entry: CachedCustomer = {
    ...customer,
    fetchedAt: Date.now(),
  };
  cache.customerById.set(entry.Id, entry);
  if (entry.FullyQualifiedName) {
    cache.customerByName.set(entry.FullyQualifiedName.toLowerCase(), entry);
  }
  if (!entry.FullyQualifiedName || entry.FullyQualifiedName === entry.DisplayName) {
    cache.customerByName.set(entry.DisplayName.toLowerCase(), entry);
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
  id: string,
  cache: QboLookupCache = defaultLookupCache
): Promise<{ value: string; name: string }> {
  const cached = cache.customerById.get(id);
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

  return customerRef(cacheCustomer(cache, {
    Id: customer.Id,
    DisplayName: customer.DisplayName,
    FullyQualifiedName: customer.FullyQualifiedName,
    Active: customer.Active,
  }));
}

// Resolve customer by display name or hierarchical FullyQualifiedName using
// lazy per-entry cache. Unlike bulk caches, customers are fetched on demand
// because companies can have thousands.
export async function resolveCustomer(
  client: QuickBooks,
  nameOrId: string,
  cache: QboLookupCache = defaultLookupCache
): Promise<{ value: string; name: string }> {
  // Check cache first (with TTL)
  const cached = cache.customerByName.get(nameOrId.toLowerCase());
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

  const customer = resolveUniqueName("Customer", nameOrId, customers.map(candidate => ({
    value: candidate,
    names: [candidate.FullyQualifiedName, candidate.DisplayName],
    label: `${candidate.FullyQualifiedName || candidate.DisplayName} (ID: ${candidate.Id})`,
  })));
  if (!customer) {
    throw new Error(`Customer not found: "${nameOrId}". Try using the exact customer display name or ID.`);
  }

  return customerRef(cacheCustomer(cache, customer));
}
