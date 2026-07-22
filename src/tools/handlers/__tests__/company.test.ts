import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createMockClient,
  mockSuccess,
  mockError,
  resetMockClient,
  mockPromisify,
} from "../../../__mocks__/mock-client.js";

vi.mock("../../../client/index.js", () => ({
    promisify: mockPromisify,
    getCompanyIdValue: vi.fn(() => "12345"),
    getClient: vi.fn(),
    clearCredentialsCache: vi.fn(),
    refreshTokens: vi.fn(),
    isAuthError: vi.fn(),
    clearLookupCache: vi.fn(),
}));

import { handleGetCompanyInfo } from "../company.js";

describe("handleGetCompanyInfo", () => {
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    client = createMockClient();
    resetMockClient(client);
    vi.clearAllMocks();
  });

  it("returns company info as JSON", async () => {
    const companyData = {
      CompanyName: "Test Corp",
      LegalName: "Test Corporation LLC",
      Country: "US",
      Email: { Address: "test@corp.com" },
    };
    mockSuccess(client.getCompanyInfo, companyData);

    const result = await handleGetCompanyInfo(client as never);

    expect(result.content[0].text).toContain("Test Corp");
    expect(result.content[0].text).toContain("Test Corporation LLC");
    expect(JSON.parse(result.content[0].text)).toEqual(companyData);
  });

  it("propagates API errors", async () => {
    mockError(client.getCompanyInfo, "Unauthorized");

    await expect(
      handleGetCompanyInfo(client as never)
    ).rejects.toThrow("Unauthorized");
  });
});
