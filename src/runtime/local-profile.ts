import type { QBProfile } from "../credentials/profiles.js";
import { createCredentialProvider } from "../credentials/index.js";
import { isAuthError, promisify } from "../client/index.js";
import { DefaultQboCompanyRuntime } from "./company-runtime.js";
import { companyKey } from "./types.js";

export async function validateLocalProfile(
  name: string,
  profile: QBProfile
): Promise<string> {
  const provider = await createCredentialProvider(profile.mode, profile.secret_name);
  if (!await provider.isConfigured()) {
    throw new Error(`QuickBooks credentials are not configured for profile "${name}".`);
  }
  const companyId = profile.company_id ?? await provider.getCompanyId();
  const runtime = new DefaultQboCompanyRuntime({
    companyKey: companyKey(`local:${name}:${companyId}`),
    companyId,
    provider,
    sandbox: process.env.QBO_SANDBOX === "true",
  });

  const connect = async () => {
    const attempt = await runtime.createClientAttempt();
    try {
      const companyInfo = await promisify<unknown>((callback) =>
        attempt.client.getCompanyInfo(companyId, callback)
      );
      return (companyInfo as { CompanyName?: string })?.CompanyName || "Unknown";
    } catch (error) {
      if (!isAuthError(error)) throw error;
      await runtime.refreshAfterAuthError(attempt.credentialFingerprint);
      const retry = await runtime.createClientAttempt();
      const companyInfo = await promisify<unknown>((callback) =>
        retry.client.getCompanyInfo(companyId, callback)
      );
      return (companyInfo as { CompanyName?: string })?.CompanyName || "Unknown";
    }
  };

  return connect();
}