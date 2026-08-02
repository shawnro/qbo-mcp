// Tests for cache resolution fallback chains, TTL, and lazy caching

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockClient,
  mockSuccess,
  mockError,
  resetMockClient,
} from "../../__mocks__/mock-client.js";

// We need the REAL promisify but mock nothing else from the client barrel.
// cache.ts imports promisify from "./promisify.js" (relative), so we mock
// that path instead of the barrel.

const client = createMockClient();

// Import after mock setup so module-level state is clean per-test
import {
  clearLookupCache,
  getAccountCache,
  getDepartmentCache,
  getVendorCache,
  resolveAccount,
  resolveVendor,
  resolveItem,
  resolveCustomer,
  resolveCustomerById,
  resolveDepartmentId,
} from "../cache.js";

beforeEach(() => {
  resetMockClient(client);
  clearLookupCache();
});

// Helper: set up findAccounts to return test accounts
function seedAccounts() {
  mockSuccess(client.findAccounts, {
    QueryResponse: {
      Account: [
        { Id: "1", Name: "Cash", FullyQualifiedName: "Cash", AcctNum: "1000", AccountType: "Bank", CurrentBalance: 5000 },
        { Id: "2", Name: "Tips", FullyQualifiedName: "Income:Tips", AcctNum: "4100", AccountType: "Income", CurrentBalance: 0 },
        { Id: "3", Name: "Rent Expense", FullyQualifiedName: "Expense:Rent Expense", AccountType: "Expense", CurrentBalance: 0 },
      ],
    },
  });
}

function seedDepartments() {
  mockSuccess(client.findDepartments, {
    QueryResponse: {
      Department: [
        { Id: "10", Name: "Main Office", FullyQualifiedName: "Main Office" },
        { Id: "20", Name: "Santa Rosa", FullyQualifiedName: "Santa Rosa" },
      ],
    },
  });
}

function seedVendors() {
  mockSuccess(client.findVendors, {
    QueryResponse: {
      Vendor: [
        { Id: "100", DisplayName: "Acme Corp" },
        { Id: "101", DisplayName: "Office Depot" },
      ],
    },
  });
}

describe("resolveAccount", () => {
  it("resolves by exact ID", async () => {
    seedAccounts();
    const acct = await resolveAccount(client as never, "1");
    expect(acct.Name).toBe("Cash");
  });

  it("resolves by AcctNum (case-insensitive)", async () => {
    seedAccounts();
    const acct = await resolveAccount(client as never, "4100");
    expect(acct.Name).toBe("Tips");
  });

  it("resolves by exact name (case-insensitive)", async () => {
    seedAccounts();
    const acct = await resolveAccount(client as never, "cash");
    expect(acct.Name).toBe("Cash");
  });

  it("resolves by partial FullyQualifiedName", async () => {
    seedAccounts();
    const acct = await resolveAccount(client as never, "Rent");
    expect(acct.Name).toBe("Rent Expense");
  });

  it("throws when account not found", async () => {
    seedAccounts();
    await expect(resolveAccount(client as never, "nonexistent")).rejects.toThrow(
      'Account not found: "nonexistent"'
    );
  });

  it("follows priority: ID > AcctNum > Name > partial", async () => {
    // Account whose ID matches another account's AcctNum
    mockSuccess(client.findAccounts, {
      QueryResponse: {
        Account: [
          { Id: "1000", Name: "Checking", FullyQualifiedName: "Checking", AcctNum: "2000", AccountType: "Bank", CurrentBalance: 0 },
          { Id: "99", Name: "Savings", FullyQualifiedName: "Savings", AcctNum: "1000", AccountType: "Bank", CurrentBalance: 0 },
        ],
      },
    });

    // "1000" should match ID first (Checking), not AcctNum (Savings)
    const acct = await resolveAccount(client as never, "1000");
    expect(acct.Name).toBe("Checking");
  });
});

describe("resolveVendor", () => {
  it("resolves by exact ID", async () => {
    seedVendors();
    const ref = await resolveVendor(client as never, "100");
    expect(ref).toEqual({ value: "100", name: "Acme Corp" });
  });

  it("resolves by name (case-insensitive)", async () => {
    seedVendors();
    const ref = await resolveVendor(client as never, "acme corp");
    expect(ref).toEqual({ value: "100", name: "Acme Corp" });
  });

  it("resolves by partial name", async () => {
    seedVendors();
    const ref = await resolveVendor(client as never, "Depot");
    expect(ref).toEqual({ value: "101", name: "Office Depot" });
  });

  it("throws when vendor not found", async () => {
    seedVendors();
    await expect(resolveVendor(client as never, "nobody")).rejects.toThrow(
      'Vendor not found: "nobody"'
    );
  });
});

