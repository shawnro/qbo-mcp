// Shared entity resolution helpers for tool handlers.
// These operate on pre-fetched cache objects and return QB API Ref shapes.

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
  if (!match) throw new Error(`Account not found: "${nameOrId}"`);

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
  if (!match) throw new Error(`Department not found: "${nameOrId}"`);

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

  throw new Error(`Vendor not found: "${nameOrId}"`);
}
