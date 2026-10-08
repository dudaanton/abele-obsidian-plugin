# External file durable state

## Scope

This is the state/projection foundation, not an enabled attachment store. It adds no UI,
filesystem effects, automatic eviction, scanner classification or lifecycle changes. Startup
recovery, activation markers and downgrade fences must be wired before any eviction caller is
introduced. IndexedDB remains schema version 1 here; the activation schema bump is separate.

The portable implementation lives in `plugin/src/sync/external/` and imports no Obsidian API.
The plugin repository carries only pinned core/protocol archives, not their source packages.
Consequently this work does not mutate the separate sync repository or repack unrelated source.
`SqliteExternalStateStore` is a reusable adapter for the existing CLI ledger schema; attaching
it to the CLI's open database is a subsequent integration step in that repository. It must use
that same connection, not a separately opened connection inside an outer CLI transaction.

## State and binding

`ExternalState.open` requires an explicitly durable port. The ordinary memory state store and
in-memory SQLite databases are refused as `unsupported-storage`; neither is a production
fallback. Opening requires a local ledger ID and a binding containing normalized endpoint,
vault, personal/scoped mode, principal ID/type, grant, connection generation and credential
association. Endpoint path prefixes remain significant. Another endpoint with the same vault
ID, another identity or a changed credential association cannot reuse the document. Credential
rotation must be validated and integrated explicitly, not inferred from matching vault IDs.

The schema-1 document separates device preference, representation, pin and availability from
selective-sync participation. It does not duplicate personal/scoped server heads. Each file has
its own revision, pending operation, physical projection path/digest, blocker, earlier proven
local base and retained artifact references. Hidden engine-owned staging paths can be recorded;
absolute paths, traversal and forbidden path characters cannot. Recording a path does not
prove an artifact is safe to delete.

A pending operation or retained bytes prevent replacing/erasing the previous proven local base.
Advancing ordinary server metadata never upgrades unexpected local bytes to an edit against the
new head. Tombstones, detach and unavailable states are distinct and do not remove dependencies.

## Durable phases

The host stores one JSON document under `plugin:external-files` in the existing IndexedDB
`meta` store, or `daemon:external-files` in the existing SQLite `meta` table. Operations include
kind, phase, revision, generation, expected file/version/path/SHA/size, source/target paths,
previous representation/base, desired representation/availability, projection digest,
artifact ownership and unresolved/cleanup reasons. Each kind has a bounded set of valid phases.
Reusing an operation ID with changed immutable parameters is rejected. There is no journal
purge or cleanup API in this foundation.

`ExternalState.commit` accepts **data**, not an executable transaction callback. It compares
file/operation revisions and submits a document-level CAS to the host. The host rechecks that
CAS inside its actual database transaction. Existing ledger entries, personal cursor and
scoped metadata/checkpoint can land in that same commit. The existing scoped metadata remains
the only scoped head authority.

IndexedDB phase commits do not join the ordinary engine's in-memory transaction overlay. They
reject an active or queued outer transaction, including a call before its body begins. Ordinary
transactions cannot start during a phase commit. Existing independent publication provenance
observers settle before the data-only transaction begins; their refusal leaves both the ledger
and external phase unchanged. A phase write is not retried by the WebKit reconnect wrapper.

SQLite uses `BEGIN IMMEDIATE` and the existing ledger tables. Both SQLite hosts' transaction
status flags are supported. An existing outer transaction is explicitly refused; there is no
nesting-depth shortcut or savepoint masquerading as a durable commit.

The receipt `{status: "committed", revision}` is returned only after IndexedDB `oncomplete` or
SQLite `COMMIT` acknowledgement, not request success or transaction-body return. Abort means
no receipt and atomic rollback. A missing/unknown acknowledgement stops further phase commits
in that facade/adapter. Reopen the actual database and inspect its committed journal before
recovery decides what to do. A receipt records persistence only; it is **not** permission to
perform a filesystem action without the later ownership, verification and recovery gates.

No network or filesystem action runs inside a phase transaction. Application-restart recovery
is tested; arbitrary power-loss survival and mobile adapter flush guarantees are not claimed.

## Projection format and holds

`projection.ts` separates marker recognition, strict schema validation, placement and local
ownership. Schema 1 is UTF-8 JSON, at most 16 KiB, with `format: "abele.external"`, vault/file
identity, logical path, observed version, SHA-256, size, MIME, mtime and optional width/height/
duration. Unknown MIME falls back to `application/octet-stream`. Extra fields (including
credentials, URLs, preferences and recovery paths) are rejected.

Wire paths normalize to NFC; physical spelling remains separate. The original and extra
`.abele-ref` filename are validated before choosing the sidecar destination. Case/Unicode
collisions and excessive wire or physical byte lengths block the operation; no alternative
sidecar name or original rename is invented.

A recognizable projection moved to another extension stays held. Foreign/unowned markers are
held, never adopted into an account. Malformed/oversized markers are held, even when their
marker appears after the size limit. A known projection path stays protected after its JSON or
marker is destroyed. Changed bytes require a hold. An unrelated `.abele-ref` remains ordinary.
These are pure inspection results; scanner/watcher wiring comes later.

## Tests and boundaries

`plugin/tests/integration/externalState.test.ts` uses fake-indexeddb's actual transactions and
on-disk SQLite (`node:sqlite`), not memory-store transaction substitutes. It covers reopening,
CAS races across independent connections, definite aborts with ledger rollback, lost commit
acknowledgements, nested/queued transaction rejection, existing provenance refusals, scoped
checkpoint coupling, durable-only storage and connection separation. Projection tests are in
`plugin/tests/unit/externalProjection.test.ts`.

The earlier filesystem probe still demonstrates unconditional deletion races and unsafe iOS
copy. Its strict-eviction blocker has been superseded by the explicit manual-eviction contract:
server verification, local coordination and a final hash precede removal, with the outside-
writer interval accepted. The selected mobile hydration contract uses staging, a final absent-
target check and adapter rename, never copy; its final outside-writer interval is also accepted.
Desktop/CLI retain native create-if-absent installation. None of those filesystem paths is
implemented or enabled by this state work, and the copy-overwrite regression is unchanged.
