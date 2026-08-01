// Shared entity resolution helpers for tool handlers.
// These operate on pre-fetched cache objects and return QB API Ref shapes.

import QuickBooks from "node-quickbooks";
import {
  getAccountCache,
  getDepartmentCache,
  getVendorCache,
  resolveCustomer,
  resolveCustomerById,
} from "../client/index.js";
import type { AccountCache, DepartmentCache, VendorCache } from "../types/cache.js";

export interface AccountRef {
  value: string;
  name: string;
  acctNum?: string;
}

export interface EntityRef {
  value: string;
  name: string;
}

export function toEntityRef(ref: AccountRef): EntityRef {
  return { value: ref.value, name: ref.name };
}

type ResolutionEntity = "account" | "department" | "vendor";

export class ResolutionNotFoundError extends Error {
  constructor(
    readonly entity: ResolutionEntity,
    message: string
  ) {
    super(message);
    this.name = "ResolutionNotFoundError";
  }
}

/**
 * Resolve an account by AcctNum, Name, or partial FullyQualifiedName match.
 * Returns a QB API AccountRef shape.
 */
export function resolveAccountRef(cache: AccountCache, nameOrId: string): AccountRef {
  const byId = cache.byId.get(nameOrId);
  if (byId) return { value: byId.Id, name: byId.FullyQualifiedName || byId.Name, acctNum: byId.AcctNum };

  const lower = nameOrId.toLowerCase();

  let match = cache.byAcctNum.get(lower);
  if (!match) match = cache.byName.get(lower);
  if (!match) {
    match = cache.items.find(a =>
      a.FullyQualifiedName?.toLowerCase().includes(lower) ||
      a.FullyQualifiedName?.toLowerCase() === lower
    );
  }
  if (!match) throw new ResolutionNotFoundError("account", `Account not found: "${nameOrId}"`);

  return {
    value: match.Id,
    name: match.FullyQualifiedName || match.Name,
    acctNum: match.AcctNum,
  };
}

/**
 * Resolve a department by ID, Name, or partial FullyQualifiedName match.
 * Returns a QB API DepartmentRef shape.
 */
export function resolveDepartmentRef(cache: DepartmentCache, nameOrId: string): EntityRef {
  const byId = cache.byId.get(nameOrId);
  if (byId) return { value: byId.Id, name: byId.FullyQualifiedName || byId.Name };

  const lower = nameOrId.toLowerCase();
  let match = cache.byName.get(lower);
  if (!match) {
    match = cache.items.find(d =>
      d.FullyQualifiedName?.toLowerCase().includes(lower)
    );
  }
  if (!match) throw new ResolutionNotFoundError("department", `Department not found: "${nameOrId}"`);

  return { value: match.Id, name: match.FullyQualifiedName || match.Name };
}

/**
 * Resolve a vendor by ID, DisplayName, or partial DisplayName match.
 * Returns a QB API VendorRef shape (no type field — caller adds if needed).
 */
export function resolveVendorRef(cache: VendorCache, nameOrId: string): EntityRef {
  const byId = cache.byId.get(nameOrId);
  if (byId) return { value: byId.Id, name: byId.DisplayName };

  const lower = nameOrId.toLowerCase();
  const byName = cache.byName.get(lower);
  if (byName) return { value: byName.Id, name: byName.DisplayName };

  const byPartial = cache.items.find(v =>
    v.DisplayName.toLowerCase().includes(lower)
  );
  if (byPartial) return { value: byPartial.Id, name: byPartial.DisplayName };

  throw new ResolutionNotFoundError("vendor", `Vendor not found: "${nameOrId}"`);
}

export interface ResolutionCaches {
  account?: AccountCache;
  department?: DepartmentCache;
  vendor?: VendorCache;
}

export interface ResolutionCoordinator {
  account(nameOrId: string): Promise<AccountRef>;
  department(nameOrId: string): Promise<EntityRef>;
  vendor(nameOrId: string): Promise<EntityRef>;
  customer(input: CustomerResolutionInput): Promise<EntityRef>;
}

export type CustomerResolutionInput =
  | { id: string; name?: never }
  | { name: string; id?: never };

