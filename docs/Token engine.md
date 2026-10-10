# Token engine integration

Phone live fixtures disable HTTP keep-alive at the fixture server to avoid reusing USB
reverse connections. `[sync-fixture-http]` lines in the tier log record actual server
arrival/finish timestamps, connection ID, port, route, declared body length and body
completion without credentials or content. `[phone-reverse]` records tunnel ownership
lifetimes. Exchange snapshots retain the last 64 client request timings and outcomes.
The 20261010-223931 batch had an empty sync-fixture.log and discarded runtime server
stdout, so whether its timed-out requests reached the server cannot be established.

Native transport keeps 30-second inactivity timeouts and a fallback overall bound of
30 seconds plus (request bytes + requested Range bytes) / 32 KiB/s, rounded up to seconds.
The default simple upload, server upload part and ranged download chunk are each 8 MiB
(286 seconds); server-advertised larger parts scale with their actual body size.
Capacitor source is not installed here. Upstream 7.4.3 selects connectTimeout before
readTimeout in [HttpRequestHandler.swift](https://github.com/ionic-team/capacitor/blob/7.4.3/ios/Capacitor/Capacitor/Plugins/HttpRequestHandler.swift#L203)
and sets URLRequest.timeoutInterval in [CapacitorUrlRequest.swift](https://github.com/ionic-team/capacitor/blob/7.4.3/ios/Capacitor/Capacitor/Plugins/CapacitorUrlRequest.swift).
The native bridge exposes no byte-progress callback; the JS bound is a conservative
throughput allowance, not a direct progress measurement. Close still aborts host waiting.

The production plugin pins core and protocol to server commit
`c5d4ccbf83fc4b2812f8cc131d1918851546295e`. The vendor script generated
the archives and provenance; package.json, package-lock.json and SERVER_TEST_COMMIT
use the same input. This revision preserves classified host transport errors and tolerates
transient server SQLite snapshot contention. Mobile transport emits classified EngineErrors;
core carries their sanitized diagnostics and status without a plugin status override.
It also reports V2 server size-limit refusals and preserves observation times for
script review. Oversized local files remain pending and appear by path under
“Not sent” with the server-limit reason. Rejected bytes stay local, and repeated
syncs do not repeat the refused upload while the size limit is unchanged.
No server source is changed.

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

Group connections use the production v2 adapter. Attachment questions are created only
on a real note-open event and use device-local file identities retained through renames.
An allowed decision invokes explicit group asset publication, with immutable pending bytes
and the original idempotency identity kept across uncertainty. History/trash screens use
the selected token connection and v2 restore calls. Original modification time is shown.

First connection preserves different local bytes in a deterministic conflict copy before
placing the verified server variant under the shared path lease. Matching bytes are adopted.
Removed core APIs and their production adapters have been deleted; the production type
check passes. Regression porting remains incomplete: several retained tests still import
retired fixtures, and server-backed external-file tests still use the old harness. Each
connection keeps validated file filters and a device-only size cap; settings tools write
these through the token controller without transferring credentials or ledger identity. Token hydration/eviction and its
multi-connection ownership/forwarding fences are not yet integrated. No live desktop or
phone evidence, completed multi-connection eviction, or complete scenario acceptance is claimed.
