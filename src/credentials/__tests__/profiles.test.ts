import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getActiveProfile,
  listProfiles,
  loadProfiles,
} from "../profiles.js";

let tempDir: string;
let profilesPath: string;

beforeEach(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qbo-profiles-test-"));
  profilesPath = path.join(tempDir, "profiles.json");
  process.env.QBO_PROFILES_FILE = profilesPath;
});

afterEach(async () => {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
  delete process.env.QBO_PROFILES_FILE;
  loadProfiles();
});

async function writeConfig(config: unknown): Promise<void> {
  await fs.promises.writeFile(profilesPath, JSON.stringify(config), "utf8");
}

describe("profile upload roots", () => {
  it("loads multiple labeled roots and lists labels without paths", async () => {
    const apRoot = path.join(tempDir, "ap");
    const receiptRoot = path.join(tempDir, "receipts");
    await writeConfig({
      default: "business-a",
      profiles: {
        "business-a": {
          mode: "local",
          company_id: "123",
          upload_roots: [
            { label: "AP Invoices", path: apRoot },
            { label: "Receipts", path: receiptRoot },
          ],
        },
      },
    });

    expect(loadProfiles()).toBe(true);
    expect(getActiveProfile()?.upload_roots).toEqual([
      { label: "AP Invoices", path: apRoot },
      { label: "Receipts", path: receiptRoot },
    ]);
    expect(listProfiles()[0].upload_root_labels).toEqual(["AP Invoices", "Receipts"]);
    expect(listProfiles()[0]).not.toHaveProperty("upload_roots");
  });

  it("rejects a non-array upload_roots value", async () => {
    await writeConfig({
      default: "business-a",
      profiles: { "business-a": { mode: "local", upload_roots: "invoices" } },
    });
    expect(() => loadProfiles()).toThrow("upload_roots\": must be an array");
  });

  it("rejects an explicitly empty upload_roots array", async () => {
    await writeConfig({
      default: "business-a",
      profiles: { "business-a": { mode: "local", upload_roots: [] } },
    });
    expect(() => loadProfiles()).toThrow("configure at least one root");
  });

  it("rejects relative paths", async () => {
    await writeConfig({
      default: "business-a",
      profiles: {
        "business-a": {
          mode: "local",
          upload_roots: [{ label: "AP", path: "relative/invoices" }],
        },
      },
    });
    expect(() => loadProfiles()).toThrow("path must be absolute");
  });

  it("rejects duplicate labels case-insensitively", async () => {
    await writeConfig({
      default: "business-a",
      profiles: {
        "business-a": {
          mode: "local",
          upload_roots: [
            { label: "AP", path: path.join(tempDir, "ap") },
            { label: "ap", path: path.join(tempDir, "other") },
          ],
        },
      },
    });
    expect(() => loadProfiles()).toThrow('duplicate upload root label "ap"');
  });
});
