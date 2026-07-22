import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockPromisify } from "../../../__mocks__/mock-client.js";

// Mock credentials module
vi.mock("../../../credentials/index.js", () => ({
  hasProfiles: vi.fn(),
  listProfiles: vi.fn(),
  switchProfile: vi.fn(),
  getActiveProfileName: vi.fn(),
}));

// Mock client module
vi.mock("../../../client/index.js", () => ({
  promisify: mockPromisify,
  getClient: vi.fn(),
  clearCredentialsCache: vi.fn(),
  refreshTokens: vi.fn(),
  isAuthError: vi.fn(),
  clearLookupCache: vi.fn(),
  getCompanyIdValue: vi.fn(),
}));

import {
  hasProfiles,
  listProfiles,
  switchProfile,
  getActiveProfileName,
} from "../../../credentials/index.js";
import { getClient, clearCredentialsCache, refreshTokens, isAuthError } from "../../../client/index.js";
import { handleListProfiles, handleSwitchProfile } from "../profiles.js";

const mockHasProfiles = vi.mocked(hasProfiles);
const mockListProfiles = vi.mocked(listProfiles);
const mockSwitchProfile = vi.mocked(switchProfile);
const mockGetActiveProfileName = vi.mocked(getActiveProfileName);
const mockGetClient = vi.mocked(getClient);
const mockClearCredentialsCache = vi.mocked(clearCredentialsCache);
const mockRefreshTokens = vi.mocked(refreshTokens);
const mockIsAuthError = vi.mocked(isAuthError);

describe("handleListProfiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns message when no profiles configured", async () => {
    mockHasProfiles.mockReturnValue(false);

    const result = await handleListProfiles();

    expect(result.content[0].text).toContain("No profiles configured");
    expect(result.content[0].text).toContain("single-company mode");
  });

  it("returns formatted profile list", async () => {
    mockHasProfiles.mockReturnValue(true);
    mockListProfiles.mockReturnValue([
      { name: "prod", mode: "aws" as never, secret_name: "qbo/prod", company_id: "111", active: true, is_default: true },
      { name: "dev", mode: "local" as never, secret_name: undefined, company_id: "222", active: false, is_default: false },
    ]);

    const result = await handleListProfiles();

    expect(result.content[0].text).toContain("prod");
    expect(result.content[0].text).toContain("ACTIVE");
    expect(result.content[0].text).toContain("default");
    expect(result.content[0].text).toContain("dev");
    expect(result.content[0].text).toContain("mode=aws");
    expect(result.content[0].text).toContain("mode=local");
  });
});

describe("handleSwitchProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when no profiles configured", async () => {
    mockHasProfiles.mockReturnValue(false);

    const result = await handleSwitchProfile({ profile: "prod" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Cannot switch profiles");
  });

  it("returns message when already on target profile", async () => {
    mockHasProfiles.mockReturnValue(true);
    mockGetActiveProfileName.mockReturnValue("prod");

    const result = await handleSwitchProfile({ profile: "prod" });

    expect(result.content[0].text).toContain('Already on profile "prod"');
    expect(mockSwitchProfile).not.toHaveBeenCalled();
  });

  it("returns error when switchProfile throws", async () => {
    mockHasProfiles.mockReturnValue(true);
    mockGetActiveProfileName.mockReturnValue("prod");
    mockSwitchProfile.mockImplementation(() => { throw new Error('Profile "bad" not found'); });

    const result = await handleSwitchProfile({ profile: "bad" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Profile "bad" not found');
  });

  it("switches successfully and returns company name", async () => {
    mockHasProfiles.mockReturnValue(true);
    mockGetActiveProfileName.mockReturnValue("prod");
    mockSwitchProfile.mockReturnValue("prod");
    const mockClient = { realmId: "999", getCompanyInfo: vi.fn() };
    mockGetClient.mockResolvedValue(mockClient as never);
    mockClient.getCompanyInfo.mockImplementation((_id: string, cb: Function) => {
      cb(null, { CompanyName: "Dev Corp" });
    });

    const result = await handleSwitchProfile({ profile: "dev" });

    expect(result.content[0].text).toContain('Switched to profile "dev"');
    expect(result.content[0].text).toContain("Dev Corp");
    expect(mockClearCredentialsCache).toHaveBeenCalled();
  });

  it("retries with token refresh on auth error", async () => {
    mockHasProfiles.mockReturnValue(true);
    mockGetActiveProfileName.mockReturnValue("prod");
    mockSwitchProfile.mockReturnValue("prod");

    let callCount = 0;
    const mockClient = { realmId: "999", getCompanyInfo: vi.fn() };
    mockGetClient.mockResolvedValue(mockClient as never);
    mockClient.getCompanyInfo.mockImplementation((_id: string, cb: Function) => {
      callCount++;
      if (callCount === 1) {
        cb(new Error("Token expired"));
      } else {
        cb(null, { CompanyName: "Refreshed Corp" });
      }
    });
    mockIsAuthError.mockReturnValue(true);
    mockRefreshTokens.mockResolvedValue(undefined as never);

    const result = await handleSwitchProfile({ profile: "dev" });

    expect(result.content[0].text).toContain("Refreshed Corp");
    expect(mockRefreshTokens).toHaveBeenCalledOnce();
  });

  it("rolls back to previous profile on connection failure", async () => {
    mockHasProfiles.mockReturnValue(true);
    mockGetActiveProfileName.mockReturnValue("prod");
    mockSwitchProfile.mockReturnValue("prod");
    mockGetClient.mockRejectedValue(new Error("Connection refused"));
    mockIsAuthError.mockReturnValue(false);

    const result = await handleSwitchProfile({ profile: "dev" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to connect");
    expect(result.content[0].text).toContain("Rolled back");
    expect(result.content[0].text).toContain('"prod"');
    // switchProfile called twice: once for switch, once for rollback
    expect(mockSwitchProfile).toHaveBeenCalledTimes(2);
    expect(mockSwitchProfile).toHaveBeenLastCalledWith("prod");
  });
});
