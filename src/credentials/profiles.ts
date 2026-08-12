// Profile management for multi-company QuickBooks support

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join } from "path";
import type { CredentialMode } from "./types.js";

const VALID_MODES: CredentialMode[] = ["local", "aws", "azure"];

/**
 * A single QBO profile — maps to one company context.
 */
export interface QBProfile {
  mode: CredentialMode;
  secret_name?: string;
  company_id?: string;
  upload_roots?: QBUploadRoot[];
}

export interface QBUploadRoot {
  label: string;
  path: string;
}

/**
 * Top-level profiles config file structure.
 */
export interface QBProfileConfig {
  default: string;
  profiles: Record<string, QBProfile>;
}

// Module-level state
let profileConfig: QBProfileConfig | null = null;
let activeProfileName: string | null = null;

/**
 * Resolve the profiles config file path.
 * Checks QBO_PROFILES_FILE env var, then falls back to ~/.qbo-mcp/profiles.json.
 */
function getProfilesPath(): string {
  return process.env.QBO_PROFILES_FILE || join(homedir(), ".qbo-mcp", "profiles.json");
}

/**
 * Validate a parsed profiles config. Throws descriptive errors for invalid config.
 */
function validateConfig(config: unknown, filePath: string): QBProfileConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Profiles config at ${filePath} must be a JSON object.`);
  }

  const obj = config as Record<string, unknown>;

  if (typeof obj.default !== "string" || !obj.default) {
    throw new Error(`Profiles config at ${filePath} is missing required "default" field.`);
  }

  if (!obj.profiles || typeof obj.profiles !== "object" || Array.isArray(obj.profiles)) {
    throw new Error(`Profiles config at ${filePath} is missing required "profiles" object.`);
  }

  const profiles = obj.profiles as Record<string, unknown>;
  const profileNames = Object.keys(profiles);

  if (profileNames.length === 0) {
    throw new Error(`Profiles config at ${filePath} has no profiles defined.`);
  }

  // Validate each profile
  for (const name of profileNames) {
    const profile = profiles[name];
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      throw new Error(`Profile "${name}" in ${filePath} must be an object.`);
    }

    const p = profile as Record<string, unknown>;

    if (typeof p.mode !== "string" || !VALID_MODES.includes(p.mode as CredentialMode)) {
      throw new Error(
        `Profile "${name}" in ${filePath} has invalid "mode": "${p.mode}". ` +
        `Must be one of: ${VALID_MODES.join(", ")}.`
      );
    }

    // secret_name required for aws and azure modes
    if ((p.mode === "aws" || p.mode === "azure") && (typeof p.secret_name !== "string" || !p.secret_name)) {
      throw new Error(
        `Profile "${name}" in ${filePath} requires "secret_name" for "${p.mode}" mode.`
      );
    }

    // company_id is optional but must be a string if provided
    if (p.company_id !== undefined && typeof p.company_id !== "string") {
      throw new Error(
        `Profile "${name}" in ${filePath} has invalid "company_id": must be a string.`
      );
    }

    if (p.upload_roots !== undefined) {
      if (!Array.isArray(p.upload_roots)) {
        throw new Error(
          `Profile "${name}" in ${filePath} has invalid "upload_roots": must be an array.`
        );
      }
      if (p.upload_roots.length === 0) {
        throw new Error(
          `Profile "${name}" in ${filePath} has invalid "upload_roots": omit the field or configure at least one root.`
        );
      }
      const labels = new Set<string>();
      for (const [index, root] of p.upload_roots.entries()) {
        if (!root || typeof root !== "object" || Array.isArray(root)) {
          throw new Error(
            `Profile "${name}" upload_roots[${index}] must be an object with label and path.`
          );
        }
        const entry = root as Record<string, unknown>;
        if (typeof entry.label !== "string" || !entry.label.trim()) {
          throw new Error(`Profile "${name}" upload_roots[${index}] requires a non-empty label.`);
        }
        const label = entry.label.trim();
        const normalizedLabel = label.toLowerCase();
        if (labels.has(normalizedLabel)) {
          throw new Error(`Profile "${name}" has duplicate upload root label "${entry.label}".`);
        }
        labels.add(normalizedLabel);
        if (typeof entry.path !== "string" || !isAbsolute(entry.path.trim())) {
          throw new Error(
            `Profile "${name}" upload root "${entry.label}" path must be absolute.`
          );
        }
        entry.label = label;
        entry.path = entry.path.trim();
      }
    }
  }

  // Validate default points to an existing profile
  if (!profiles[obj.default as string]) {
    throw new Error(
      `Profiles config at ${filePath}: default profile "${obj.default}" not found. ` +
      `Available profiles: ${profileNames.join(", ")}.`
    );
  }

  return {
    default: obj.default as string,
    profiles: profiles as Record<string, QBProfile>,
  };
}

/**
 * Load and validate profiles config from disk.
 * Returns true if profiles were loaded, false if file doesn't exist (backward-compat).
 * Throws on malformed config — present but broken is a fatal error, not a silent fallback.
 */
export function loadProfiles(): boolean {
  const filePath = getProfilesPath();

  if (!existsSync(filePath)) {
    profileConfig = null;
    activeProfileName = null;
    return false;
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    throw new Error(`Failed to read profiles config at ${filePath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Profiles config at ${filePath} contains invalid JSON.`);
  }

  profileConfig = validateConfig(parsed, filePath);
  activeProfileName = profileConfig.default;
  return true;
}

/**
 * Whether profiles config has been loaded.
 */
export function hasProfiles(): boolean {
  return profileConfig !== null;
}

/**
 * Get the name of the currently active profile.
 * Returns null if profiles are not loaded.
 */
export function getActiveProfileName(): string | null {
  return activeProfileName;
}

/**
 * Get the QBProfile object for the currently active profile.
 * Returns null if profiles are not loaded.
 */
export function getActiveProfile(): QBProfile | null {
  if (!profileConfig || !activeProfileName) return null;
  return profileConfig.profiles[activeProfileName] ?? null;
}

export function getProfile(name: string): QBProfile {
  if (!profileConfig) {
    throw new Error("Cannot switch profiles: no profiles config loaded.");
  }
  const profile = profileConfig.profiles[name];
  if (!profile) {
    throw new Error(
      `Profile "${name}" not found. Available profiles: ${Object.keys(profileConfig.profiles).join(", ")}.`
    );
  }
  return profile;
}

/**
 * Set the active profile by name.
 * Throws if the profile name doesn't exist in the config.
 */
export function setActiveProfile(name: string): void {
  if (!profileConfig) {
    throw new Error("Cannot switch profiles: no profiles config loaded.");
  }
  if (!profileConfig.profiles[name]) {
    throw new Error(
      `Profile "${name}" not found. Available profiles: ${Object.keys(profileConfig.profiles).join(", ")}.`
    );
  }
  activeProfileName = name;
}

/**
 * List all profiles with metadata.
 * Returns an array of profile info objects for display purposes.
 */
export function listProfiles(): Array<{
  name: string;
  mode: CredentialMode;
  secret_name?: string;
  company_id?: string;
  upload_root_labels?: string[];
  active: boolean;
  is_default: boolean;
}> {
  if (!profileConfig) return [];

  return Object.entries(profileConfig.profiles).map(([name, profile]) => ({
    name,
    mode: profile.mode,
    secret_name: profile.secret_name,
    company_id: profile.company_id,
    upload_root_labels: profile.upload_roots?.map((root) => root.label),
    active: name === activeProfileName,
    is_default: name === profileConfig!.default,
  }));
}
