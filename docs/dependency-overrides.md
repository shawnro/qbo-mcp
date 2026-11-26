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
The patched decoder and current query-string releases are ESM-only. Node 24 can
load synchronous ESM from CommonJS, but `query-string@9.5.1` exposes its API
under a default export: overriding Intuit's dependency with it breaks Intuit's
`queryString.stringify()` call. Do not force this incompatible override.

The advisories are denial-of-service risks involving malformed percent-encoded
input: GHSA-vcc3-ghjq-m6fr and GHSA-qr28-fpjm-wq7f. Hosted OAuth uses the
platform `URLSearchParams` implementation, not this dependency. Local
authentication percent-encodes the separately supplied code and realm before
constructing the URL parsed by `intuit-oauth`. This reduces exposure but does
not remove the vulnerable dependency or establish that every caller is safe.

The production audit gate reports an explicit temporary exception for exactly
those two advisories in the Intuit dependency chain. It rejects new high or
critical advisories, other affected installation paths, changed dependency
chains, and an available fix. Retain the actual OAuth parsing compatibility
test in `src/credentials/__tests__/oauth-client.test.ts` and remove the exception
when a compatible upstream fix is available. `npm audit` itself still reports
the residual high-severity chain.
