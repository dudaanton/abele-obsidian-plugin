# External file durable state

## Scope

This is the state/projection foundation and its initial plugin recovery/lifecycle gates, not
an enabled attachment store. It adds no UI, automatic eviction or ordinary scanner
classification. Minimal filesystem ports are now implemented separately (see
`External file filesystem ports.md`), without a production caller. Existing interrupted-installation recovery now
runs before engine activation under a runtime fence. IndexedDB uses schema version 2; the
explicit activation marker is outside that deletable database. Nonempty external inventories
remain connection-wide holds until classification and attachment recovery are integrated.

The canonical portable implementation now lives in the pinned core package's `external/`
modules. The plugin's `records.ts`, `state.ts` and `SqliteExternalStateStore.ts` are compatibility
re-exports, not independent prototypes. Facade, schemas, revision/binding checks, transaction
helpers and error class come from the same canonical input; IndexedDB implements that core
port directly. Mixing error prototypes would turn definite aborts into unknown outcomes.
Core's SQLite adapter is delegated by the CLI's own already-open ledger connection in the
selected source revision. No second connection or duplicated scoped head authority is used.
The plugin did not edit the separate sync repository; it exported committed core/protocol
source at the explicit pin using the normal vendor procedure.

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
checkpoint coupling, durable-only storage and connection separation. These emulator reopen
checks prove transaction/reconnection behavior, not renderer-restart persistence by themselves.
`plugin/tests/e2e/externalStateRestart.e2e.test.ts` additionally commits a phase through the real
IndexedDB adapter, closes only the selected vault window, opens it again through the vault URI,
and reads the same database-instance identity, revision and phase from the new renderer. It
checks that the old window/webContents are gone, the in-memory witness vanished, the main app
process stayed running, and other windows stayed open. No whole-app restart or alternate
persistence backup is used. The production-only bundle exposes no test API for this.
Projection tests are in `plugin/tests/unit/externalProjection.test.ts`.

JSON marker recognition decodes escaped string tokens even when JSON is oversized or damaged;
ambiguous markers can only establish holds. Projection placement checks physical UTF-8 lengths
before NFC comparison. The canonical input
`19d35b116a4ac6c062b50154b2fd33626e2ef012` now rejects raw physical path/component byte
lengths above 1024/255, including the 284-byte decomposed filename. The unchanged schema-
rejection assertion passes as a normal regression test; only its previous `BUG:` label was
removed. The plugin continues to use core's canonical schema, not a local fork or archive
patch.
All existing plugin tests remain in place, including SQLite port tests; no test was moved or
deleted during the canonical adoption.

The earlier filesystem probe still demonstrates unconditional deletion races and unsafe iOS
copy. Its strict-eviction blocker has been superseded by the explicit manual-eviction contract:
server verification, local coordination and a final hash precede removal, with the outside-
writer interval accepted. The selected mobile hydration contract uses staging, a final absent-
target check and adapter rename, never copy; its final outside-writer interval is also accepted.
Desktop/CLI retain native create-if-absent installation. The plugin's minimal ports now
implement staging, guarded installation and final-check original removal separately; the
complete attachment state machine is not enabled. The copy-overwrite regression is unchanged.

## Plugin startup and runtime fence

`external/pluginSafety.ts` inspects migration/switch evidence and the actual durable external
record before the personal engine constructor or scoped runtime can become active. Missing,
foreign or malformed state, recognizable orphan projections, and nonempty external inventories
establish a connection hold. Pending downloads, tombstones, detach and unavailable records are
not exceptions. Nothing is inferred from equal file bytes.

Personal engine construction is deliberately deferred: the pinned core still calls
`recordScope()` from its constructor, but the plugin never constructs it before this barrier.
The plugin inspects publication and installation journals, runs the existing safe installation
recovery, then permits ordinary scope changes, watchers, rescan, deferred apply/keep, delete
choices and publication replay. A corrupt publication journal stops construction. The exposed
history/trash client is also fenced, so a retained Restore client cannot bypass recovery or
outlive its connection. Scoped startup and native creation use the same ownership discipline.

`RuntimeFence` claims a vault-local nonce under `abele-sync-runtime-owner-v1:<database-name>`.
Every effect checks the current claim, durable connection/ledger descriptor, credential and
connection generation. Teardown revokes the lifetime synchronously, including a build waiting
on recovery. Guards run at actual IndexedDB transaction creation/overlay flush, filesystem
adapter invocation, native mutation inside its save queue, and each HTTP request (including
later multipart upload requests), not just at the start of a long public verb. Receipts from a
retired runtime cannot authorize further work.

