// File utilities for report output

import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import tmp from "tmp";

// Enable automatic cleanup on process exit
tmp.setGracefulCleanup();

const REPORTS_PREFIX = "qb-reports-";
const OWNER_FILENAME = ".qbo-mcp-owner.json";
export const REPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

// Lazy temp directory — only created on first writeReport() call
let reportsDir: string | null = null;
let lastCleanupAt = 0;

function getReportsDir(): string {
  if (!reportsDir) {
    const tmpDir = tmp.dirSync({ prefix: REPORTS_PREFIX, unsafeCleanup: true });
    reportsDir = tmpDir.name;
    writeFileSync(
      join(reportsDir, OWNER_FILENAME),
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
    );
  }
  return reportsDir;
}

interface CleanupOptions {
  rootDir?: string;
  currentReportsDir?: string | null;
  now?: number;
  retentionMs?: number;
  isProcessAlive?: (pid: number) => boolean;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readOwnerPid(directory: string): number | null | undefined {
  try {
    const owner = JSON.parse(readFileSync(join(directory, OWNER_FILENAME), "utf8")) as { pid?: unknown };
    return typeof owner.pid === "number" && Number.isSafeInteger(owner.pid) && owner.pid > 0
      ? owner.pid
      : undefined;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : undefined;
  }
}

function removeExpiredCurrentReports(directory: string, cutoff: number): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === OWNER_FILENAME || !entry.name.endsWith(".json")) continue;
    try {
      const filepath = join(directory, entry.name);
      if (statSync(filepath).mtimeMs < cutoff) rmSync(filepath, { force: true });
    } catch {
      // Another process or cleanup pass may have already changed this file.
    }
  }
}

export function cleanupExpiredReports(options: CleanupOptions = {}): void {
  const rootDir = options.rootDir ?? tmpdir();
  const currentReportsDir = options.currentReportsDir ?? reportsDir;
  const cutoff = (options.now ?? Date.now()) - (options.retentionMs ?? REPORT_RETENTION_MS);
  const processAlive = options.isProcessAlive ?? isProcessAlive;

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(REPORTS_PREFIX)) continue;
    const directory = join(rootDir, entry.name);

    try {
      if (directory === currentReportsDir) {
        removeExpiredCurrentReports(directory, cutoff);
        continue;
      }

      const ownerPid = readOwnerPid(directory);
      if (ownerPid === undefined || (ownerPid !== null && processAlive(ownerPid))) continue;
      if (statSync(directory).mtimeMs < cutoff) rmSync(directory, { recursive: true, force: true });
    } catch {
      // Keep scanning if an entry disappears or cannot be inspected.
    }
  }
}

function cleanupReportsOnWrite(directory: string, now = Date.now()): void {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;

  try {
    cleanupExpiredReports({ currentReportsDir: directory, now });
  } catch {
    // Report delivery must not fail because best-effort retention cleanup failed.
  }
}

// Handle signals for graceful cleanup
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

export function writeReport(reportType: string, data: unknown): string {
  const dir = getReportsDir();
  cleanupReportsOnWrite(dir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${reportType}-${timestamp}.json`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(data, null, 2));
  return filepath;
}
