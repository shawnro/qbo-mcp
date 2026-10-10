import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { FileRefreshCoordinator } from "./file-refresh-coordinator.js";

const roots: string[] = [];
const workerPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "refresh-lock-worker.cjs"
);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), "qbo-refresh-process-test-"));
  roots.push(root);
  return root;
}

function runWorker(rootDir: string, counterPath: string, scope: string, iterations: number) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [workerPath, rootDir, counterPath, scope, String(iterations)],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Refresh lock worker exited ${code}: ${stderr}`));
    });
  });
}

describe("FileRefreshCoordinator process isolation", () => {
  it("preserves every update across independent Node processes", async () => {
    const rootDir = await temporaryRoot();
    const counterPath = join(rootDir, "counter.txt");
    const scope = "test:process-shared-grant";
    const childCount = 4;
    const iterations = 15;
    await fs.writeFile(counterPath, "0");

    const children = Array.from(
      { length: childCount },
      () => runWorker(rootDir, counterPath, scope, iterations)
    );
    const coordinator = new FileRefreshCoordinator(scope, {
      rootDir,
      waitTimeoutMs: 10_000,
      staleAfterMs: 10_000,
      pollIntervalMs: 5,
    });
    for (let index = 0; index < iterations; index++) {
      await coordinator.run(async () => {
        const current = Number(await fs.readFile(counterPath, "utf8"));
        await new Promise((resolve) => setTimeout(resolve, 1));
        await fs.writeFile(counterPath, String(current + 1));
      });
    }
    await Promise.all(children);

    expect(Number(await fs.readFile(counterPath, "utf8"))).toBe(
      (childCount + 1) * iterations
    );
  }, 15_000);
});