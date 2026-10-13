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

  it("returns allowlisted company info without sensitive upstream fields", async () => {
    const companyData = {
      Id: "12345",
      CompanyName: "Test Corp",
      LegalName: "Test Corporation LLC",
      Country: "US",
      FiscalYearStartMonth: "January",
      Email: { Address: "test@corp.com" },
      EmployerId: "12-3456789",
      CompanyAddr: { Line1: "123 Main St" },
      NameValue: [{ Name: "SubscriptionStatus", Value: "PAID" }],
    };
    mockSuccess(client.getCompanyInfo, companyData);

    const result = await handleGetCompanyInfo(client as never);

    expect(JSON.parse(result.content[0].text)).toEqual({
      Id: "12345",
      CompanyName: "Test Corp",
      LegalName: "Test Corporation LLC",
      Country: "US",
      FiscalYearStartMonth: "January",
    });
  });

  it("uses the request runtime company ID", async () => {
    mockSuccess(client.getCompanyInfo, { Id: "runtime-company", CompanyName: "Runtime Corp" });

    await handleGetCompanyInfo(client as never, {
      runtime: { companyId: "runtime-company" },
    } as never);

    expect(client.getCompanyInfo).toHaveBeenCalledWith("runtime-company", expect.any(Function));
  });

  it("propagates API errors", async () => {
    mockError(client.getCompanyInfo, "Unauthorized");

    await expect(
      handleGetCompanyInfo(client as never)
    ).rejects.toThrow("Unauthorized");
  });
});
