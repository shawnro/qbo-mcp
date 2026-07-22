import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock credentials modules
vi.mock("../../../credentials/index.js", () => ({
  isLocalMode: vi.fn(),
  getCredentialMode: vi.fn(() => "aws"),
}));

vi.mock("../../../credentials/local-provider.js", () => {
  const mockGetClientCredentials = vi.fn();
  const mockSaveCredentials = vi.fn();
  return {
    LocalCredentialProvider: class {
      getClientCredentials = mockGetClientCredentials;
      saveCredentials = mockSaveCredentials;
    },
  };
});

vi.mock("../../../credentials/oauth-client.js", () => ({
  generateAuthorizationUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  getOAuthInstructions: vi.fn(),
}));

import { isLocalMode, getCredentialMode } from "../../../credentials/index.js";
import { LocalCredentialProvider } from "../../../credentials/local-provider.js";
import {
  generateAuthorizationUrl,
  exchangeCodeForTokens,
  getOAuthInstructions,
} from "../../../credentials/oauth-client.js";
import { handleAuthenticate } from "../authenticate.js";

const mockIsLocalMode = vi.mocked(isLocalMode);
const mockGetCredentialMode = vi.mocked(getCredentialMode);
const mockGenerateAuthUrl = vi.mocked(generateAuthorizationUrl);
const mockExchangeCode = vi.mocked(exchangeCodeForTokens);
const mockGetInstructions = vi.mocked(getOAuthInstructions);

// Get references to the mock methods on the provider prototype
const providerInstance = new LocalCredentialProvider();
const mockGetClientCredentials = providerInstance.getClientCredentials as ReturnType<typeof vi.fn>;
const mockSaveCredentials = providerInstance.saveCredentials as ReturnType<typeof vi.fn>;

describe("handleAuthenticate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when not in local mode", async () => {
    mockIsLocalMode.mockReturnValue(false);
    mockGetCredentialMode.mockReturnValue("aws" as never);

    const result = await handleAuthenticate({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("only works in local credential mode");
    expect(result.content[0].text).toContain("aws");
  });

  it("returns instructions when client credentials missing", async () => {
    mockIsLocalMode.mockReturnValue(true);
    mockGetClientCredentials.mockResolvedValue(null);

    const result = await handleAuthenticate({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Missing Client Credentials");
    expect(result.content[0].text).toContain("QBO_CLIENT_ID");
  });

  it("returns auth URL when no authorization_code provided", async () => {
    mockIsLocalMode.mockReturnValue(true);
    mockGetClientCredentials.mockResolvedValue({
      clientId: "id123",
      clientSecret: "secret456",
    });
    mockGenerateAuthUrl.mockReturnValue("https://oauth.intuit.com/authorize?...");
    mockGetInstructions.mockReturnValue("Follow these steps to authorize...");

    const result = await handleAuthenticate({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("Follow these steps to authorize...");
    expect(mockGenerateAuthUrl).toHaveBeenCalledWith("id123", "secret456");
  });

  it("returns error when authorization_code provided without realm_id", async () => {
    mockIsLocalMode.mockReturnValue(true);
    mockGetClientCredentials.mockResolvedValue({
      clientId: "id123",
      clientSecret: "secret456",
    });

    const result = await handleAuthenticate({ authorization_code: "abc123" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Missing realm_id");
  });

  it("exchanges code successfully and saves credentials", async () => {
    mockIsLocalMode.mockReturnValue(true);
    mockGetClientCredentials.mockResolvedValue({
      clientId: "id123",
      clientSecret: "secret456",
    });
    const fakeCreds = { access_token: "tok", refresh_token: "ref", realm_id: "9876" };
    mockExchangeCode.mockResolvedValue({
      credentials: fakeCreds,
      companyId: "9876",
    } as never);

    const result = await handleAuthenticate({
      authorization_code: "authcode",
      realm_id: "9876",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Authentication Successful");
    expect(result.content[0].text).toContain("9876");
    expect(mockSaveCredentials).toHaveBeenCalledWith(fakeCreds);
    expect(mockExchangeCode).toHaveBeenCalledWith("id123", "secret456", "authcode", "9876");
  });

  it("returns error when code exchange fails", async () => {
    mockIsLocalMode.mockReturnValue(true);
    mockGetClientCredentials.mockResolvedValue({
      clientId: "id123",
      clientSecret: "secret456",
    });
    mockExchangeCode.mockRejectedValue(new Error("Invalid authorization code"));

    const result = await handleAuthenticate({
      authorization_code: "expired",
      realm_id: "9876",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Authentication Failed");
    expect(result.content[0].text).toContain("Invalid authorization code");
  });
});
