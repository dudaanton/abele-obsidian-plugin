# Token client integration

`src/sync/v2/contract.ts` is a local copy of the frozen protocol source at
`2c5346f`, with imports redirected to portable local file-operation schemas and
the retained URL helpers. `fileSchemas.ts` copies only retained file operations,
results and their primitives. Both use the plugin's Zod dependency. The pinned
server/core archives are unchanged.

The non-UI client validates base64 UTF-8 tokens, resolves authority before writing
device credentials, and calls connection, token management, manifest, changes
and commit endpoints. It does not send credentials in query strings or follow
redirects. Errors contain recognized codes, never response text or transport
details. A 401 means the key is refused; the wire cannot distinguish revocation
from a disabled user or an unknown key. Scope paths are display hints; stable
selector IDs must match the server's authority.

The adapter provides separate content, scope-departure and deletion delivery
ports. A departure asks whether another connection covers the file before the
host removes this connection's baseline. It is never converted to a global
delete. Revocation and unavailable scopes are connection statuses, not departure
events. File placement and baseline updates must remain inside the retained
coordinator; all network work precedes those leases.

Commit preparation and receipts use the connection's local journal. An uncertain
request is replayed with the exact operations and request ID. An accepted receipt
is persisted before follow-up content or settlement; a failure there does not
turn acceptance into refusal. Settlement must be idempotent and run on the
retained engine's exclusive scheduler. Immutable staged upload bytes must remain
available until settlement finishes. The adapter does not capture those bytes
itself. Held operations are filtered before the budget; callers must supply the
complete scan or continue paging past held operations, rather than truncate first.

## Dependencies still blocking production integration

The frozen contract defines no upload/content request or response schemas,
multipart/range rules, content version query, or upload authorization fields.
Inventing these would create a different contract. The pinned engine still
requires a legacy `VaultClient.state()`, SHA-addressed blob calls, and legacy feed
events. It has no directory or scoped-removal event boundary. The adapter is
therefore not wired into the production engine, and normal token sync remains
disabled. No legacy adapter was replaced or deleted in this increment.

The two-token runtime regression exercises the real registry, connection engine
collection, client and coordinator with synthetic runtime ports. It does not
prove that two production file engines sync. The actual production-engine probe
and missing upload/content client guarantee remain `it.fails` with `BUG:` notes.
No test or documentation treats these dependencies as completed acceptance.

The frozen protocol document calls descendant revocation unresolved. The binding
model specifies that revoking a token leaves its descendants valid; direct
revocation already agrees with that decision, but the contract prose needs updating.