Already-issued operations cannot necessarily be cancelled. Cooperating successor runtimes
wait for tracked predecessor effects, then inspect their durable installation/publication
journals before touching paths. This coordinates plugin runtimes; it is not an exclusion
mechanism for independent filesystem writers. Application restart still requires conservative
journal inspection rather than matching-content replay.

Projection discovery follows bounded content through the vault index and adapter listing,
including renamed extensions. It stats each path first and never reads files above the 16 KiB
projection cap. A host prefix reader or desktop native bounded read is used when available;
otherwise only size-bounded candidates use the portable adapter read. Marker decoding is
also capped, not a second whole-file allocation. Known external records/markers protect
damaged paths independently of this candidate search. An ordinary note quoting a format
example is not itself a projection.

`abele-sync-external-inspection-v1` persists path/size/mtime/marker observations in vault-local
storage. Matching unchanged files need no content read on the next build. Missing/corrupt
cache is re-inspected, not accepted as authority. Read errors are still refusals unless a
follow-up stat confirms the candidate vanished; absence is not projection evidence. A
successful Disconnect settles the runtime and performs one inventory, sharing that snapshot
with its before/after revoke checks while rechecking connection identity and activation flags.
A 3,000-file regression records cold/warm timing and verifies 3,000 cold reads, zero unchanged
warm reads, and one read after one file changes.
The reserved unsynced `.abele-sync-ignore` control file is validated at startup, not in the
credential-retirement inventory. Thus its existing locked-file startup/error/retry exit is
preserved, while startup still refuses recognizable projection evidence there before bootstrap.

## Activation migration and downgrade boundary

The version-1-to-2 IndexedDB upgrade preserves the existing stores, entries, metadata and
journals. Opening an upgraded database at version 1 produces `VersionError`, before the old
normal sync startup can scan. This applies to generic ledger stores opened by the new client,
not only after an eviction has happened.

The trusted `activateExternalFiles` port is reserved for the later explicit eviction API; no
production caller invokes it automatically. It requires the durable schema fence, records a
`preparing` activation marker, initializes/validates the bound external document, then records
`active`. The marker at `abele-sync-external-activation-v1` contains the owned database name,
ledger identity, database-instance UUID and connection binding, not credentials or file URLs.
An interrupted preparing phase can initialize/resume only in that exact database instance,
which never received active deletion permission. Missing active journals, changed instance
identity or binding, and retained `abele-sync-external-connection-switch-v1` evidence are holds.

Migration inspection opens only explicit vault-owned database names, read-only, without
upgrading, manufacturing an identity or retaining a newly allocated empty database. A lost
activated ledger therefore cannot use an enrollment/bootstrap grant to recreate empty state.
The separate generation record at `abele-sync-external-generation-v1` associates the canonical
binding with its generation; credential association includes a fingerprint, never the token.

**Unsupported old direct-deletion boundary:** an old Forget/Leave can still call
`indexedDB.deleteDatabase` without opening version 1. No schema bump can prevent it. The test
suite demonstrates that deletion separately from old normal startup rejection; the surviving
activation marker makes the new client refuse bootstrap afterwards. Restore the exact bound
ledger/recovery evidence rather than treating old direct deletion as a supported reset.

## Initial shared lifecycle inventory

Enrollment/re-enrollment, connection import, service-level identity replacement, Disconnect,
Forget, scoped Leave, waiting credential retirement and delayed database/publication retirement
check the same read-only safety inventory before revocation, credential/descriptor overwrite or
database deletion. It includes current, proof/bootstrap and deferred-cleanup ledger identities,
scoped/pending-join databases, external records/operations/projections and existing installation
or retained-copy journals. Corrupt or unavailable evidence is not permission to retire it.
Inspection never enumerates the application-wide database namespace.

Refusals use the existing error handlers/status paths, not a new screen. Connections, tokens,
ledgers and retained evidence remain. Automatic work can stop while recovery is required.
Scoped Leave still has a bounded self-revocation wait and preserves ordinary local files when
the inventory is clear, including after access removal. A stale scoped host cannot use Leave
to revoke or erase its successor; delayed enrollment responses cannot install credentials into
a retired host either. Queued Leave rechecks the exact original claim inside its callback;
its departure fence borrows that claim without replacing it. A refused departure releases
only the borrowed fence, so the runtime and repeated Leave/start stay usable. Cold Leave
cannot overwrite another host's claim. Already-issued server requests may have completed
and are not claimed to have been cancelled retroactively.

