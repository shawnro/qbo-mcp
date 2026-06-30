// Handlers for profile listing and switching tools

import {
  hasProfiles,
  listProfiles,
  switchProfile,
  getActiveProfileName,
} from "../../credentials/index.js";
import { getClient, clearCredentialsCache, refreshTokens, isAuthError, promisify } from "../../client/index.js";

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

/**
 * List all configured QBO profiles (config-only, no QBO API calls).
 */
export async function handleListProfiles(): Promise<ToolResult> {
  if (!hasProfiles()) {
    return {
      content: [{
        type: "text",
        text: "No profiles configured. The server is running in single-company mode.\n\n" +
          "To use multiple companies, create a profiles config file at " +
          "~/.quickbooks-mcp/profiles.json (or set QBO_PROFILES_FILE).",
      }],
    };
  }

  const profiles = listProfiles();
  const lines = profiles.map((p) => {
    const flags: string[] = [];
    if (p.active) flags.push("ACTIVE");
    if (p.is_default) flags.push("default");
    const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
    const companyId = p.company_id ? ` (company: ${p.company_id})` : "";
    const secret = p.secret_name ? ` secret=${p.secret_name}` : "";
    return `  ${p.name}${flagStr} — mode=${p.mode}${secret}${companyId}`;
  });

  return {
    content: [{
      type: "text",
      text: `QBO Profiles:\n\n${lines.join("\n")}`,
    }],
  };
}

/**
 * Switch to a different QBO profile.
 * Validates the switch by connecting and fetching company info.
 * On failure, rolls back to the previous profile.
 */
export async function handleSwitchProfile(
  args: { profile: string }
): Promise<ToolResult> {
  if (!hasProfiles()) {
    return {
      content: [{
        type: "text",
        text: "Cannot switch profiles: no profiles config loaded. " +
          "Create ~/.quickbooks-mcp/profiles.json to enable multi-company support.",
      }],
      isError: true,
    };
  }

  const targetProfile = args.profile;
  const currentProfile = getActiveProfileName();

  if (targetProfile === currentProfile) {
    return {
      content: [{
        type: "text",
        text: `Already on profile "${targetProfile}".`,
      }],
    };
  }

  // Switch profile and clear all cached state
  let previousProfile: string;
  try {
    previousProfile = switchProfile(targetProfile);
  } catch (err) {
    return {
      content: [{
        type: "text",
        text: `Failed to switch profile: ${(err as Error).message}`,
      }],
      isError: true,
    };
  }

  // Clear client-side caches (credentials, QB client, lookup caches)
  clearCredentialsCache();

  // Validate the new profile by connecting to QBO
  const tryConnect = async () => {
    const client = await getClient();
    const companyInfo = await promisify<unknown>((cb) =>
      client.getCompanyInfo(client.realmId as string, cb)
    );
    return (companyInfo as { CompanyName?: string })?.CompanyName || "Unknown";
  };

  try {
    let companyName: string;
    try {
      companyName = await tryConnect();
    } catch (err) {
      // If access token is expired, refresh and retry once
      if (!isAuthError(err)) throw err;
      await refreshTokens();
      companyName = await tryConnect();
    }

    return {
      content: [{
        type: "text",
        text: `Switched to profile "${targetProfile}" — connected to ${companyName}.`,
      }],
    };
  } catch (err) {
    // Rollback: restore previous profile and all state
    try {
      switchProfile(previousProfile);
      clearCredentialsCache();
    } catch {
      // Best-effort rollback — if this also fails, we're in trouble
    }

    return {
      content: [{
        type: "text",
        text: `Failed to connect after switching to "${targetProfile}": ${(err as Error).message}\n\n` +
          `Rolled back to profile "${previousProfile}".`,
      }],
      isError: true,
    };
  }
}
