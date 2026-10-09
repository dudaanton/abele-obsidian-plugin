# Token client integration

`src/sync/v2/contract.ts` is a local copy of the frozen protocol source at
`10e8f23`, with imports redirected to portable local file-operation schemas and
the retained URL helpers. `fileSchemas.ts` copies only retained file operations,
results and their primitives. Both use the plugin's Zod dependency. The pinned
server/core archives are unchanged. `uploadSchemas.ts` copies the retained upload
begin schemas; the `{sha,size}` receipt follows the documented v2 upload routes.

The non-UI client validates base64 UTF-8 tokens, resolves authority before writing
device credentials, and calls connection, token management, manifest, changes
and commit endpoints, plus simple/multipart uploads and file-identity content.
It does not send credentials in query strings or follow
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

The pinned engine still requires a legacy `VaultClient.state()`, SHA-addressed
blob calls, and legacy feed events. It has no directory or scoped-removal event boundary. The adapter is
therefore not wired into the production engine, and normal token sync remains
disabled. No legacy adapter was replaced or deleted in this increment.

The two-token runtime regression exercises the real registry, connection engine
collection, client and coordinator with synthetic runtime ports. It does not
prove that two production file engines sync. The actual production-engine probe
remains `it.fails` with `BUG: DEPENDS: core v2 binding`.
No test or documentation treats these dependencies as completed acceptance.

## Upload and content client boundary

`putContent(sha, bytes, options)` copies and verifies immutable bytes before
transmission. It always sends actual bytes, including repeated digests; no HEAD
or hash-only shortcut authorizes an upload. Above the configured simple-upload
threshold it uses begin/part/complete and skips only server-confirmed received
parts. Completion is never sent after a failed part. Begin plans and final
digest/size receipts are checked. Callers may retain the upload identity and use
`beginUpload`, `uploadPart`, and `completeUpload` directly for durable continuation;
the convenience method itself does not persist upload identities across reload.

`content(fileId, {versionId, range, signal})` reads authorized file/version bytes.
`headContent` returns actual size and range capability. Partial responses must
match the requested bounds and actual byte count; ignored ranges and truncated
responses fail. The retained engine must verify full downloads against its
manifest/receipt digest before placement and use exact versions for multipart
downloads. It must also drain genuine final folder-delete events before stopping
on `scope_unavailable`; deleted group roots and revoked tokens imply no deletes.

Tests use synthetic fetch fixtures against the documented routes and response
shapes, not a live server or desktop/mobile evidence. Core binding, WebSocket
runtime integration, durable upload recovery and host placement remain subsequent
integration work. No second engine is introduced.
