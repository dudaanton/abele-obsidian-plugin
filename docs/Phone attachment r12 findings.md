# Phone attachment batch 20261010-235526

Source: the manager's batch on `4915480f7`, `phone/p1.log` and its failure snapshots.
No live device runs were performed for these changes.

## Transport evidence

The attachment test uses `TokenSyncLive` and `spawnSyncServer`, including native file
content and external verification requests. The server preloader applies `Connection:
close` to every phone fixture response; this is not a second server path. Each arrival
in the first failing case has a distinct server connection number. The reverse for
port 62354 was ready at 1791665791039 and stopped only at 1791665827992.

The client GET `/v2/changes` started at 1791665823242, failed after 3068 ms, and has no
server arrival in that interval. The fixture's preceding arrival was at 1791665821258.
This failure predates tunnel shutdown. The fixture readiness call succeeds and this
case's earlier requests arrive, so this is not a permanently missing reverse route.

In the materialization case, the client POST external verification started at
1791665887437 and failed after 30484 ms. The matching POST on port 62597 arrived at
1791665887448, with 179 declared bytes, and finished with HTTP 200 after 2 ms, with its
request body complete. The old trace labels this route `/other`, so matching is by
case, method, timestamp and payload size rather than a request correlation ID.
All 297 recorded server arrivals finished; the slowest response took 803 ms.

These observations exclude server slowness and teardown as the causes of these two
failures. They do not distinguish a USB reverse-driver fault from an iOS native
networking fault, or prove delivery of response bytes to the phone. The reverse
driver is external to this checkout. No speculative reverse restart or server
keep-alive change was made. The trace now names changes, manifest, verification and
content routes without file IDs and records the actual response Connection header.

The fixture's explicit sync/read operations now wait through classified offline
failures (at most three attempts, with 2 s then 4 s backoff). Persistent failure is
still reported. Authentication and transfer assertions are retained; verification
counts represent successful HTTP authorizations, not failed native attempts.

## Product hydration and departure

Explicit hydration previously returned `offline` immediately even though ordinary
sync retries classified transport failures. Retry now occurs at provider verification
and download boundaries, inside the same journalled hydration. Retrying a whole
hydration after a download failed would encounter its already-persisted intent.
Non-offline errors are not retried, and ownership is checked before each attempt and
after success. A persistent failure still leaves recovery evidence intact and refuses
departure. Integration regressions cover both failure boundaries, restored bytes,
retired sidecar and exactly one hydration journal.

The departure snapshot's `Connection changed while disconnecting` was caused by a
whole-record comparison after materialization. A running exchange changes status
between Ready and Syncing without changing authority. The comparison now ignores
only status; changes to policy, identity, credentials or other record fields still
refuse departure. Tests cover an exchange status change and a simultaneous pause.

## Large transfer setup

The 200 MiB fixture connected with the phone's default 50 MiB selective limit. Its
first sync correctly skipped the attachment, leaving no retained file identity for
eviction. Before publishing the attachment, the fixture now explicitly raises that
connection's size cap to the fixture size through `updateConnection`, preserving all
other selectors. The product default, transfer size, concurrent hydration checks and
resident-memory assertions remain unchanged.

## Verification limits

Unit and integration checks reproduce the ordering, policy and transient retry
behaviour off-device. The USB/native failure itself and end-to-end phone recovery,
including the 200 MiB memory measurements, still require a manager-run phone batch.
