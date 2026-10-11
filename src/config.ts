export type RuntimeEnvironment = Record<string, string | undefined>;

export type CredentialMode = "local" | "aws" | "azure";

const BOOLEAN_SETTINGS = [
  "QBO_SANDBOX",
  "QBO_INLINE_OUTPUT",
  "QBO_DISABLE_CREATE",
  "QBO_DISABLE_UPDATE",
  "QBO_DISABLE_DELETE",
] as const;

export type BooleanSetting = typeof BOOLEAN_SETTINGS[number];

export function parseBooleanSetting(
  name: BooleanSetting,
  env: RuntimeEnvironment = process.env
): boolean {
  const configured = env[name];
  if (configured === undefined) return false;

  const normalized = configured.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function parseCredentialMode(
  env: RuntimeEnvironment = process.env
): CredentialMode {
  const configured = env.QBO_CREDENTIAL_MODE;
  if (configured === undefined) return "local";

  const normalized = configured.trim().toLowerCase();
  if (normalized === "local" || normalized === "aws" || normalized === "azure") {
    return normalized;
  }
  throw new Error("QBO_CREDENTIAL_MODE must be local, aws, or azure");
}

export function validateRuntimeEnvironment(
  env: RuntimeEnvironment = process.env
): void {
  parseCredentialMode(env);
  for (const name of BOOLEAN_SETTINGS) parseBooleanSetting(name, env);
}