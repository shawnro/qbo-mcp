// Uploads a JSON file as a Key Vault secret using --file flag.
// Bypasses PowerShell string mangling entirely.
// Validates JSON before uploading. Never prints secret values.
//
// Usage: node scripts/set-secret.cjs <secret-name> <json-file> [--vault-name <vault>]

const { execSync } = require("child_process");
const { readFileSync, existsSync } = require("fs");
const { join, resolve } = require("path");

// Load .env from repo root for AZURE_KEY_VAULT_URL
const envPath = join(__dirname, "..", ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx);
        const val = trimmed.slice(eqIdx + 1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

/**
 * Extract vault name from AZURE_KEY_VAULT_URL (e.g., "https://myvault.vault.azure.net" → "myvault")
 */
function getVaultNameFromEnv() {
  const url = process.env.AZURE_KEY_VAULT_URL;
  if (!url) return null;
  const match = url.match(/https:\/\/([^.]+)\.vault\.azure\.net/);
  return match ? match[1] : null;
}

/**
 * Load profiles.json and list available secret names for help text.
 */
function getProfileSecrets() {
  const profilesPath = process.env.QBO_PROFILES_FILE
    || join(require("os").homedir(), ".quickbooks-mcp", "profiles.json");
  if (!existsSync(profilesPath)) return null;
  try {
    const config = JSON.parse(readFileSync(profilesPath, "utf-8"));
    const secrets = new Map();
    for (const [name, profile] of Object.entries(config.profiles || {})) {
      const secretName = profile.secret_name;
      if (secretName) {
        if (!secrets.has(secretName)) secrets.set(secretName, []);
        secrets.get(secretName).push(name);
      }
    }
    return secrets;
  } catch { return null; }
}

const args = process.argv.slice(2);
const secretName = args[0];
const jsonFile = args[1];
const vaultName = args.includes("--vault-name")
  ? args[args.indexOf("--vault-name") + 1]
  : getVaultNameFromEnv();

if (!secretName || !jsonFile) {
  console.error("Usage: node scripts/set-secret.cjs <secret-name> <json-file> [--vault-name <vault>]");
  console.error("");
  const secrets = getProfileSecrets();
  if (secrets && secrets.size > 0) {
    console.error("Available secrets (from profiles.json):");
    for (const [secret, profiles] of secrets) {
      console.error(`  ${secret}  (profiles: ${profiles.join(", ")})`);
    }
  }
  if (!vaultName) {
    console.error("");
    console.error("WARNING: No vault name found. Set AZURE_KEY_VAULT_URL in .env or use --vault-name.");
  }
  process.exit(1);
}

if (!vaultName) {
  console.error("No vault name found. Set AZURE_KEY_VAULT_URL in .env or pass --vault-name <vault>.");
  process.exit(1);
}

if (!existsSync(jsonFile)) {
  console.error(`File not found: ${jsonFile}`);
  process.exit(1);
}

// Validate it's proper JSON with expected fields
let parsed;
try {
  const raw = readFileSync(jsonFile, "utf-8");
  parsed = JSON.parse(raw);
} catch (err) {
  console.error(`Invalid JSON in ${jsonFile}: ${err.message}`);
  process.exit(1);
}

const keys = Object.keys(parsed);
console.log(`File contains ${keys.length} fields: ${keys.join(", ")}`);

const required = ["client_id", "client_secret", "access_token", "refresh_token", "redirect_url"];
const missing = required.filter(k => !parsed[k]);
if (missing.length > 0) {
  console.error(`Missing required fields: ${missing.join(", ")}`);
  process.exit(1);
}

// Check for placeholder values
const placeholders = required.filter(k => parsed[k].startsWith("PASTE_"));
if (placeholders.length > 0) {
  console.error(`Still has placeholder values: ${placeholders.join(", ")}`);
  console.error("Replace PASTE_* values with real credentials from the OAuth Playground.");
  process.exit(1);
}

// Upload via --file
console.log(`Uploading to secret "${secretName}" in vault "${vaultName}"...`);
try {
  execSync(
    `az keyvault secret set --vault-name ${vaultName} --name ${secretName} --file "${jsonFile}" --encoding utf-8`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  console.log("Upload complete.");
} catch (err) {
  console.error(`Failed to upload: ${err.message}`);
  process.exit(1);
}

// Verify
console.log("Verifying...");
try {
  const verify = execSync(
    `az keyvault secret show --vault-name ${vaultName} --name ${secretName} --query "value" -o tsv`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  ).trim();
  const verifiedParsed = JSON.parse(verify);
  const verifiedKeys = Object.keys(verifiedParsed);
  console.log(`SUCCESS: "${secretName}" is valid JSON with ${verifiedKeys.length} fields: ${verifiedKeys.join(", ")}`);
} catch (err) {
  console.error(`VERIFICATION FAILED: ${err.message}`);
  process.exit(1);
}

console.log("");
console.log("IMPORTANT: Delete your credentials file now:");
console.log(`  Remove-Item ${jsonFile}`);
