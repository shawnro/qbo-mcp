import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockPromisify } from "../../../__mocks__/mock-client.js";

// Mock credentials module
vi.mock("../../../credentials/index.js", () => ({
  hasProfiles: vi.fn(),
  listProfiles: vi.fn(),
  switchProfileAtomically: vi.fn(),
  getActiveProfileName: vi.fn(),
}));

vi.mock("../../../runtime/local-profile.js", () => ({
  validateLocalProfile: vi.fn(),
}));

// Mock client module
vi.mock("../../../client/index.js", () => ({
  promisify: mockPromisify,
  clearCredentialsCache: vi.fn(),
  clearLookupCache: vi.fn(),
  getCompanyIdValue: vi.fn(),
}));

import {
  hasProfiles,
  listProfiles,
  switchProfileAtomically,
  getActiveProfileName,
} from "../../../credentials/index.js";
import { clearCredentialsCache } from "../../../client/index.js";
import { validateLocalProfile } from "../../../runtime/local-profile.js";
import { handleListProfiles, handleSwitchProfile } from "../profiles.js";

const mockHasProfiles = vi.mocked(hasProfiles);
const mockListProfiles = vi.mocked(listProfiles);
const mockSwitchProfileAtomically = vi.mocked(switchProfileAtomically);
const mockGetActiveProfileName = vi.mocked(getActiveProfileName);
const mockClearCredentialsCache = vi.mocked(clearCredentialsCache);
const mockValidateLocalProfile = vi.mocked(validateLocalProfile);

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
      { name: "prod", mode: "aws" as never, secret_name: "qbo/prod", company_id: "111", upload_root_labels: ["AP", "Receipts"], active: true, is_default: true },
      { name: "dev", mode: "local" as never, secret_name: undefined, company_id: "222", active: false, is_default: false },
    ]);

    const result = await handleListProfiles();

    expect(result.content[0].text).toContain("prod");
    expect(result.content[0].text).toContain("ACTIVE");
    expect(result.content[0].text).toContain("default");
    expect(result.content[0].text).toContain("dev");
    expect(result.content[0].text).toContain("mode=aws");
    expect(result.content[0].text).toContain("mode=local");
    expect(result.content[0].text).toContain("uploads=[AP, Receipts]");
    expect(result.content[0].text).not.toContain("C:\\");
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
    expect(mockSwitchProfileAtomically).not.toHaveBeenCalled();
  });

  it("returns error when the target profile is invalid", async () => {
    mockHasProfiles.mockReturnValue(true);
    mockGetActiveProfileName.mockReturnValue("prod");
    mockSwitchProfileAtomically.mockRejectedValue(new Error('Profile "bad" not found'));

    const result = await handleSwitchProfile({ profile: "bad" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Profile "bad" not found');
  });

  it("switches successfully and returns company name", async () => {
    mockHasProfiles.mockReturnValue(true);
    mockGetActiveProfileName.mockReturnValue("prod");
    mockSwitchProfileAtomically.mockImplementation(async (_name, validate, activate) => {
      const value = await validate({ mode: "local" });
      activate();
      return { previousName: "prod", value };
    });
    mockValidateLocalProfile.mockResolvedValue("Dev Corp");

    const result = await handleSwitchProfile({ profile: "dev" });

    expect(result.content[0].text).toContain('Switched to profile "dev"');
    expect(result.content[0].text).toContain("Dev Corp");
    expect(mockClearCredentialsCache).toHaveBeenCalled();
    expect(mockValidateLocalProfile).toHaveBeenCalledWith("dev", { mode: "local" });
  });

  it("keeps the active profile and caches unchanged on candidate failure", async () => {
    mockHasProfiles.mockReturnValue(true);
    mockGetActiveProfileName.mockReturnValue("prod");
    mockSwitchProfileAtomically.mockRejectedValue(new Error("Connection refused"));

    const result = await handleSwitchProfile({ profile: "dev" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to connect");
    expect(result.content[0].text).toContain("Active profile remains");
    expect(result.content[0].text).toContain('"prod"');
    expect(mockClearCredentialsCache).not.toHaveBeenCalled();
  });
});