describe("resolveDepartmentId", () => {
  it("resolves by exact ID", async () => {
    seedDepartments();
    const id = await resolveDepartmentId(client as never, "10");
    expect(id).toBe("10");
  });

  it("resolves by name (case-insensitive)", async () => {
    seedDepartments();
    const id = await resolveDepartmentId(client as never, "santa rosa");
    expect(id).toBe("20");
  });

  it("resolves by partial FullyQualifiedName", async () => {
    seedDepartments();
    const id = await resolveDepartmentId(client as never, "Rosa");
    expect(id).toBe("20");
  });

  it("returns input as-is when not found (does not throw)", async () => {
    seedDepartments();
    const id = await resolveDepartmentId(client as never, "unknown-dept");
    expect(id).toBe("unknown-dept");
  });
});

describe("resolveItem (lazy cache)", () => {
  it("resolves by exact name query", async () => {
    // First call: exact match
    mockSuccess(client.findItems, {
      QueryResponse: {
        Item: [{ Id: "200", Name: "Widget", FullyQualifiedName: "Widget", Type: "Service", UnitPrice: 25, Active: true }],
      },
    });

    const ref = await resolveItem(client as never, "Widget");
    expect(ref).toEqual({ value: "200", name: "Widget" });
  });

  it("falls back to LIKE query when exact fails", async () => {
    // First call (exact match) returns empty, second call (LIKE) returns result
    let callCount = 0;
    client.findItems.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, result: unknown) => void;
      callCount++;
      if (callCount === 1) {
        cb(null, { QueryResponse: { Item: [] } });
      } else {
        cb(null, {
          QueryResponse: {
            Item: [{ Id: "201", Name: "Premium Widget", Type: "Service", Active: true }],
          },
        });
      }
    });

    const ref = await resolveItem(client as never, "Widget");
    expect(ref).toEqual({ value: "201", name: "Premium Widget" });
    expect(client.findItems).toHaveBeenCalledTimes(2);
  });

  it("throws when item not found", async () => {
    mockSuccess(client.findItems, { QueryResponse: { Item: [] } });
    // Both exact and LIKE return empty
    await expect(resolveItem(client as never, "nonexistent")).rejects.toThrow(
      'Item not found: "nonexistent"'
    );
  });

  it("returns cached item without API call on second resolve", async () => {
    mockSuccess(client.findItems, {
      QueryResponse: {
        Item: [{ Id: "200", Name: "Widget", Type: "Service", Active: true }],
      },
    });

    await resolveItem(client as never, "Widget");
    expect(client.findItems).toHaveBeenCalledOnce();

    // Second call — should use cache, no additional API call
    resetMockClient(client);
    const ref2 = await resolveItem(client as never, "Widget");
    expect(ref2).toEqual({ value: "200", name: "Widget" });
    expect(client.findItems).not.toHaveBeenCalled();
  });
});

