import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

if (packageJson.private !== true) {
  throw new Error("package.json must set private to true");
}

const npmExecutable = process.env.npm_execpath
  ? process.execPath
  : process.platform === "win32"
    ? "npm.cmd"
    : "npm";
const npmArguments = process.env.npm_execpath
  ? [process.env.npm_execpath, "pack", "--dry-run", "--json", "--ignore-scripts"]
  : ["pack", "--dry-run", "--json", "--ignore-scripts"];

const output = execFileSync(npmExecutable, npmArguments, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const packages = JSON.parse(output);

if (!Array.isArray(packages) || packages.length !== 1) {
  throw new Error("Expected one distribution artifact");
}

const artifact = packages[0];
const paths = new Set(artifact.files.map((file) => file.path));
const requiredPaths = ["dist/index.js", "dist/index.d.ts"];
const missingPaths = requiredPaths.filter((path) => !paths.has(path));

if (missingPaths.length > 0) {
  throw new Error(`Artifact is missing required files: ${missingPaths.join(", ")}`);
}

const testArtifactPattern =
  /(^|\/)(__tests__|__mocks__)(\/|$)|\.test\.(js|d\.ts)(\.map)?$/;
const testArtifacts = [...paths].filter((path) => testArtifactPattern.test(path));

if (testArtifacts.length > 0) {
  throw new Error(
    `Artifact contains test-only files:\n${testArtifacts.join("\n")}`
  );
}

console.log(
  `Validated private artifact ${artifact.name}@${artifact.version}: ` +
    `${artifact.entryCount} files, ${artifact.size} packed bytes`
);