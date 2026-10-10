import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FileRefreshCoordinator,
  RefreshLockTimeoutError,
} from "./file-refresh-coordinator.js";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), "qbo-refresh-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("FileRefreshCoordinator", () => {
  it("serializes coordinators with the same scope", async () => {
    const rootDir = await temporaryRoot();
    const first = new FileRefreshCoordinator("grant-a", { rootDir, pollIntervalMs: 5 });
    const second = new FileRefreshCoordinator("grant-a", { rootDir, pollIntervalMs: 5 });
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const active = first.run(async () => {
      order.push("first-start");
      await gate;
      order.push("first-end");
    });
    await vi.waitFor(() => expect(order).toEqual(["first-start"]));
    const waiting = second.run(async () => { order.push("second"); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["first-start"]);

    release();
    await Promise.all([active, waiting]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("bounds the time spent waiting for a live owner", async () => {
    const rootDir = await temporaryRoot();
    const active = new FileRefreshCoordinator("grant-a", { rootDir, pollIntervalMs: 5 });
    const waiting = new FileRefreshCoordinator("grant-a", {
      rootDir,
      waitTimeoutMs: 20,
      staleAfterMs: 2_000,
      pollIntervalMs: 5,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let holderStarted = false;
    const held = active.run(async () => {
      holderStarted = true;
      await gate;
    });
    await vi.waitFor(() => expect(holderStarted).toBe(true));

    await expect(waiting.run(async () => undefined)).rejects.toEqual(
      new RefreshLockTimeoutError(20)
    );
    release();
    await held;
  });

  it("does not serialize unrelated scopes", async () => {
    const rootDir = await temporaryRoot();
    const first = new FileRefreshCoordinator("grant-a", { rootDir });
    const second = new FileRefreshCoordinator("grant-b", { rootDir });
    let secondRan = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const held = first.run(() => gate);

    await second.run(async () => { secondRan = true; });
    expect(secondRan).toBe(true);
    release();
    await held;
  });

  it("preserves mutual exclusion under sustained same-scope contention", async () => {
    const rootDir = await temporaryRoot();
    let activeCount = 0;
    let maximumActive = 0;
    let completed = 0;
    const contenders = Array.from({ length: 50 }, () => (
      new FileRefreshCoordinator("grant-a", { rootDir, pollIntervalMs: 1 }).run(async () => {
        activeCount += 1;
        maximumActive = Math.max(maximumActive, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 1));
        completed += 1;
        activeCount -= 1;
      })
    ));

    await Promise.all(contenders);
    expect(completed).toBe(50);
    expect(maximumActive).toBe(1);
  });

  it("releases the lock when the protected operation throws", async () => {
    const rootDir = await temporaryRoot();
    const first = new FileRefreshCoordinator("grant-a", { rootDir });
    const second = new FileRefreshCoordinator("grant-a", { rootDir });

    await expect(first.run(async () => {
      throw new Error("synthetic refresh failure");
    })).rejects.toThrow("synthetic refresh failure");

    let recovered = false;
    await second.run(async () => { recovered = true; });
    expect(recovered).toBe(true);
  });

  it("recovers an expired orphaned package lock", async () => {
    const rootDir = await temporaryRoot();
    const lockName = createHash("sha256").update("grant-a").digest("hex");
    const lockPath = join(rootDir, `${lockName}.lock`);
    await fs.mkdir(lockPath);
    await fs.utimes(lockPath, new Date(0), new Date(0));
    const coordinator = new FileRefreshCoordinator("grant-a", {
      rootDir,
      waitTimeoutMs: 100,
      staleAfterMs: 2_000,
      pollIntervalMs: 5,
    });

    let recovered = false;
    await coordinator.run(async () => { recovered = true; });
    expect(recovered).toBe(true);
  });
});