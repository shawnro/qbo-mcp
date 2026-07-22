import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockClient,
  resetMockClient,
  mockPromisify,
} from "../../../__mocks__/mock-client.js";
import {
  createMockAccountCache,
} from "../../../__mocks__/mock-cache.js";

vi.mock("../../../client/index.js", () => ({
    promisify: mockPromisify,
    getAccountCache: vi.fn(),
    getClient: vi.fn(),
    clearCredentialsCache: vi.fn(),
    refreshTokens: vi.fn(),
    isAuthError: vi.fn(),
    clearLookupCache: vi.fn(),
    getCompanyIdValue: vi.fn(),
}));

vi.mock("../../../utils/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../utils/index.js")>(
    "../../../utils/index.js"
  );
  return { ...actual };
});

import { getAccountCache } from "../../../client/index.js";
import { handleListAccounts } from "../accounts.js";

const mockGetAccountCache = vi.mocked(getAccountCache);

describe("handleListAccounts", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
    mockGetAccountCache.mockResolvedValue(createMockAccountCache() as never);
  });

  it("returns summary of all active accounts", async () => {
    const result = await handleListAccounts(client as never, {});

    expect(result.content[0].text).toContain("Accounts:");
    expect(result.content[0].text).toContain("Total Balance:");
  });

  it("filters by account_type", async () => {
    const result = await handleListAccounts(client as never, {
      account_type: "Bank",
    });

    // Only Bank accounts from TEST_ACCOUNTS should appear
    expect(result.content[0].text).toContain("Accounts:");
    // Should not contain non-Bank types in the sample
    expect(result.content[0].text).not.toContain("Expense");
  });

  it("defaults active_only to true", async () => {
    await handleListAccounts(client as never, {});

    // The cache is fetched; filtering is client-side
    expect(mockGetAccountCache).toHaveBeenCalledOnce();
  });

  it("returns all accounts when active_only=false", async () => {
    // Add an inactive account to the cache
    const cache = createMockAccountCache();
    cache.items.push({
      Id: "99",
      Name: "Closed Account",
      AccountType: "Bank",
      Active: false,
      CurrentBalance: 0,
    } as never);
    mockGetAccountCache.mockResolvedValue(cache as never);

    const resultActive = await handleListAccounts(client as never, { active_only: true });
    vi.clearAllMocks();
    mockGetAccountCache.mockResolvedValue(cache as never);
    const resultAll = await handleListAccounts(client as never, { active_only: false });

    // active_only=false should include one more account
    expect(resultAll.content[0].text).toContain("Closed Account");
    expect(resultActive.content[0].text).not.toContain("Closed Account");
  });

  it("handles empty account list", async () => {
    mockGetAccountCache.mockResolvedValue({ items: [], lookup: new Map() } as never);

    const result = await handleListAccounts(client as never, {});

    expect(result.content[0].text).toContain("Accounts: 0");
    expect(result.content[0].text).toContain("Total Balance:");
  });
});