describe("resolveCustomer (lazy cache)", () => {
  it("resolves an uncached customer ID with a direct read", async () => {
    mockSuccess(client.getCustomer, {
      Id: "300",
      DisplayName: "Customer One",
      FullyQualifiedName: "Customer One",
      Active: true,
    });

    const ref = await resolveCustomerById(client as never, "300");

    expect(ref).toEqual({ value: "300", name: "Customer One" });
    expect(client.getCustomer).toHaveBeenCalledWith("300", expect.any(Function));
    expect(client.findCustomers).not.toHaveBeenCalled();
  });

  it("rejects an inactive customer ID", async () => {
    mockSuccess(client.getCustomer, {
      Id: "300",
      DisplayName: "Inactive Customer",
      Active: false,
    });

    await expect(resolveCustomerById(client as never, "300")).rejects.toThrow(
      'Customer not found or inactive: "300"'
    );
  });

  it("resolves by exact DisplayName query", async () => {
    mockSuccess(client.findCustomers, {
      QueryResponse: {
        Customer: [{ Id: "300", DisplayName: "John Doe", Active: true }],
      },
    });

    const ref = await resolveCustomer(client as never, "John Doe");
    expect(ref).toEqual({ value: "300", name: "John Doe" });
  });

  it("falls back to LIKE query when exact fails", async () => {
    let callCount = 0;
    client.findCustomers.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, result: unknown) => void;
      callCount++;
      if (callCount === 1) {
        cb(null, { QueryResponse: { Customer: [] } });
      } else {
        cb(null, {
          QueryResponse: {
            Customer: [{ Id: "301", DisplayName: "John Smith", Active: true }],
          },
        });
      }
    });

    const ref = await resolveCustomer(client as never, "Smith");
    expect(ref).toEqual({ value: "301", name: "John Smith" });
    expect(client.findCustomers).toHaveBeenCalledTimes(2);
  });

  it("resolves a job by exact FullyQualifiedName", async () => {
    mockSuccess(client.findCustomers, {
      QueryResponse: {
        Customer: [{
          Id: "302",
          DisplayName: "Kitchen Remodel",
          FullyQualifiedName: "Customer One:Kitchen Remodel",
          Active: true,
        }],
      },
    });

    const ref = await resolveCustomer(client as never, "Customer One:Kitchen Remodel");

    expect(ref).toEqual({ value: "302", name: "Customer One:Kitchen Remodel" });
    expect(client.findCustomers).toHaveBeenCalledWith(
      expect.arrayContaining([
        { field: "FullyQualifiedName", value: "Customer One:Kitchen Remodel", operator: "=" },
      ]),
      expect.any(Function)
    );
  });

  it("throws when a partial customer name is ambiguous", async () => {
    let callCount = 0;
    client.findCustomers.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, result: unknown) => void;
      callCount++;
      cb(null, {
        QueryResponse: {
          Customer: callCount === 1 ? [] : [
            { Id: "303", DisplayName: "Customer East", Active: true },
            { Id: "304", DisplayName: "Customer West", Active: true },
          ],
        },
      });
    });

    await expect(resolveCustomer(client as never, "Customer")).rejects.toThrow(
      'Customer name is ambiguous: "Customer"'
    );
  });

  it("caches customer ID and fully qualified name aliases", async () => {
    mockSuccess(client.findCustomers, {
      QueryResponse: {
        Customer: [{
          Id: "305",
          DisplayName: "Phase One",
          FullyQualifiedName: "Customer One:Phase One",
          Active: true,
        }],
      },
    });

    await resolveCustomer(client as never, "Customer One:Phase One");
    resetMockClient(client);

    await expect(resolveCustomerById(client as never, "305")).resolves.toEqual({
      value: "305",
      name: "Customer One:Phase One",
    });
    await expect(resolveCustomer(client as never, "phase one")).resolves.toEqual({
      value: "305",
      name: "Customer One:Phase One",
    });
    expect(client.getCustomer).not.toHaveBeenCalled();
    expect(client.findCustomers).not.toHaveBeenCalled();
  });

  it("throws when customer not found", async () => {
    mockSuccess(client.findCustomers, { QueryResponse: { Customer: [] } });
    await expect(resolveCustomer(client as never, "nobody")).rejects.toThrow(
      'Customer not found: "nobody"'
    );
  });
});

