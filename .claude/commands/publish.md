Publish a new version of qbo-mcp to npm and the MCP Registry.

## Arguments

$ARGUMENTS should be the version bump type: `patch`, `minor`, or `major`.
If no argument is provided, ask the user which bump type they want (patch, minor, or major) before proceeding.

## Steps

### 1. Pre-flight checks

- Verify the working directory is clean (`git status` shows no uncommitted changes). If there are uncommitted changes, stop and ask the user to commit or stash them first.
- Verify you are on the `master` branch. Warn if not.
- Verify `npm whoami` succeeds (user is logged into npm).

### 2. Version bump

- Read the current version from `package.json`.
- Compute the new version based on the bump type argument (patch/minor/major) using semver rules.
- Update the `version` field in `package.json`.
- Update both the top-level `version` and `packages[0].version` fields in `server.json` to match.
- Show the user: "Bumping version: {old} -> {new}" and confirm before proceeding.

### 3. Build verification

- Run `npm run build` and verify it completes without errors.
- If the build fails, stop and show the errors. Do not proceed with publishing.

### 4. Publish to npm

npm publish requires passkey authentication via browser. Do NOT run `npm publish` directly — it will fail waiting for interactive auth.

Instead:
- Tell the user to run `npm publish` themselves in their terminal.
- Wait for the user to confirm it succeeded before continuing.

### 5. Commit and tag

Only proceed after the user confirms npm publish succeeded.

- Stage `package.json`, `package-lock.json`, and `server.json`.
- Commit with message: `v{new_version}`
- Create a git tag: `v{new_version}`

### 6. Push to GitHub

- Run `git push && git push --tags`.

### 7. Publish to MCP Registry

- Run `mcp-publisher publish` from the repo root.
- If it fails with a 401/expired token, tell the user to re-authenticate and publish manually:
  ```
  mcp-publisher login github
  mcp-publisher publish
  ```
- Wait for the user to confirm before continuing.

### 8. Summary

Print a summary:
```
Published qbo-mcp v{new_version}
  npm: https://www.npmjs.com/package/qbo-mcp
  MCP Registry: https://registry.modelcontextprotocol.io/
  GitHub: https://github.com/shawnro/qbo-mcp
```
