// Handlers for profile listing and switching tools

import {
  hasProfiles,
  listProfiles,
  switchProfileAtomically,
  getActiveProfileName,
} from "../../credentials/index.js";
import { clearCredentialsCache } from "../../client/index.js";
import { validateLocalProfile } from "../../runtime/local-profile.js";

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
          "~/.qbo-mcp/profiles.json (or set QBO_PROFILES_FILE).",
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
    const uploadRoots = p.upload_root_labels?.length
      ? ` uploads=[${p.upload_root_labels.join(", ")}]`
      : "";
    return `  ${p.name}${flagStr} — mode=${p.mode}${secret}${companyId}${uploadRoots}`;
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
          "Create ~/.qbo-mcp/profiles.json to enable multi-company support.",
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

  try {
    const { value: companyName } = await switchProfileAtomically(
      targetProfile,
      (profile) => validateLocalProfile(targetProfile, profile),
      clearCredentialsCache
    );
    return {
      content: [{
        type: "text",
        text: `Switched to profile "${targetProfile}" — connected to ${companyName}.`,
      }],
    };
  } catch (err) {
    return {
      content: [{
        type: "text",
        text: `Failed to connect after switching to "${targetProfile}": ${(err as Error).message}\n\n` +
          `Active profile remains "${getActiveProfileName()}".`,
      }],
      isError: true,
    };
  }
}
