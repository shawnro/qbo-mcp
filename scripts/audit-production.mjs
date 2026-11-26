import { spawnSync } from "node:child_process";
import { evaluateAudit } from "./audit-policy.mjs";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check using npm run audit:production");

const result = spawnSync(process.execPath, [npmCli, "audit", "--omit=dev", "--json"], {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});
if (result.error) throw result.error;
if (result.status !== 0 && result.status !== 1) {
  throw new Error(`npm audit failed with exit status ${result.status}: ${result.stderr}`);
}

const report = JSON.parse(result.stdout);
const { blocked, excepted } = evaluateAudit(report);
if (excepted.length) {
  console.warn(
    "Production audit: approved dependency policy exception applies. " +
    "See docs/dependency-overrides.md.",
  );
}
if (blocked.length) {
  console.error(`Unapproved high/critical advisories: ${blocked.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("Production audit: no unapproved high/critical advisories.");
}
