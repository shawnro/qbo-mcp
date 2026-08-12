import { createCredentialProvider } from "../credentials/index.js";
import { getCredentialMode } from "../credentials/types.js";
import { DefaultQboCompanyRuntime } from "./company-runtime.js";
import { companyKey } from "./types.js";
import type { QboCompanyRuntime } from "./types.js";

let hostedRuntime: Promise<QboCompanyRuntime> | null = null;

export async function createHostedCompanyRuntime(
  env: Record<string, string | undefined> = process.env
): Promise<QboCompanyRuntime> {
  const mode = getCredentialMode(env);
  const secretName = env.QBO_SECRET_NAME;
  const provider = await createCredentialProvider(mode, secretName);
  const configured = await provider.isConfigured();
  if (!configured) throw new Error("Hosted QuickBooks credentials are not configured");
  const companyId = await provider.getCompanyId();
  return new DefaultQboCompanyRuntime({
    companyKey: companyKey(`hosted:${mode}:${secretName ?? "default"}:${companyId}`),
    companyId,
    provider,
    sandbox: env.QBO_SANDBOX === "true",
  });
}

export function getHostedCompanyRuntime(): Promise<QboCompanyRuntime> {
  if (!hostedRuntime) {
    const initializing = createHostedCompanyRuntime();
    const guarded = initializing.catch((error) => {
      if (hostedRuntime === guarded) hostedRuntime = null;
      throw error;
    });
    hostedRuntime = guarded;
  }
  return hostedRuntime;
}

export function clearHostedRuntimeForTests(): void {
  hostedRuntime = null;
}