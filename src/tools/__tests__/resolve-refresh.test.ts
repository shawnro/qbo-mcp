import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMockClient, resetMockClient } from "../../__mocks__/mock-client.js";
import {
  createMockAccountCache,
  createMockDepartmentCache,
  createMockVendorCache,
} from "../../__mocks__/mock-cache.js";

vi.mock("../../client/index.js", () => ({
  getAccountCache: vi.fn(),
  getDepartmentCache: vi.fn(),
  getVendorCache: vi.fn(),
}));

import {
  getAccountCache,
  getDepartmentCache,
  getVendorCache,
} from "../../client/index.js";
import { createResolutionCoordinator } from "../resolve.js";

const mockGetAccountCache = vi.mocked(getAccountCache);
const mockGetDepartmentCache = vi.mocked(getDepartmentCache);
const mockGetVendorCache = vi.mocked(getVendorCache);

function accountCacheWithNewAccount() {
  const cache = createMockAccountCache();
  const account = {
    Id: "200",
    Name: "New Account",
    FullyQualifiedName: "New Account",
    AcctNum: "7000",
    AccountType: "Expense",
    CurrentBalance: 0,
  };
  return {
    ...cache,
    items: [...cache.items, account],
    byId: new Map(cache.byId).set(account.Id, account),
    byName: new Map(cache.byName).set(account.Name.toLowerCase(), account),
    byAcctNum: new Map(cache.byAcctNum).set(account.AcctNum, account),
    fetchedAt: Date.now(),
  };
}

function departmentCacheWithNewDepartment() {
  const cache = createMockDepartmentCache();
  const department = { Id: "200", Name: "New Department", FullyQualifiedName: "New Department" };
  return {
    ...cache,
    items: [...cache.items, department],
    byId: new Map(cache.byId).set(department.Id, department),
    byName: new Map(cache.byName).set(department.Name.toLowerCase(), department),
    fetchedAt: Date.now(),
  };
}

function vendorCacheWithNewVendor() {
  const cache = createMockVendorCache();
  const vendor = { Id: "200", DisplayName: "New Vendor" };
  return {
    ...cache,
    items: [...cache.items, vendor],
    byId: new Map(cache.byId).set(vendor.Id, vendor),
    byName: new Map(cache.byName).set(vendor.DisplayName.toLowerCase(), vendor),
    fetchedAt: Date.now(),
  };
}

describe("createResolutionCoordinator", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("does not refresh when the existing cache resolves the entity", async () => {
    const resolver = createResolutionCoordinator(client as never, {
      account: createMockAccountCache() as never,
      department: createMockDepartmentCache() as never,
      vendor: createMockVendorCache() as never,
    });

    await expect(resolver.account("Cash")).resolves.toMatchObject({ value: "1", name: "Cash" });
    await expect(resolver.department("Main Office")).resolves.toEqual({ value: "10", name: "Main Office" });
    await expect(resolver.vendor("Office Depot")).resolves.toEqual({ value: "100", name: "Office Depot" });

    expect(mockGetAccountCache).not.toHaveBeenCalled();
    expect(mockGetDepartmentCache).not.toHaveBeenCalled();
    expect(mockGetVendorCache).not.toHaveBeenCalled();
  });

  it("refreshes a stale account cache once", async () => {
    mockGetAccountCache.mockResolvedValue(accountCacheWithNewAccount() as never);
    const resolver = createResolutionCoordinator(client as never, {
      account: createMockAccountCache() as never,
    });

    await expect(resolver.account("New Account")).resolves.toEqual({
      value: "200",
      name: "New Account",
      acctNum: "7000",
    });
    expect(mockGetAccountCache).toHaveBeenCalledOnce();
    expect(mockGetAccountCache).toHaveBeenCalledWith(client, { forceRefresh: true });
  });

  it("refreshes a stale department cache once", async () => {
    mockGetDepartmentCache.mockResolvedValue(departmentCacheWithNewDepartment() as never);
    const resolver = createResolutionCoordinator(client as never, {
      department: createMockDepartmentCache() as never,
    });

    await expect(resolver.department("New Department")).resolves.toEqual({
      value: "200",
      name: "New Department",
    });
    expect(mockGetDepartmentCache).toHaveBeenCalledOnce();
    expect(mockGetDepartmentCache).toHaveBeenCalledWith(client, { forceRefresh: true });
  });

  it("refreshes a stale vendor cache once", async () => {
    mockGetVendorCache.mockResolvedValue(vendorCacheWithNewVendor() as never);
    const resolver = createResolutionCoordinator(client as never, {
      vendor: createMockVendorCache() as never,
    });

    await expect(resolver.vendor("New Vendor")).resolves.toEqual({ value: "200", name: "New Vendor" });
    expect(mockGetVendorCache).toHaveBeenCalledOnce();
    expect(mockGetVendorCache).toHaveBeenCalledWith(client, { forceRefresh: true });
  });

  it("returns the normal not-found error after one refresh", async () => {
    mockGetVendorCache.mockResolvedValue(createMockVendorCache() as never);
    const resolver = createResolutionCoordinator(client as never, {
      vendor: createMockVendorCache() as never,
    });

    await expect(resolver.vendor("Missing Vendor")).rejects.toThrow(
      'Vendor not found: "Missing Vendor"'
    );
    expect(mockGetVendorCache).toHaveBeenCalledOnce();
  });

  it("shares one in-flight refresh across concurrent misses", async () => {
    mockGetVendorCache.mockResolvedValue(vendorCacheWithNewVendor() as never);
    const resolver = createResolutionCoordinator(client as never, {
      vendor: createMockVendorCache() as never,
    });

    const refs = await Promise.all([
      resolver.vendor("New Vendor"),
      resolver.vendor("New Vendor"),
      resolver.vendor("200"),
    ]);

    expect(refs).toEqual([
      { value: "200", name: "New Vendor" },
      { value: "200", name: "New Vendor" },
      { value: "200", name: "New Vendor" },
    ]);
    expect(mockGetVendorCache).toHaveBeenCalledOnce();
  });

  it("propagates a refresh API error without retrying it", async () => {
    mockGetVendorCache.mockRejectedValue(new Error("Network timeout"));
    const resolver = createResolutionCoordinator(client as never, {
      vendor: createMockVendorCache() as never,
    });

    await expect(resolver.vendor("Missing Vendor")).rejects.toThrow("Network timeout");
    expect(mockGetVendorCache).toHaveBeenCalledOnce();
  });
});
