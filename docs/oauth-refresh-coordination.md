# OAuth Refresh Coordination

QuickBooks refresh tokens rotate. Refreshing the same credential generation concurrently, or replaying a refresh after an ambiguous response, can lose the newest token. This document defines the coordination and recovery contract.

## Safety invariants

- Only one participant may refresh a credential generation at a time.
- Credentials are re-read after coordination is acquired.
- A refresh is skipped when another participant already advanced the generation.
- OAuth token requests are sent once and are never automatically replayed.
- Rotated credentials are persisted before an attempt is marked complete.
- Ambiguous attempts fail closed instead of retrying from possibly stale credentials.
- A committed QuickBooks mutation is never replayed as part of authentication recovery.

A credential fingerprint is SHA-256 over the access and refresh tokens. Fingerprints identify generations without storing token values in coordination files.

## Local stdio implementation

Local stdio processes running as the same OS user on one machine use `proper-lockfile` under:

```text
~/.qbo-mcp/refresh-locks/
```

The lock filename is a SHA-256 hash of a non-secret provider scope:

- Local file: canonical credential-file path
- Azure Key Vault: normalized vault URL and secret name
- AWS Secrets Manager: region and secret identifier

The default acquisition deadline is 60 seconds. Locks are considered stale after 120 seconds and are heartbeated while held. A live or slow owner is not stolen. An abandoned lock can be recovered after its stale interval; an earlier waiter may time out safely and can retry later.

The protected transaction is:

1. Acquire the provider-scoped lock.
2. Read the current credentials from the authoritative store.
3. Check the durable refresh-attempt journal.
4. Compare the current fingerprint with the generation that failed authentication.
5. Skip refresh if the generation already changed.
6. Write and flush a non-secret attempt record.
7. Call Intuit's token endpoint once.
8. Persist the returned credential snapshot.
9. Clear the attempt record.
10. Release the lock.

Local credential files use a private same-directory temporary file, flush it, and atomically rename it over the destination. AWS Secrets Manager and Azure Key Vault publish complete secret versions.

`qbo_authenticate` uses the same lock. Deliberate reauthentication replaces the credentials and then clears any unresolved attempt record, so it cannot race an automatic refresh.

## Ambiguous refresh recovery

The attempt journal contains only a version, credential fingerprint, and timestamp. It never contains access tokens, refresh tokens, client secrets, or company data.

After a process restart or ambiguous response:

- If stored credentials have a different fingerprint, persistence succeeded. The stale attempt record is cleared and the newer generation is used.
- If stored credentials still match the attempted generation, Intuit may have rotated the token without the result being persisted. Automatic refresh stops with `INDETERMINATE_CREDENTIAL_REFRESH`.
- If the journal is missing fields, malformed, or unreadable, refresh also fails closed.

Do not delete an unresolved attempt marker and retry the old refresh token. Reauthorize deliberately instead. In local credential mode, use `qbo_authenticate`. For AWS or Azure credential mode, complete the established administrative reauthorization workflow and replace the stored credential secret; the next local request will observe the new fingerprint and clear the marker.

The journal prevents silent replay, but no local protocol can make Intuit's remote rotation and a separate credential-store write one atomic transaction. Sudden hardware or filesystem failure remains an external boundary; ambiguous state is contained by stopping rather than guessing.

## Hosted HTTP today

Hosted HTTP currently uses process-local coordination and must run as exactly one process/replica with:

```text
MCP_SINGLE_REPLICA=true
```

For Lambda, reserved concurrency must enforce that limit. For containers, both process count and replica count must be one. Local filesystem locks are intentionally not used as a substitute for distributed coordination, and `proper-lockfile` is excluded from the Lambda bundle.

No distributed coordination backend is implemented today. Azure Key Vault and AWS Secrets Manager are credential stores, not refresh locks. The current release does not create an Azure Storage blob lease or a DynamoDB lease, and selecting Azure or AWS credential mode does not relax the single-replica requirement.

## Future distributed backend

The existing `RefreshCoordinator` and `RefreshAttemptJournal` boundaries allow a distributed implementation without changing accounting handlers or retry policy.

For Azure hosting, the preferred starting point is a private Azure Blob per hashed provider scope:

- Acquire a finite Blob lease with bounded retries.
- Renew the lease while refresh is active.
- Store the non-secret attempt record durably in shared storage under the lease.
- Re-read Key Vault credentials and compare their generation after lease acquisition.
- Call Intuit once, persist the returned credentials, clear the shared attempt record, and release the lease.
- Treat lease loss, renewal failure, ambiguous OAuth results, and uncertain persistence as fail-closed states.

A Blob lease by itself is insufficient. Before enabling multiple replicas, the implementation must address stale-holder writes with lease-loss checks and conditional or fenced credential persistence where the provider supports it. It must also stress-test lease expiry, process suspension, network partition, lost acknowledgements, and concurrent replica recovery. Until those tests and deployment controls pass, `MCP_SINGLE_REPLICA=true` remains mandatory.

An AWS deployment can implement the same interfaces with a conditional DynamoDB lease and shared attempt record. Backend selection should be explicit deployment configuration; it must never silently fall back from distributed coordination to process-local locking.

## Validation coverage

The repository tests cover:

- Same-scope serialization and unrelated-scope concurrency
- Bounded lock acquisition
- Sustained contention
- Independent Node process contention
- Operation failure and expired orphan recovery
- One refresh per credential generation
- Ambiguous refresh replay prevention
- Lost persistence acknowledgement recovery
- Both refresh-versus-reauthentication orderings
- Malformed journal fail-closed behavior
- Atomic local credential replacement
- Committed mutation non-replay

No test or coordinator validation requires configured QuickBooks, Azure, or AWS credentials.
