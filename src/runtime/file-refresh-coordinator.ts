import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CredentialProvider } from "../credentials/types.js";
import type { RefreshCoordinator } from "./refresh-coordinator.js";
import type { RefreshAttemptJournal } from "./credential-refresh.js";

export class RefreshLockTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for the QuickBooks credential refresh lock`);
    this.name = "RefreshLockTimeoutError";
  }
}

export interface FileRefreshCoordinatorOptions {
  rootDir?: string;
  waitTimeoutMs?: number;
  staleAfterMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_WAIT_TIMEOUT_MS = 60_000;
const DEFAULT_STALE_AFTER_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function refreshStatePaths(scope: string, rootDir?: string) {
  const root = rootDir ?? join(homedir(), ".qbo-mcp", "refresh-locks");
  const name = createHash("sha256").update(scope).digest("hex");
  return {
    lockTarget: join(root, name),
    attemptPath: join(root, `${name}.attempt.json`),
  };
}

export class FileRefreshCoordinator implements RefreshCoordinator {
  private readonly lockTarget: string;
  private readonly waitTimeoutMs: number;
  private readonly staleAfterMs: number;
  private readonly pollIntervalMs: number;

  constructor(scope: string, options: FileRefreshCoordinatorOptions = {}) {
    this.lockTarget = refreshStatePaths(scope, options.rootDir).lockTarget;
    this.waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    if (this.waitTimeoutMs < 1 || this.staleAfterMs < 2_000 || this.pollIntervalMs < 1) {
      throw new Error("Refresh lock timeouts must be positive and staleAfterMs must be at least 2000");
    }
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await fs.mkdir(dirname(this.lockTarget), { recursive: true });
    const { lock } = await import("proper-lockfile");

    let release: (() => Promise<void>) | undefined;
    try {
      release = await lock(this.lockTarget, {
        realpath: false,
        stale: this.staleAfterMs,
        update: Math.max(1_000, Math.floor(this.staleAfterMs / 3)),
        retries: {
          retries: Math.max(0, Math.ceil(this.waitTimeoutMs / this.pollIntervalMs) - 1),
          factor: 1,
          minTimeout: this.pollIntervalMs,
          maxTimeout: this.pollIntervalMs,
          randomize: false,
        },
      });
    } catch (error) {
      if (errorCode(error) === "ELOCKED") {
        throw new RefreshLockTimeoutError(this.waitTimeoutMs);
      }
      throw error;
    }

    try {
      return await operation();
    } finally {
      await release();
    }
  }
}

export class IndeterminateCredentialRefreshError extends Error {
  readonly code = "INDETERMINATE_CREDENTIAL_REFRESH";

  constructor(message = "A previous QuickBooks credential refresh may have rotated the token before it could be persisted. Reauthorize QuickBooks before retrying.") {
    super(message);
    this.name = "IndeterminateCredentialRefreshError";
  }
}

interface RefreshAttemptRecord {
  version: 1;
  credentialFingerprint: string;
  startedAt: string;
}

export class FileRefreshAttemptJournal implements RefreshAttemptJournal {
  private readonly attemptPath: string;

  constructor(scope: string, options: Pick<FileRefreshCoordinatorOptions, "rootDir"> = {}) {
    this.attemptPath = refreshStatePaths(scope, options.rootDir).attemptPath;
  }

  async assertResolved(currentCredentialFingerprint: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.attemptPath, "utf8"));
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw new IndeterminateCredentialRefreshError(
        "The QuickBooks credential refresh journal is unreadable. Reauthorize QuickBooks before retrying."
      );
    }

    if (
      typeof parsed !== "object"
      || parsed === null
      || !("version" in parsed)
      || !("credentialFingerprint" in parsed)
      || !("startedAt" in parsed)
    ) {
      throw new IndeterminateCredentialRefreshError(
        "The QuickBooks credential refresh journal is invalid. Reauthorize QuickBooks before retrying."
      );
    }
    const record = parsed as Partial<RefreshAttemptRecord>;
    if (
      record.version !== 1
      || typeof record.credentialFingerprint !== "string"
      || !/^[0-9a-f]{64}$/.test(record.credentialFingerprint)
      || typeof record.startedAt !== "string"
      || !Number.isFinite(Date.parse(record.startedAt))
    ) {
      throw new IndeterminateCredentialRefreshError(
        "The QuickBooks credential refresh journal is invalid. Reauthorize QuickBooks before retrying."
      );
    }
    if (record.credentialFingerprint === currentCredentialFingerprint) {
      throw new IndeterminateCredentialRefreshError();
    }
    await this.complete();
  }

  async begin(credentialFingerprint: string): Promise<void> {
    await fs.mkdir(dirname(this.attemptPath), { recursive: true });
    const temporaryPath = `${this.attemptPath}.${randomUUID()}.tmp`;
    const record: RefreshAttemptRecord = {
      version: 1,
      credentialFingerprint,
      startedAt: new Date().toISOString(),
    };
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(temporaryPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify(record), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(temporaryPath, this.attemptPath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async complete(): Promise<void> {
    await fs.rm(this.attemptPath, { force: true });
  }
}

export function createFileRefreshCoordinator(
  provider: CredentialProvider,
  options?: FileRefreshCoordinatorOptions
): FileRefreshCoordinator {
  return new FileRefreshCoordinator(provider.getRefreshLockScope(), options);
}

export function createFileRefreshAttemptJournal(
  provider: CredentialProvider,
  options?: Pick<FileRefreshCoordinatorOptions, "rootDir">
): FileRefreshAttemptJournal {
  return new FileRefreshAttemptJournal(provider.getRefreshLockScope(), options);
}