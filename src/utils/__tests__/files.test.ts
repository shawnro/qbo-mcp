import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupExpiredReports, writeReport } from "../files.js";

const roots: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "qbo-files-test-"));
  roots.push(root);
  return root;
}

function createReportDirectory(
  root: string,
  name: string,
  modifiedAt: Date,
  owner?: unknown
): string {
  const directory = join(root, `qb-reports-${name}`);
  mkdirSync(directory);
  writeFileSync(join(directory, "report.json"), "{}");
  if (owner !== undefined) {
    writeFileSync(
      join(directory, ".qbo-mcp-owner.json"),
      typeof owner === "string" ? owner : JSON.stringify(owner)
    );
  }
  utimesSync(join(directory, "report.json"), modifiedAt, modifiedAt);
  utimesSync(directory, modifiedAt, modifiedAt);
  return directory;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("cleanupExpiredReports", () => {
  it("runs cleanup when writing a report", () => {
    const root = createRoot();
    const old = new Date(Date.now() - 8 * DAY_MS);
    const abandoned = createReportDirectory(root, "abandoned", old);
    const originalTemp = process.env.TEMP;
    const originalTmp = process.env.TMP;
    const originalTmpDir = process.env.TMPDIR;

    try {
      process.env.TEMP = root;
      process.env.TMP = root;
      process.env.TMPDIR = root;
      const filepath = writeReport("retention-test", { retained: true });

      expect(existsSync(abandoned)).toBe(false);
      expect(filepath.startsWith(root)).toBe(true);
      expect(JSON.parse(readFileSync(filepath, "utf8"))).toEqual({ retained: true });
    } finally {
      if (originalTemp === undefined) delete process.env.TEMP;
      else process.env.TEMP = originalTemp;
      if (originalTmp === undefined) delete process.env.TMP;
      else process.env.TMP = originalTmp;
      if (originalTmpDir === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = originalTmpDir;
    }
  });

  it("removes expired orphan and legacy directories while preserving live and recent owners", () => {
    const root = createRoot();
    const now = Date.UTC(2026, 9, 10);
    const old = new Date(now - 8 * DAY_MS);
    const recent = new Date(now - DAY_MS);
    const live = createReportDirectory(root, "live", old, { pid: 101 });
    const dead = createReportDirectory(root, "dead", old, { pid: 202 });
    const legacy = createReportDirectory(root, "legacy", old);
    const recentDead = createReportDirectory(root, "recent", recent, { pid: 303 });

    cleanupExpiredReports({
      rootDir: root,
      now,
      retentionMs: 7 * DAY_MS,
      isProcessAlive: (pid) => pid === 101,
    });

    expect(existsSync(live)).toBe(true);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(recentDead)).toBe(true);
  });

  it("prunes expired reports in the current directory without removing the directory or owner marker", () => {
    const root = createRoot();
    const now = Date.UTC(2026, 9, 10);
    const current = createReportDirectory(root, "current", new Date(now - 8 * DAY_MS), { pid: 101 });
    const recentReport = join(current, "recent.json");
    writeFileSync(recentReport, "{}");
    utimesSync(recentReport, new Date(now - DAY_MS), new Date(now - DAY_MS));

    cleanupExpiredReports({
      rootDir: root,
      currentReportsDir: current,
      now,
      retentionMs: 7 * DAY_MS,
    });

    expect(existsSync(current)).toBe(true);
    expect(existsSync(join(current, ".qbo-mcp-owner.json"))).toBe(true);
    expect(existsSync(join(current, "report.json"))).toBe(false);
    expect(existsSync(recentReport)).toBe(true);
  });

  it("preserves expired directories with malformed ownership metadata", () => {
    const root = createRoot();
    const now = Date.UTC(2026, 9, 10);
    const malformed = createReportDirectory(
      root,
      "malformed",
      new Date(now - 8 * DAY_MS),
      "not-json"
    );

    cleanupExpiredReports({ rootDir: root, now, retentionMs: 7 * DAY_MS });

    expect(existsSync(malformed)).toBe(true);
  });

  it("preserves an expired directory owned by the current process", () => {
    const root = createRoot();
    const now = Date.UTC(2026, 9, 10);
    const active = createReportDirectory(
      root,
      "active-process",
      new Date(now - 8 * DAY_MS),
      { pid: process.pid }
    );

    cleanupExpiredReports({ rootDir: root, now, retentionMs: 7 * DAY_MS });

    expect(existsSync(active)).toBe(true);
  });

  it("ignores unrelated temporary directories", () => {
    const root = createRoot();
    const unrelated = join(root, "other-temp-data");
    mkdirSync(unrelated);
    utimesSync(unrelated, new Date(0), new Date(0));

    cleanupExpiredReports({ rootDir: root, now: Date.UTC(2026, 9, 10), retentionMs: DAY_MS });

    expect(existsSync(unrelated)).toBe(true);
  });
});