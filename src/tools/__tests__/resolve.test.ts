import { describe, it, expect } from "vitest";
import { resolveAccountRef, resolveDepartmentRef, resolveVendorRef } from "../resolve.js";
import {
  createMockAccountCache,
  createMockDepartmentCache,
  createMockVendorCache,
} from "../../__mocks__/mock-cache.js";

describe("resolveAccountRef", () => {
  const cache = createMockAccountCache();

  it("resolves by exact name (case-insensitive)", () => {
    const ref = resolveAccountRef(cache, "cash");
    expect(ref).toEqual({ value: "1", name: "Cash", acctNum: "1000" });
  });

  it("resolves by ID", () => {
    const ref = resolveAccountRef(cache, "3");
    expect(ref).toEqual({ value: "3", name: "Rent Expense", acctNum: "6100" });
  });

  it("resolves by account number", () => {
    const ref = resolveAccountRef(cache, "4100");
    expect(ref).toEqual({ value: "2", name: "Tips", acctNum: "4100" });
  });

  it("resolves by partial FullyQualifiedName", () => {
    const ref = resolveAccountRef(cache, "office sup");
    expect(ref).toEqual({ value: "5", name: "Office Supplies", acctNum: "6200" });
  });

  it("rejects an ambiguous partial name with bounded candidates", () => {
    const ambiguousCache = createMockAccountCache();
    const equipment = {
      Id: "6",
      Name: "Office Equipment",
      FullyQualifiedName: "Office Equipment",
      AcctNum: "6300",
      AccountType: "Expense",
      CurrentBalance: 0,
    };
    ambiguousCache.items = [...ambiguousCache.items, equipment];

    expect(() => resolveAccountRef(ambiguousCache, "office")).toThrow(
      'Account name is ambiguous: "office"'
    );
    expect(() => resolveAccountRef(ambiguousCache, "office")).toThrow("Office Supplies (ID: 5, AcctNum: 6200)");
    expect(() => resolveAccountRef(ambiguousCache, "office")).toThrow("Office Equipment (ID: 6, AcctNum: 6300)");
  });

  it("prefers an exact fully qualified name over other partial matches", () => {
    const hierarchicalCache = createMockAccountCache();
    hierarchicalCache.items = [
      ...hierarchicalCache.items,
      {
        Id: "6",
        Name: "Supplies",
        FullyQualifiedName: "Property A:Supplies",
        AcctNum: "6210",
        AccountType: "Expense",
        CurrentBalance: 0,
      },
      {
        Id: "7",
        Name: "Property A Supplies Reserve",
        FullyQualifiedName: "Property A Supplies Reserve",
        AcctNum: "6220",
        AccountType: "Expense",
        CurrentBalance: 0,
      },
    ];

    expect(resolveAccountRef(hierarchicalCache, "Property A:Supplies")).toEqual({
      value: "6",
      name: "Property A:Supplies",
      acctNum: "6210",
    });
  });

  it("throws for unknown account", () => {
    expect(() => resolveAccountRef(cache, "nonexistent")).toThrow(
      'Account not found: "nonexistent"'
    );
  });
});

describe("resolveDepartmentRef", () => {
  const cache = createMockDepartmentCache();

  it("resolves by ID", () => {
    const ref = resolveDepartmentRef(cache, "10");
    expect(ref).toEqual({ value: "10", name: "Main Office" });
  });

  it("resolves by exact name (case-insensitive)", () => {
    const ref = resolveDepartmentRef(cache, "santa rosa");
    expect(ref).toEqual({ value: "20", name: "Santa Rosa" });
  });

  it("resolves by partial FullyQualifiedName", () => {
    const ref = resolveDepartmentRef(cache, "petal");
    expect(ref).toEqual({ value: "30", name: "Petaluma" });
  });

  it("rejects an ambiguous partial name", () => {
    const ambiguousCache = createMockDepartmentCache();
    ambiguousCache.items = [
      ...ambiguousCache.items,
      { Id: "40", Name: "Santa Monica", FullyQualifiedName: "Santa Monica" },
    ];

    expect(() => resolveDepartmentRef(ambiguousCache, "santa")).toThrow(
      'Department name is ambiguous: "santa"'
    );
  });

  it("throws for unknown department", () => {
    expect(() => resolveDepartmentRef(cache, "nonexistent")).toThrow(
      'Department not found: "nonexistent"'
    );
  });
});

describe("resolveVendorRef", () => {
  const cache = createMockVendorCache();

  it("resolves by ID", () => {
    const ref = resolveVendorRef(cache, "100");
    expect(ref).toEqual({ value: "100", name: "Office Depot" });
  });

  it("resolves by exact name (case-insensitive)", () => {
    const ref = resolveVendorRef(cache, "shell gas station");
    expect(ref).toEqual({ value: "101", name: "Shell Gas Station" });
  });

  it("resolves by partial name", () => {
    const ref = resolveVendorRef(cache, "depot");
    expect(ref).toEqual({ value: "100", name: "Office Depot" });
  });

  it("rejects an ambiguous partial name", () => {
    const ambiguousCache = createMockVendorCache();
    ambiguousCache.items = [
      ...ambiguousCache.items,
      { Id: "102", DisplayName: "Home Depot" },
    ];

    expect(() => resolveVendorRef(ambiguousCache, "depot")).toThrow(
      'Vendor name is ambiguous: "depot"'
    );
  });

  it("throws for unknown vendor", () => {
    expect(() => resolveVendorRef(cache, "nonexistent")).toThrow(
      'Vendor not found: "nonexistent"'
    );
  });
});
