// Mock cache data for testing handlers that resolve names to IDs
// Mirrors the cache structures from src/client/cache.ts

export const TEST_ACCOUNTS = [
  { Id: "1", Name: "Cash", FullyQualifiedName: "Cash", AcctNum: "1000", AccountType: "Bank", CurrentBalance: 50000 },
  { Id: "2", Name: "Tips", FullyQualifiedName: "Tips", AcctNum: "4100", AccountType: "Income", CurrentBalance: 1200 },
  { Id: "3", Name: "Rent Expense", FullyQualifiedName: "Rent Expense", AcctNum: "6100", AccountType: "Expense", CurrentBalance: 3000 },
  { Id: "4", Name: "Accounts Payable", FullyQualifiedName: "Accounts Payable", AcctNum: "2000", AccountType: "Accounts Payable", CurrentBalance: 500 },
  { Id: "5", Name: "Office Supplies", FullyQualifiedName: "Office Supplies", AcctNum: "6200", AccountType: "Expense", CurrentBalance: 800 },
];

export const TEST_DEPARTMENTS = [
  { Id: "10", Name: "Main Office", FullyQualifiedName: "Main Office" },
  { Id: "20", Name: "Santa Rosa", FullyQualifiedName: "Santa Rosa" },
  { Id: "30", Name: "Petaluma", FullyQualifiedName: "Petaluma" },
];

function buildMap<T extends { Id: string }>(items: T[], keyFn: (item: T) => string | undefined): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = keyFn(item);
    if (key) map.set(key.toLowerCase(), item);
  }
  return map;
}

export function createMockAccountCache() {
  return {
    items: TEST_ACCOUNTS,
    byId: buildMap(TEST_ACCOUNTS, (a) => a.Id),
    byName: buildMap(TEST_ACCOUNTS, (a) => a.Name),
    byAcctNum: buildMap(TEST_ACCOUNTS, (a) => a.AcctNum),
    fetchedAt: Date.now(),
  };
}

export function createMockDepartmentCache() {
  return {
    items: TEST_DEPARTMENTS,
    byId: buildMap(TEST_DEPARTMENTS, (d) => d.Id),
    byName: buildMap(TEST_DEPARTMENTS, (d) => d.Name),
    fetchedAt: Date.now(),
  };
}

export const TEST_VENDORS = [
  { Id: "100", DisplayName: "Office Depot" },
  { Id: "101", DisplayName: "Shell Gas Station" },
];

export function createMockVendorCache() {
  return {
    items: TEST_VENDORS,
    byId: buildMap(TEST_VENDORS, (v) => v.Id),
    byName: buildMap(TEST_VENDORS, (v) => v.DisplayName),
    fetchedAt: Date.now(),
  };
}
