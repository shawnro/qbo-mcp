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
  resolveCustomer: vi.fn(),
  resolveCustomerById: vi.fn(),
}));

import {
  getAccountCache,
  getDepartmentCache,
  getVendorCache,
  resolveCustomer,
  resolveCustomerById,
} from "../../client/index.js";
import { createResolutionCoordinator } from "../resolve.js";

const mockGetAccountCache = vi.mocked(getAccountCache);
const mockGetDepartmentCache = vi.mocked(getDepartmentCache);
const mockGetVendorCache = vi.mocked(getVendorCache);
const mockResolveCustomer = vi.mocked(resolveCustomer);
const mockResolveCustomerById = vi.mocked(resolveCustomerById);

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

  it("does not refresh an ambiguous cache result", async () => {
    const cache = createMockVendorCache();
    cache.items = [
      ...cache.items,
      { Id: "201", DisplayName: "Home Depot" },
    ];
    const resolver = createResolutionCoordinator(client as never, {
      vendor: cache as never,
    });

    await expect(resolver.vendor("Depot")).rejects.toThrow(
      'Vendor name is ambiguous: "Depot"'
    );
    expect(mockGetVendorCache).not.toHaveBeenCalled();
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

  it("routes customer names and IDs to the correct resolver", async () => {
    mockResolveCustomer.mockResolvedValue({ value: "300", name: "Customer One" });
    mockResolveCustomerById.mockResolvedValue({ value: "301", name: "Customer Two" });
    const resolver = createResolutionCoordinator(client as never);

    await expect(resolver.customer({ name: "Customer One" })).resolves.toEqual({
      value: "300",
      name: "Customer One",
    });
    await expect(resolver.customer({ id: "301" })).resolves.toEqual({
      value: "301",
      name: "Customer Two",
    });

    expect(mockResolveCustomer).toHaveBeenCalledWith(client, "Customer One");
    expect(mockResolveCustomerById).toHaveBeenCalledWith(client, "301");
  });

  it("shares one customer lookup across concurrent equivalent names", async () => {
    mockResolveCustomer.mockResolvedValue({ value: "300", name: "Customer One" });
    const resolver = createResolutionCoordinator(client as never);

    const refs = await Promise.all([
      resolver.customer({ name: "Customer One" }),
      resolver.customer({ name: "customer one" }),
      resolver.customer({ name: " Customer One " }),
    ]);

    expect(refs).toEqual([
      { value: "300", name: "Customer One" },
      { value: "300", name: "Customer One" },
      { value: "300", name: "Customer One" },
    ]);
    expect(mockResolveCustomer).toHaveBeenCalledOnce();
  });

  it("resolves different customers independently", async () => {
    mockResolveCustomer.mockImplementation(async (_client, name) => ({ value: name, name }));
    const resolver = createResolutionCoordinator(client as never);

    await Promise.all([
      resolver.customer({ name: "Customer One" }),
      resolver.customer({ name: "Customer Two" }),
    ]);

    expect(mockResolveCustomer).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid customer resolution input before querying", async () => {
    const resolver = createResolutionCoordinator(client as never);

    await expect(
      resolver.customer({ id: "300", name: "Customer One" } as never)
    ).rejects.toThrow("Provide exactly one of customer_id or customer_name");
    await expect(resolver.customer({ name: "" })).rejects.toThrow(
      "Provide exactly one of customer_id or customer_name"
    );
    expect(mockResolveCustomer).not.toHaveBeenCalled();
    expect(mockResolveCustomerById).not.toHaveBeenCalled();
  });
});
