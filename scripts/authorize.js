// OAuth authorization script for QuickBooks Online.
// Generates an auth URL, then exchanges the authorization code for tokens
// and saves them to Azure Key Vault.
//
// Usage:
//   node scripts/authorize.js --profile <profile-name>
//   node scripts/authorize.js --profile <profile-name> --code <code> --realm <realm-id>
//
// Prerequisites:
//   - Azure CLI logged in (az login) for Key Vault access
//   - .env file with AZURE_KEY_VAULT_URL and QBO_PROFILES_FILE

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import OAuthClient from "intuit-oauth";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- .env loader (same pattern as set-secret.cjs) ---
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

// --- CLI argument parsing ---
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const profileName = getArg("profile");
const manualCode = getArg("code");
const manualRealm = getArg("realm");

if (!profileName) {
  console.error("Usage: node scripts/authorize.js --profile <profile-name>");
  console.error("       node scripts/authorize.js --profile <profile-name> --code <auth-code> --realm <realm-id>");
  console.error("\nStep 1: Run without --code to get the authorization URL.");
  console.error("Step 2: Open the URL, authorize, copy code and realmId from the redirect URL.");
  console.error("Step 3: Run again with --code and --realm to exchange and save tokens.\n");
  console.error("Available profiles:");
  const profiles = loadProfiles();
  if (profiles) {
    for (const name of Object.keys(profiles.profiles)) {
      const mark = name === profiles.default ? " (default)" : "";
      console.error(`  - ${name}${mark}`);
    }
  }
  process.exit(1);
}

// --- Load profiles config ---
function getProfilesPath() {
  return process.env.QBO_PROFILES_FILE || join(process.env.HOME || process.env.USERPROFILE, ".qbo-mcp", "profiles.json");
}

function loadProfiles() {
  const filePath = getProfilesPath();
  if (!existsSync(filePath)) {
    console.error(`Profiles file not found: ${filePath}`);
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

const config = loadProfiles();
if (!config) process.exit(1);

const profile = config.profiles[profileName];
if (!profile) {
  console.error(`Profile "${profileName}" not found. Available: ${Object.keys(config.profiles).join(", ")}`);
  process.exit(1);
}

if (profile.mode !== "azure") {
  console.error(`Profile "${profileName}" uses mode "${profile.mode}". This script is for Azure Key Vault profiles.`);
  process.exit(1);
}

// --- Load client credentials from Key Vault ---
async function getSecretClient() {
  const vaultUrl = process.env.AZURE_KEY_VAULT_URL;
  if (!vaultUrl) {
    console.error("AZURE_KEY_VAULT_URL not set. Check your .env file.");
    process.exit(1);
  }
  const { SecretClient } = await import("@azure/keyvault-secrets");
  const { DefaultAzureCredential } = await import("@azure/identity");
  return new SecretClient(vaultUrl, new DefaultAzureCredential());
}

async function loadExistingCredentials(secretClient, secretName) {
  try {
    const secret = await secretClient.getSecret(secretName);
    if (secret.value) {
      return JSON.parse(secret.value);
    }
  } catch (e) {
    // Secret doesn't exist yet — that's fine for first-time setup
    if (e.code === "SecretNotFound" || e.statusCode === 404) {
      return null;
    }
    throw e;
  }
  return null;
}

async function main() {
  const secretName = profile.secret_name || "qbo-credentials";
  console.log(`\nProfile: ${profileName}`);
  console.log(`Secret:  ${secretName}`);

  const secretClient = await getSecretClient();

  // Try to load existing credentials (for client_id/client_secret)
  let existing = await loadExistingCredentials(secretClient, secretName);

  let clientId = existing?.client_id || process.env.QBO_CLIENT_ID;
  let clientSecret = existing?.client_secret || process.env.QBO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("\nCannot find client_id/client_secret.");
    console.error("Either the Key Vault secret must already contain them,");
    console.error("or set QBO_CLIENT_ID and QBO_CLIENT_SECRET environment variables.");
    process.exit(1);
  }

  // --- Manual code mode: exchange code directly without local server ---
  if (manualCode) {
    if (!manualRealm) {
      console.error("--realm is required when using --code");
      process.exit(1);
    }

    console.log("\nExchanging authorization code...");

    // Use the playground redirect URL since that's what was used for the auth request
    const playgroundRedirect = "https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl";
    const oauthClient = new OAuthClient({
      clientId,
      clientSecret,
      environment: process.env.QBO_SANDBOX === "true" ? "sandbox" : "production",
      redirectUri: playgroundRedirect,
    });

    const callbackUrl = `${playgroundRedirect}?code=${encodeURIComponent(manualCode)}&realmId=${encodeURIComponent(manualRealm)}`;
    const authResponse = await oauthClient.createToken(callbackUrl);
    const token = authResponse.getToken();

    const companyId = profile.company_id || manualRealm;
    const credentials = {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_url: playgroundRedirect,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      company_id: companyId,
    };

    await secretClient.setSecret(secretName, JSON.stringify(credentials));

    console.log("\n✓ Authorization successful!");
    console.log(`  Company ID: ${companyId}`);
    console.log(`  Saved to Key Vault secret: ${secretName}`);
    console.log(`  Access token: ${token.access_token?.substring(0, 20)}...`);
    console.log(`  Refresh token: ${token.refresh_token?.substring(0, 20)}...`);
    process.exit(0);
  }

  // --- Generate auth URL mode (no --code provided) ---
  // Uses the playground redirect URL (already registered in Intuit portal)
  // since localhost can't be registered for production apps.
  const playgroundRedirect = "https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl";
  const environment = process.env.QBO_SANDBOX === "true" ? "sandbox" : "production";

  const oauthClient = new OAuthClient({
    clientId,
    clientSecret,
    environment,
    redirectUri: playgroundRedirect,
  });

  const authUri = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log("Step 1: Open this URL in your browser:\n");
  console.log(authUri);
  console.log(`\n${"=".repeat(60)}`);
  console.log("\nStep 2: Authorize the app in QuickBooks.");
  console.log("\nStep 3: After redirect, copy the 'code' and 'realmId' from the URL bar.");
  console.log("        The URL will look like:");
  console.log("        https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl?code=AB11...&realmId=12345...");
  console.log(`\nStep 4: Run this command:`);
  console.log(`        node scripts/authorize.js --profile ${profileName} --code <CODE> --realm <REALM_ID>`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message || err);
  process.exit(1);
});
