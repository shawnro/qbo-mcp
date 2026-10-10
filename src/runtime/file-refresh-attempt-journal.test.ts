import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileRefreshAttemptJournal,
  IndeterminateCredentialRefreshError,
} from "./file-refresh-coordinator.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const rootDir = await fs.mkdtemp(join(tmpdir(), "qbo-refresh-journal-test-"));
  roots.push(rootDir);
  const scope = "test:journal-grant";
  const name = createHash("sha256").update(scope).digest("hex");
  return {
    rootDir,
    attemptPath: join(rootDir, `${name}.attempt.json`),
    journal: new FileRefreshAttemptJournal(scope, { rootDir }),
  };
}

describe("FileRefreshAttemptJournal", () => {
  it("fails closed while stored credentials still match an unfinished attempt", async () => {
    const { journal } = await fixture();
    const fingerprint = "a".repeat(64);
    await journal.begin(fingerprint);

    await expect(journal.assertResolved(fingerprint)).rejects.toBeInstanceOf(
      IndeterminateCredentialRefreshError
    );
  });

  it("clears an unfinished attempt when stored credentials prove persistence succeeded", async () => {
    const { attemptPath, journal } = await fixture();
    await journal.begin("a".repeat(64));

    await expect(journal.assertResolved("b".repeat(64))).resolves.toBeUndefined();
    await expect(fs.stat(attemptPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stores only a fingerprint and metadata, never credential values", async () => {
    const { attemptPath, journal } = await fixture();
    const accessToken = "synthetic-access-token";
    const refreshToken = "synthetic-refresh-token";
    const fingerprint = createHash("sha256")
      .update(accessToken)
      .update("\0")
      .update(refreshToken)
      .digest("hex");
    await journal.begin(fingerprint);

    const content = await fs.readFile(attemptPath, "utf8");
    expect(content).toContain(fingerprint);
    expect(content).not.toContain(accessToken);
    expect(content).not.toContain(refreshToken);
  });

  it.each([
    "not-json",
    "null",
    JSON.stringify({
      version: 1,
      credentialFingerprint: "x".repeat(64),
      startedAt: new Date().toISOString(),
    }),
  ])("fails closed when the journal is malformed: %s", async (content) => {
    const { attemptPath, journal, rootDir } = await fixture();
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(attemptPath, content, { mode: 0o600 });

    await expect(journal.assertResolved("a".repeat(64))).rejects.toBeInstanceOf(
      IndeterminateCredentialRefreshError
    );
  });
});