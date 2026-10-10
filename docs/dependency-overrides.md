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

## intuit-oauth query parsing

`intuit-oauth@4.2.5` is the latest release and depends on CommonJS
`query-string@6`, which in turn depends on vulnerable `decode-uri-component@0.2`.
The patched decoder and current query-string releases are ESM-only, so forcing
either through an npm override would break `intuit-oauth`'s `require()` calls.

The advisory is a denial of service from malformed percent-encoded input during
query parsing. Hosted OAuth uses the platform `URLSearchParams` implementation,
not this dependency. Local authentication accepts the code and realm as separate
tool arguments and percent-encodes both before constructing the URL parsed by
`intuit-oauth`, so malformed percent sequences cannot reach the vulnerable
decoder through supported flows. Retain the URL compatibility tests in
`src/credentials/__tests__/oauth-client.test.ts` and re-evaluate this residual
when `intuit-oauth` publishes a compatible dependency update. Do not claim a
zero-advisory install while this upstream chain remains.
