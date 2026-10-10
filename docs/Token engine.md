# Token engine integration

The production plugin pins core and protocol to server commit
`664759f8ab307c74804868bbe5bb8e3e3182d0e0`. The vendor script generated
the archives and provenance; package.json, package-lock.json and SERVER_TEST_COMMIT
use the same input. No server source is changed.

`TokenEngines` opens an independent IndexedDB ledger and runtime fence for each
device-local registry record. Its UI bindings start, sync, pause and disconnect
that connection. Shutdown drains core before closing ledger/review stores.
`TokenEngineRuntime` configures the retained SyncEngine with V2EngineClient;
it does not implement a second exchange engine or fall back to personal/scoped APIs.
The status bar and commands aggregate these connections.

Every engine uses the shared path coordinator and immutable per-destination edit
copies. The existing build transform also wraps core v2 directory placement and
left-scope effects. Downloads happen before placement leases. Empty directories
have device-local identities; native rename events update those identities, and
removal is nonrecursive. A ledger identity and separately stored local proof prevent
a lost ledger from silently becoming a new connection state.

Incoming executable manifest/change items are downloaded and durably staged before
the core feed advances. New content, changes, moves, removals and deletes require
exact-candidate approval. Approval uses captured bytes and original mtime through
core placement, without another server download; a later candidate stays pending.
Ordinary items remain available to core. Non-root connections exclude .obsidian.
Reviewed directory effects use core directory placement with an in-memory candidate
response, without starting an additional engine.

Groups fail closed as scope_updating in the pinned contract. Group runtime acceptance
remains it.fails with DEPENDS: groups. Group note identity/link resolution and
attachment publication cannot be enabled until that binding exists; arrival and
background processing never grant private-file consent. The existing consent and
review ports/storage remain independently tested. Deleted-file history is not served
by v2 yet, so its palette command explains that limitation instead of invoking v1.

Verification includes two production token runtimes sharing a vault, two real pinned
HTTP/SQLite servers with forwarding and restart, native host binding/disconnect,
immutable review and later-candidate approval, ledger eviction/reconnect, directory
identity, and the retained placement/transport/review/settings guarantees. The
server-backed test uses the vendor script fixture and ABELE_SYNC_DIR.
Live desktop vault exchange, live iPhone, large paged snapshots and all 124 acceptance
scenarios remain manager checks; phone screenshots are desktop CSS emulation.

Removed access-screen assertions and their individual reasons are listed in
[DELETED-SYNC-LEGACY.md](../plugin/tests/DELETED-SYNC-LEGACY.md).