export async function resolveOptionalCustomerRef(
  resolver: ResolutionCoordinator,
  input: { customer_name?: string; customer_id?: string }
): Promise<EntityRef | undefined> {
  const name = input.customer_name?.trim();
  const id = input.customer_id?.trim();
  if (name && id) {
    throw new Error("Provide only one of customer_name or customer_id per line");
  }
  if (id) return resolver.customer({ id });
  if (name) return resolver.customer({ name });
  return undefined;
}

/**
 * Create an invocation-scoped resolver that retries a cache miss once after a
 * forced refresh. Concurrent misses share one refresh promise per entity type.
 */
export function createResolutionCoordinator(
  client: QuickBooks,
  caches: ResolutionCaches = {}
): ResolutionCoordinator {
  let accountCache = caches.account;
  let departmentCache = caches.department;
  let vendorCache = caches.vendor;

  let accountLoad: Promise<AccountCache> | undefined;
  let departmentLoad: Promise<DepartmentCache> | undefined;
  let vendorLoad: Promise<VendorCache> | undefined;

  let accountRefresh: Promise<AccountCache> | undefined;
  let departmentRefresh: Promise<DepartmentCache> | undefined;
  let vendorRefresh: Promise<VendorCache> | undefined;
  const customerResolutions = new Map<string, Promise<EntityRef>>();

  const loadAccountCache = async (): Promise<AccountCache> => {
    if (accountCache) return accountCache;
    accountLoad ??= getAccountCache(client);
    accountCache = await accountLoad;
    return accountCache;
  };

  const loadDepartmentCache = async (): Promise<DepartmentCache> => {
    if (departmentCache) return departmentCache;
    departmentLoad ??= getDepartmentCache(client);
    departmentCache = await departmentLoad;
    return departmentCache;
  };

  const loadVendorCache = async (): Promise<VendorCache> => {
    if (vendorCache) return vendorCache;
    vendorLoad ??= getVendorCache(client);
    vendorCache = await vendorLoad;
    return vendorCache;
  };

  const refreshAccountCache = (): Promise<AccountCache> => {
    accountRefresh ??= getAccountCache(client, { forceRefresh: true }).then(cache => {
      accountCache = cache;
      return cache;
    });
    return accountRefresh;
  };

  const refreshDepartmentCache = (): Promise<DepartmentCache> => {
    departmentRefresh ??= getDepartmentCache(client, { forceRefresh: true }).then(cache => {
      departmentCache = cache;
      return cache;
    });
    return departmentRefresh;
  };

  const refreshVendorCache = (): Promise<VendorCache> => {
    vendorRefresh ??= getVendorCache(client, { forceRefresh: true }).then(cache => {
      vendorCache = cache;
      return cache;
    });
    return vendorRefresh;
  };

  return {
    async account(nameOrId: string): Promise<AccountRef> {
      try {
        return resolveAccountRef(await loadAccountCache(), nameOrId);
      } catch (error) {
        if (!(error instanceof ResolutionNotFoundError) || error.entity !== "account") throw error;
        return resolveAccountRef(await refreshAccountCache(), nameOrId);
      }
    },

    async department(nameOrId: string): Promise<EntityRef> {
      try {
        return resolveDepartmentRef(await loadDepartmentCache(), nameOrId);
      } catch (error) {
        if (!(error instanceof ResolutionNotFoundError) || error.entity !== "department") throw error;
        return resolveDepartmentRef(await refreshDepartmentCache(), nameOrId);
      }
    },

    async vendor(nameOrId: string): Promise<EntityRef> {
      try {
        return resolveVendorRef(await loadVendorCache(), nameOrId);
      } catch (error) {
        if (!(error instanceof ResolutionNotFoundError) || error.entity !== "vendor") throw error;
        return resolveVendorRef(await refreshVendorCache(), nameOrId);
      }
    },

    async customer(input: CustomerResolutionInput): Promise<EntityRef> {
      const id = input.id?.trim();
      const name = input.name?.trim();
      if ((!id && !name) || (id && name)) {
        throw new Error("Provide exactly one of customer_id or customer_name");
      }

      const key = id ? `id:${id}` : `name:${name!.toLowerCase()}`;
      let resolution = customerResolutions.get(key);
      if (!resolution) {
        resolution = id
          ? resolveCustomerById(client, id)
          : resolveCustomer(client, name!);
        customerResolutions.set(key, resolution);
      }
      return resolution;
    },
  };
}