"Forget without telling the server" now awaits the same complete inventory before deleting
a pending token, including orphan/moved projections without activation markers. Its existing
confirmation handler awaits the operation and reports refusal through the existing notice
mechanism. No new screen or force bypass is introduced.

All `VaultWriter` paths use the guarded adapter, including staged writes, mobile swap/restore
and journal cleanup. Script provenance activation follows installation recovery and checks
the claim before descriptor/sentinel writes and database initialization; it cannot overwrite
a successor's descriptor after an awaited sentinel lookup.

**Conservative initial policy:** every nonempty external document and every activation marker
requires recovery/disconnect preparation. Even hydrated policy records and terminal operations
are retained rather than guessed safe to discard. This is intentionally not the completed
materialization API or credential-switch workflow. A later preparation implementation must
prove/recheck an empty dependency inventory and persist readiness before relaxing these holds.
No force option is introduced to bypass them.

## CLI/daemon and core handoff

The separate sync repository was not modified. The following changes are required there;
plugin-side passing tests do not establish completion of these CLI requirements:

1. **Core startup (`packages/core/src/engine.ts`, `engineTypes.ts`, scope/staging helpers):**
   replace eager constructor scope effects with explicit recovery readiness, shared by start,
   sync/rescan, delete decisions, deferred apply/keep, Restore and publication replay. The
   plugin currently avoids the eager constructor by constructing only after recovery; other
   hosts must not instantiate that old core before their barrier. Preserve scoped checkpoint
   and head authority in `scopedState.ts`, not another external head table.
2. **Existing SQLite ledger (`packages/cli/src/sqliteState.ts`):** canonical phase adapter
   delegation on the same already-open connection is implemented in the selected core/CLI
   revision. Remaining host integration must expose durable instance identity and effect
   guards, reject nesting in uncommitted outer transactions, and inspect committed phases
   after reopening. Keep ledger/head/checkpoint changes atomic with external phases;
   do not substitute memory or a separately opened connection to simulate nesting safety.
3. **Daemon composition (`packages/cli/src/vault.ts`, `commands/run.ts`, `lock.ts`,
   `lockMutation.ts`, `nodeFs.ts`, `nodeFsGuard.ts`):** take/validate the existing vault lock
   before migration, descriptor and journal inspection; establish safe recovery or holds before
   constructing/starting an engine. Recheck lock ownership, binding and generation after long
   awaits at each filesystem, state, HTTP and cleanup effect. Settle recorded already-issued
   outcomes before a successor touches their paths. CLI installation keeps native no-clobber
   `link`; this task does not change hydration or the accepted outside-writer deletion race.
4. **Downgrade fence (`packages/cli/src/config.ts`):** introduce a recoverable versioned local
   config/descriptor and an activation marker outside the deletable SQLite ledger. The pinned
   old `readConfig` ignores unknown fields, so merely adding `schema: 2` does **not** reject old
   normal startup. Use a versioned envelope whose required old top-level connection fields are
   absent (for example, a nested `connection`), and test the actual old reader/binary rejecting
   it. New readers may migrate legitimate legacy state only before activation, never bootstrap
   over marker/projection evidence. A database `user_version` alone is also insufficient if
   the old binary never checks it.
5. **Destructive commands (`commands/disconnect.ts`, `commands/init.ts`, agent/scoped
   maintenance and retirement paths):** run the shared inventory under the lock before any
   revoke, config/token replacement, forced database removal or recovery-directory cleanup.
   `disconnect --force` and `init --force` must not discard unresolved dependencies. Include
   tombstones, lost access, conflicts, pending operations and retained/staging bytes; no scoped
   credential path may fall back to a personal account.
6. **Required CLI tests:** real on-disk SQLite close/reopen and phase/abort/unknown-ack tests;
   lock loss during awaits; every command/replay before recovery; missing database with marker
   or renamed projections; refused offline/no-space/approval/access retirement preserving
   config/token/data; old normal startup rejection; and a separate demonstration that old
   direct force-init/deletion still bypasses a database/config-open fence. Document that last
   unsupported boundary, not a fictitious guarantee against an old binary deleting files.

The complete preparation/materialization API and bounded old/target credential-switch phases
remain the subsequent lifecycle task, in both hosts. Vendor their committed core/protocol
inputs explicitly when that handoff is implemented; do not replace the current plugin archive
with a mutable server checkout.
