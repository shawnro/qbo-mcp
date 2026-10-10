const { createHash } = require("node:crypto");
const { promises: fs } = require("node:fs");
const { join } = require("node:path");
const { lock } = require("proper-lockfile");

const [rootDir, counterPath, scope, iterationsText] = process.argv.slice(2);
const lockName = createHash("sha256").update(scope).digest("hex");
const lockTarget = join(rootDir, lockName);
const iterations = Number(iterationsText);

async function main() {
  for (let index = 0; index < iterations; index++) {
    const release = await lock(lockTarget, {
      realpath: false,
      stale: 10_000,
      update: Math.floor(10_000 / 3),
      retries: {
        retries: 2_000,
        factor: 1,
        minTimeout: 5,
        maxTimeout: 5,
        randomize: false,
      },
    });
    try {
      const current = Number(await fs.readFile(counterPath, "utf8"));
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 4)));
      await fs.writeFile(counterPath, String(current + 1));
    } finally {
      await release();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});