describe("TTL and caching behavior", () => {
  it("fetches accounts only once when called twice within TTL", async () => {
    seedAccounts();

    await resolveAccount(client as never, "1");
    await resolveAccount(client as never, "2");

    // findAccounts should be called exactly once (second call uses cache)
    expect(client.findAccounts).toHaveBeenCalledOnce();
  });

  it("re-fetches accounts after TTL expires", async () => {
    vi.useFakeTimers();
    try {
      seedAccounts();

      await resolveAccount(client as never, "1");
      expect(client.findAccounts).toHaveBeenCalledOnce();

      // Advance past 15-minute TTL
      vi.advanceTimersByTime(16 * 60 * 1000);

      await resolveAccount(client as never, "1");
      expect(client.findAccounts).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fetches vendors only once within TTL", async () => {
    seedVendors();

    await resolveVendor(client as never, "100");
    await resolveVendor(client as never, "101");

    expect(client.findVendors).toHaveBeenCalledOnce();
  });

  it("fetches departments only once within TTL", async () => {
    seedDepartments();

    await resolveDepartmentId(client as never, "10");
    await resolveDepartmentId(client as never, "20");

    expect(client.findDepartments).toHaveBeenCalledOnce();
  });

  it("clearLookupCache forces re-fetch on next call", async () => {
    seedAccounts();

    await resolveAccount(client as never, "1");
    expect(client.findAccounts).toHaveBeenCalledOnce();

    clearLookupCache();

    await resolveAccount(client as never, "1");
    expect(client.findAccounts).toHaveBeenCalledTimes(2);
  });
});

describe("forced cache refresh", () => {
  it("bypasses the account cache without waiting for TTL expiry", async () => {
    seedAccounts();

    await getAccountCache(client as never);
    await getAccountCache(client as never, { forceRefresh: true });

    expect(client.findAccounts).toHaveBeenCalledTimes(2);
  });

  it("bypasses the department cache without waiting for TTL expiry", async () => {
    seedDepartments();

    await getDepartmentCache(client as never);
    await getDepartmentCache(client as never, { forceRefresh: true });

    expect(client.findDepartments).toHaveBeenCalledTimes(2);
  });

  it("bypasses the vendor cache without waiting for TTL expiry", async () => {
    seedVendors();

    await getVendorCache(client as never);
    await getVendorCache(client as never, { forceRefresh: true });

    expect(client.findVendors).toHaveBeenCalledTimes(2);
  });
});

describe("stale cache recovery", () => {
  it("finds an account added after the initial cache snapshot", async () => {
    let callCount = 0;
    client.findAccounts.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, result: unknown) => void;
      callCount++;
      cb(null, {
        QueryResponse: {
          Account: callCount === 1
            ? [{ Id: "1", Name: "Existing Account", FullyQualifiedName: "Existing Account" }]
            : [
                { Id: "1", Name: "Existing Account", FullyQualifiedName: "Existing Account" },
                { Id: "2", Name: "New Account", FullyQualifiedName: "New Account" },
              ],
        },
      });
    });

    await getAccountCache(client as never);
    const account = await resolveAccount(client as never, "New Account");

    expect(account.Id).toBe("2");
    expect(client.findAccounts).toHaveBeenCalledTimes(2);
  });

  it("finds a department added after the initial cache snapshot", async () => {
    let callCount = 0;
    client.findDepartments.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, result: unknown) => void;
      callCount++;
      cb(null, {
        QueryResponse: {
          Department: callCount === 1
            ? [{ Id: "10", Name: "Existing Department", FullyQualifiedName: "Existing Department" }]
            : [
                { Id: "10", Name: "Existing Department", FullyQualifiedName: "Existing Department" },
                { Id: "20", Name: "New Department", FullyQualifiedName: "New Department" },
              ],
        },
      });
    });

    await getDepartmentCache(client as never);
    const id = await resolveDepartmentId(client as never, "New Department");

    expect(id).toBe("20");
    expect(client.findDepartments).toHaveBeenCalledTimes(2);
  });

  it("finds a vendor added after the initial cache snapshot", async () => {
    let callCount = 0;
    client.findVendors.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, result: unknown) => void;
      callCount++;
      cb(null, {
        QueryResponse: {
          Vendor: callCount === 1
            ? [{ Id: "100", DisplayName: "Existing Vendor" }]
            : [
                { Id: "100", DisplayName: "Existing Vendor" },
                { Id: "200", DisplayName: "New Vendor" },
              ],
        },
      });
    });

    await getVendorCache(client as never);
    const vendor = await resolveVendor(client as never, "New Vendor");

    expect(vendor).toEqual({ value: "200", name: "New Vendor" });
    expect(client.findVendors).toHaveBeenCalledTimes(2);
  });

  it("propagates a refresh API error without retrying again", async () => {
    let callCount = 0;
    client.findVendors.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, result?: unknown) => void;
      callCount++;
      if (callCount === 1) {
        cb(null, { QueryResponse: { Vendor: [{ Id: "100", DisplayName: "Existing Vendor" }] } });
      } else {
        cb(new Error("Network timeout"));
      }
    });

    await getVendorCache(client as never);
    await expect(resolveVendor(client as never, "Missing Vendor")).rejects.toThrow("Network timeout");
    expect(client.findVendors).toHaveBeenCalledTimes(2);
  });
});
