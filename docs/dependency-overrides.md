# Dependency Overrides

## node-quickbooks

`node-quickbooks` pins legacy versions of `underscore` and permits old versions of
`fast-xml-parser` and `uuid`. The scoped overrides in `package.json` keep those
dependencies on patched releases without affecting other dependency trees.

The compatibility contract is covered by
`src/client/__tests__/node-quickbooks-dependencies.test.ts`: CommonJS loading,
UUID v1 request IDs, query construction, Underscore helpers, and representative
QuickBooks XML parsing.

Review these overrides whenever `node-quickbooks` changes and at least every six
months. Remove each override once the upstream package declares an equivalent or
newer patched dependency and the contract tests pass without it.

## Audit policy

The production audit gate includes a temporary, narrowly scoped exception.
Review `scripts/audit-policy.mjs` and the OAuth compatibility tests when
updating dependencies; changes to the affected dependency chain or the
availability of a fix require revisiting the exception.
