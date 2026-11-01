# Desktop sync scale tier

This tier runs the actual plugin in two disposable desktop vaults, against a configured
real server. It is deliberately separate from the ordinary e2e pool: it quits and kills
the entire application. Never run it in a session containing personal vaults.

The machine-specific transport, resource reservation, vault registration and app guardian
belong outside this repository. They must reserve the desktop exclusively using the bench's
pool/app lock protocol, supervise the process tree, restore the original app registry,
remove generated vaults, and release resources even if the transport disappears. A live
supervisor writes a lease file containing `{"pid":12345,"exclusive":true}`. The runner
checks its liveness; this file is a contract with the supervisor, not a security boundary.

## Targeted two-device probe

Set `targeted: true`, `shape: "smoke"`, `reindex: false`, `heapDiagnostics: false`,
`continuousCpu: true`, `seed: 42`, and
`parameters: {"files":5000,"bytes":1789569706,"wideFolderFiles":512}` in the supervised
runner configuration. Run `node tests/scale/run.mjs /test-run/config.json` under the
same exclusive desktop guardian. This is a separate phase gate, not a scale qualification.
It uploads and pulls, measures three 180-second foreground/minimized/foreground segments,
restarts both devices, performs six offline mutations with Sync now during host indexing,
kills the app after an edit commit is applied but before acknowledgement, and verifies
every expected byte on both devices and the server. Content GETs alone are paced at
140 ms aggregate spacing during the visibility experiment. `visibilityDurationMs` and
`contentSpacingMs` are explicit experiment parameters, never implied product behavior.

`report.json` contains strict A–E budgets, per-device restart timing/read coverage,
offline deletion and directory checks, error recovery observations, lifecycle events,
post-install digest stacks, and install seals in 30-second bins. Missing evidence fails
the affected phase. Each invocation needs fresh disposable vaults and an isolated server
scope; reuse the exact built candidate and package caches, not an earlier connection's
state. A failed invocation resets a consecutive-pass gate; one pass does not qualify it.

Visibility windows require positive confirmed plugin payload bytes written, not a
completed file: a large ranged transfer can make progress without sealing a file in
that window. `installedPayloadBytes` counts successful native/handle writes to staging
or scoped targets at write completion, deduplicating nested layers and excluding host
and metadata writes. Coverage gaps, zero-byte stalls and quit/unload still fail phase A.
Seals remain reported independently. `largeFileThroughput` reports each sealed payload
over 64 MiB from its first content request to its seal, including MiB/s, numeric range
offsets, response chunk sizes, and sequential/parallel request overlap. Network responses
alone never count as written-byte progress.

The post-install read-back oracle covers the initial peer pull, as in the qualification
profile. Host index digests are reported separately. Later rename/replacement digests
remain in the evidence with their caller stacks; matching an older seal's SHA alone does
not establish that a newly installed destination was read back. Unknown callers inside
the pull window fail the oracle.

## Durable attempt ownership

`attempt.py` is a portable Unix supervisor using Python 3 and `tar`. Launch it on the
execution host after preparation. It detaches with its own session and closed stdin;
transport or controller exit does not stop its command. The external command still
owns the desktop locks, resource reservation and platform cleanup. Give each new
attempt an immutable directory and an absolute deadline shared with that command.

```json
{
  "command": ["python3", "/test-run/guardian.py", "/test-run/plan.json"],
  "cleanupCommand": ["python3", "/test-run/finalize.py", "/test-run/plan.json"],
  "cwd": "/test-run",
  "deadlineAt": 1800000000000,
  "terminateGraceSeconds": 120,
  "cleanupTimeoutSeconds": 240,
  "evidenceTimeoutSeconds": 180,
  "progressFile": "/test-run/phase-status.json",
  "evidence": {
    "root": "/test-run/results",
    "paths": ["."],
    "exclude": ["*.private"]
  }
}
```

Start with `python3 attempt.py start /test-attempts/sample /test-run/attempt.json`.
The reply contains the persisted attempt identity. Repeating this command with the same
specification reads the existing attempt; changed inputs fail. A lost reply does not
authorize a replacement. Use `list /test-attempts`, `status /test-attempts/sample`,
or `wait /test-attempts/sample --timeout 30` to attach later. Scripts use `--json`;
the default output is short plain text. Waiting can be interrupted independently.

The supervisor enforces the workload deadline, terminates its owned process group, then
runs bounded cleanup and evidence export on success, error, cancellation or timeout.
Allow those bounded stages time beyond the workload cutoff. Terminal status records
each result and the archive SHA-256; a cleanup or export failure remains a failed attempt.
`collect /test-attempts/sample /saved/sample.tgz` verifies the checksum and supports retries.
`export /test-attempts/sample` streams that verified archive for a transport client.
Keep the remote attempt and its source evidence until a verified collection succeeds.
`stop /test-attempts/sample` requests explicit cancellation without bypassing cleanup.

Status distinguishes a live supervisor by its kernel lock, rather than trusting a PID
that could have been reused. A dead remote supervisor is reported as orphaned; attaching
never reruns its command or invents completion. Host loss or a direct uncatchable kill
of the remote supervisor requires inspecting its retained state. Platform-specific
launchers and recovery instructions remain outside this repository.

The default worker plan is five hours from `workerStartedAt` (Unix milliseconds), with
15 minutes reserved for evidence copying and cleanup. The external supervisor must receive
that same absolute worker start before preparation/builds, not reset it when the app starts.
The default scenario cutoff is therefore start + 4 h 45 min. An explicit `deadlineAt` overrides that scenario cutoff using an absolute Unix timestamp in milliseconds. Leave the
supervisor extra time to stop the app, finish evidence collection and release its leases.
The scenario stops at its next observation wait or server-file boundary after that deadline;
an outstanding request can still take its normal timeout. `checkpointMs` (default 30 seconds)
controls atomic `checkpoint.json` snapshots containing the current phase and wire evidence.
Every phase transition, interruption and settle completion also queues an immutable snapshot
under `phases/`; it captures the report and wire state at invocation, rather than when a later
queued write runs. The latest checkpoint remains atomic. Failed checkpoint writes fail the
phase-evidence gate. A checkpoint is partial evidence, never a passing result. Expected inventory is also saved
separately. Final JSON/Markdown include phase durations and per-interruption recovery
observations; null means no such observation occurred before the next interruption.
The pause boundary is the renderer's actual invocation time, with in-flight requests
reconstructed from timestamped starts/finishes/closures. Controller invocation time and CLI
latency are retained separately. No timing budget is relaxed for that latency.
The advertised file-size limit partitions the unchanged generated plan. Oversized files
remain required intact on the primary. Their absence on peer/server is expected only with
exact-path size refusals in both primary status and activity log, no repeated initiation
within an engine generation, and no fully-synced claim. Only the harness's deliberate crash,
quit and plugin-reload interruptions define generation boundaries; a network drop does not.
Fully-synced claims use visible status-bar and connection-line words, not internal idle rows.
Snapshots retain `activity.notSynced`. Missing status observations for connected states fail
closed; an observed empty label set makes no visible completion claim. Snapshots before any
connection exists are counted separately. Total/per-generation
upload attempt counts and visible states are retained. Multipart interruption targets the largest eligible file, recorded with size
and hash. A missing limit or eligible target fails preflight. Quota is recorded without
inferring remaining capacity. Hidden/settings exclusions remain a separate category.

Pause permits requests dispatched within 100 ms of the renderer invocation, requires all
requests closed within 2 seconds and zero vault-write operations/bytes after +100 ms.
The raw strict-zero request count remains reported but is not a gate. A disposable observer,
loaded before the product, records desktop adapter writes and the native promise/handle
ports used by the sync filesystem. It includes private stages and settings writes inside
the fixture vault. Begin/end intervals conservatively include operations overlapping the
grace boundary; byte totals are upper bounds and may overlap across layers. Atomic installs
and truncation also count as mutations. Unknown coverage/bytes or unfinished operations fail
closed. These are API observations, not kernel syscall attribution. The observer restores
the original ports on unload, and never changes product source or filesystem arguments.

## Inputs

Build the desired branch or commit in a disposable checkout with the normal checked build.
Pass the resulting `plugin/build` directory and the **resolved commit SHA**, not a moving
branch name. Asset digests and the build's recorded revision are checked before installation.
The build can be changed independently of this driver, including to test an SDK migration.
Include the existing release tags when exporting the checkout: changelog generation needs
release boundaries even for a build at an exact commit. A branch-only bundle can omit those
tags and fail the checked build. Import the missing existing tags into the disposable
checkout without changing its selected commit, then finish the build before starting the app.

### Local or remote server

For a candidate needing a matching core/server implementation, prepare that exact core
commit on the build host, independently of the plugin checkout:

```sh
node plugin/scripts/prepare-sync-fixture.mjs /path/to/core-repository "$SCALE_CORE_COMMIT"
```

`SCALE_CORE_COMMIT` must be the full immutable 40-character commit SHA. Preparation uses
`git archive` of that object, `npm ci`, and forced TypeScript builds of protocol, server,
core and CLI. It never builds in the source repository's working tree. Its printed
`ABELE_SYNC_DIR` is the resulting fixture path, not an automatically selected checkout.
The receipt records commit/tree, lock digest, package versions, tool versions and hashes
of source, compiled output, tests and package manifests.

Set `serverMode: "local"`, `serverFixture`, `serverCommit` and
`localServerDirectory` in the run config. With `serverCommit`, the runner verifies the
fixture against that exact commit. Set `serverCoreVersion` and `serverVersion` to the
expected core/server package versions; these can differ from the SDK release version.
The receipt records the plugin build receipt's paired SDK version separately. Without
an explicit core version, the legacy same-version check remains. Checksummed inputs are verified before launch;
wrong commit/version or changed files fail instead of falling back to the older fixture.
The server receipt records this selection and the fixture receipt digest.

An explicitly selected local server also must prove `HEAD /v2/uploads/:sha` before fixture
generation: upload 32 random synthetic bytes, require successful HEAD for that known SHA,
and require 404 for another absent SHA. A missing HEAD route therefore cannot masquerade
as successful absence detection. This probe uses the owned local server only, outside
the workload folder and timing interval; its status/byte receipt contains no credentials.
The fresh SQLite database and blobs are removed on close. The default legacy fixture pin
below remains available for comparison runs; a new candidate must pass `serverCommit`.

`serverMode: "remote"` (the backwards-compatible default) uses `server` and `tokenFile` as
before. Supply `serverVersion` when known; an absent version is recorded as unknown. This
mode remains useful for a separate network-realistic run.

`serverMode: "local"` starts the **existing pinned server-test fixture** on loopback with a
fresh SQLite database, blobs and generated keys. It does not use a tunnel, Docker, PostgreSQL,
a service install or a global database. The fixture must already be built in owned scratch
using `scripts/prepare-sync-fixture.mjs` at `SERVER_TEST_COMMIT` from
`scripts/server-test-fixtures.mjs`. That script exports exact committed source, installs only
inside that export and records build/digest provenance. Prepare it under the external
supervisor's build reservation; do not compile it in a shared live checkout. Set npm/cache,
node-gyp devdir and temporary paths to owned scratch when preparing the fixture. Missing
native build tools require operator setup, never an automatic system install by this tier.

Local configuration adds:

```json
{
  "serverMode": "local",
  "serverFixture": "/test-run/server-fixture/source",
  "localServerDirectory": "/test-run/server-data",
  "expectedServerLimits": { "max_file_bytes": 209715200, "quota_bytes": null }
}
```

Copy `expectedServerLimits` from the reference stand's recorded connection limits; the
example is not a policy constant. The server's actual advertised limit still selects the
multipart target and refusal set. Any mismatch fails preflight without changing settings or
trimming the generated profile. `localServerDirectory` must be empty and owned by the run.
Inherited `ABELE_*` variables are removed before configuring the isolated SQLite instance.
A root token is provisioned through the fixture's admin CLI and held in memory, never printed.
`server-receipt.json` and the run receipt record mode, exact fixture revision/build receipt
hash, package version, Node version, endpoint, database kind and actual advertised limits.
The fixture package can have an unversioned package label; its immutable revision identifies
this test server, rather than pretending it is a deployed release.

The server is stopped on normal/failing exits and its owned database/blobs removed. The
external supervisor must kill the **whole controller process group**, including the local
server, if the controller/transport dies. Retain receipts before deleting its owned scratch.
Remote content retention/deletion remains an explicit operator action as before.

### Building with a development SDK archive

`build.mjs` prepares a **clean detached checkout** at an explicitly resolved plugin commit.
Run it under the external supervisor's build resource reservation, before taking the app
lease. It does not acquire machine or app locks itself. Its configuration is separate from
the live credentials and vault configuration:

```json
{
  "pluginRoot": "/test-export/plugin",
  "build": "resolved 40-character plugin commit",
  "output": "/test-run/evidence",
  "sdkTarball": {
    "path": "/test-inputs/sync-sdk.tgz",
    "sha256": "SHA-256 supplied with the archive"
  }
}
```

```sh
node tests/scale/build.mjs /test-run/build-config.json
```

The archive checksum is checked before npm runs. A private snapshot of those exact bytes is
installed with scripts disabled. The export's package and lock metadata record an honest
local-file dependency and SHA-512 integrity; the SDK payload is hashed and checked again
before and after compilation. Only dependency metadata changes in the export; product source
and the production registry-pin verifier are untouched. Omit `sdkTarball` for the ordinary
registry build. `offline: true` forbids dependency downloads; otherwise npm may fetch the
archive's transitive dependencies. `npmCache` can name the supervisor's disposable cache.

The explicit archive build substitutes checksum/payload verification for the registry-only
release-pin check. It still runs the original normal and strict type checks, requires their
matching input receipt around bundling, and runs the original artifact verifier. This is a
development test artifact, not a registry release qualification. Start a fresh export after
a failed preparation rather than repairing an override in an attached branch.

`build-receipt.json` in `output` records the base plugin revision, archive path/SHA-256,
installed version, local lock resolution/SHA-512, every SDK payload hash, dependency metadata
hashes, changed metadata paths, and artifact provenance. Its manifest digest hashes canonical
`JSON.stringify` output. Keep `output` outside the export or under an ignored scratch folder.
For the live configuration, set `buildReceipt` to that receipt and carry the same
`sdkTarball` selection. The runner verifies the receipt against the selected artifact before
creating server content. An SDK override without its matching receipt fails closed.

The default shape is `smoke`: exactly 1,000 payload files and 200 MiB. `scale` is exactly
33,000 payload files and 11 GiB. Both use the same generator and seeded content algorithm.
`parameters.files` and `parameters.bytes` override these sizes. The payload has deep folders,
mostly small UTF-8 markdown, Unicode/spaces, case-only siblings, configuration and plugin
data paths, and opaque PNG/PDF attachment payloads with a bounded long tail. Attachment
payloads exercise storage and transfer, not image/document rendering. The smoke shape
includes a file exceeding 100 MiB. A case-sensitive volume is mandatory; filesystem folding
fails before generation rather than overwriting a sibling. No sparse files are generated.

The token is read at runtime from `tokenFile`. It must allow creation of a new server folder
and issuing a token for that folder. The runner creates a unique synthetic scope, never resets
the server, and revokes the issued token afterwards. Synthetic server content is retained for
diagnosis; removing that scope is a separate operator action. Its generated `.obsidian` paths
are nested inside this scope, so this tier does not approve or exercise executable plugin
installation or root settings propagation.

Example configuration (all locations are examples):

```json
{
  "leaseFile": "/test-run/lease.json",
  "app": "/Applications/Obsidian.app/Contents/MacOS/Obsidian",
  "cli": "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli",
  "buildDir": "/test-build/plugin/build",
  "build": "resolved commit SHA",
  "vaults": ["/test-volume/scale-a", "/test-volume/scale-b"],
  "output": "/test-run/evidence",
  "tokenFile": "/test-secrets/owner-token",
  "server": "https://sync.example.test",
  "shape": "smoke",
  "seed": 42,
  "timeoutMs": 180000
}
```

Both empty vault directories must already be registered and set to open at application
startup by the supervisor. The app must be stopped before invocation. Run from `plugin/`:

```sh
node tests/scale/run.mjs /test-run/config.json
```

CLI evaluations reuse the e2e helper's nonce-framed replies and child-process cleanup, so
a completed action does not wait for an inherited output pipe to close.

Only the smoke shape should be used while developing this tool. The large shape is an
explicit later reliability gate, not a default test or an npm/CI hook.

## Observations and scenarios

Each device gets its own streaming loopback proxy. Tokens with rewritten loopback addresses
are temporary files with mode 0600, removed on exit. HTTP bodies and authorization headers
are never logged. WebSocket upgrades are forwarded and severed during network interruption.
Direct oracle downloads bypass these proxies and cannot inflate plugin download counters.

Proxy breakpoints hold a successful content commit acknowledgement, an active large upload, a comparison response and
a content response, so the driver can quit mid-batch, kill mid-large-file, quit during
comparison and pause mid-pull. It also drops/restores an active connection and disables/enables
the plugin while a request is active. The large-file kill runs first; the batch quit cuts
after a content commit is confirmed on the server and before the client sees its reply.
Missing triggers time out and fail. It then joins the
second vault, edits on both devices, settles, and restarts a synced vault. A startup observer
loaded before the plugin records each DOM notice's text, timestamp and synchronous creation
origin, along with renderer long tasks.
The controller's timestamped scenario phases assign each notice its phase in both reports.
Notice evidence is local run output and may contain sensitive text; never commit it.
It does not change the plugin's transport or engine implementation.

After the app stops, every expected file is hashed on both devices. Every server file in
the scope is downloaded through the server API and independently hashed, including size.
Missing, extra and corrupt files fail separately. This compares bytes against the generated
source and directed edits, not against the plugin ledger. Upload SHA paths and commit/manifest
metadata identify downloads of device-owned bytes; unresolvable content requests fail closed.
Ownership is ordered by request: a later upload never reclassifies an earlier remote download.
The primary's persisted connection selective settings, actual config folder and ignore file
determine the peer/server expected set. Excluded payloads are listed as "excluded by settings"
and must be absent there; the primary still must retain every generated byte. Optional
`pluginSettings` seeds the plugin's settings file before startup. Case-only siblings remain
strict unless the primary exposes a refusal for that exact path in status or its activity log;
the report retains those refusals. A similarly spelled path is never sufficient.

Each run emits `report.json`, `report.md` and `renderer.jsonl`. The JSON includes sanitized
wire events, actual interruption triggers, mismatches, files/s, MiB/s and each measured budget.
Restart timing starts at app launch; resume timing measures the next upload/commit request.
Pause timing starts before the pause CLI action and includes completion of already active
requests. New HTTP requests include endpoint/kind summaries, per-second buckets and each
request's click-relative time. Caller attribution is null unless supplied by the trace.
Response closures, including cancellations, carry timestamps. If an active request vanished
without a completion timestamp, stop latency is unknown and fails its budget; absence of new
requests alone never proves zero stop latency.
The in-renderer pause invocation timestamp is recorded separately from the controller's
earlier observation boundary. The raw strict-zero count is retained as measurement; the approved 100 ms request grace is the gate.
Startup reports retain launch totals and observe the product's existing `abele:onload-start`
performance mark, emitted at entry to its onload. The first-request and idle budgets start
from that product mark; absent marks fail the budgets. Observer load remains a separate time.
No product code is changed. Product sync-start markers are not available in the current trace;
plugin-load-to-sync-start and sync-start-to-request stay null. During pause only, the observer
captures the existing transport debug log's call stack without changing requests. Matching
device/method/path/time evidence is attached to the pause timeline; missing matches stay null.
The primary's exact refusal statuses and timestamped visible activity events are retained in
JSON at settle points; summaries and case-refusal evidence are included in Markdown.
Notice counting covers the entire instrumented app lifecycle, including second-device join.
Only proven Abele notices count against the notice gate. Host and other-plugin notices remain
separate full evidence; unknown origins fail a separate attribution gate. No text is used to
exempt a notice, including indexing messages. The observer captures the synchronous stack at
`Notice.setMessage` or insertion of a notice DOM node, associates it with that actual element
in a WeakMap and retains it when the DOM later acquires text. Plugin script URLs/paths and
host bundle frames identify origins. Unrecognized or pre-observer nodes remain unknown.
Throughput includes interruption downtime; it is not a raw-link benchmark. Renderer long tasks retain their actual start time and browser attribution metadata. A
main-process watchdog receives renderer heartbeats every 25 ms. After 75 ms without one,
it asks the debugger protocol to CPU-sample at 1 ms intervals; it stops when heartbeats resume,
or after a 10 s capture chunk. Normal responsive periods are not CPU-profiled. The observer
waits for debugger setup before finishing its onload so the first product load is covered.
It never takes over an already attached debugger. Raw profiles and start/ack/stop times are
retained in `profiles/` and `renderer.jsonl`. Failed capture disables sampling; unavailable
profiles and destroyed renderers remain explicit unknowns.

`longTaskAttribution` joins overlapping task/profile windows and retains sampled frame stacks
and counts by source, including mixed host/plugin work. It excludes samples whose start-time
uncertainty extends outside the task. The first 75 ms and debugger command latency are not
profiled; tail samples cannot prove the whole task came from one component. Short tasks or
lost captures remain unattributed. This diagnostic does not claim the no-sync-task-over-50-ms
requirement passed merely because a tail sample contains host code.

The external controller samples RSS every second using only the owned app PID and its
transitive process descendants, including both renderers. `memory.jsonl` records timestamps,
phase, PIDs and aggregate bytes across restarts; `peakAppRssBytes` is the maximum observed sum.
This is a sampled app peak, not an instantaneous OS high-water mark or whole-machine memory.
Absent process data is marked unavailable, never turned into zero.
Missing measurements fail; a failed scenario never becomes an implicit pass.
Device settle failures are retained while later reachable steps and the byte oracles continue.
Byte equality cannot pass unless both device scans and every server download finished.

Targeted harness tests:

```sh
npx vitest run tests/harness/scaleHarness.test.ts --maxWorkers=2
npx vitest run tests/harness/scaleBuild.test.ts --maxWorkers=2
```

Additional focused tests: `scaleDiagnostics.test.ts`, `scaleLocalServer.test.ts` and
`scaleProgress.test.ts` in `tests/harness/`, always with `--maxWorkers=2`.

## Vault cache rebuild interruption

The `scale` profile declares three separate `reindex` occurrences: during primary upload,
peer initial download, and primary startup comparison after a synced restart. Each must
actually click the English host's **Files & links → Rebuild vault cache** setting while
sync has an in-flight request. The tier seeds English; an absent or ambiguous setting fails
instead of calling cache internals. The setting reloads the vault window. The observer
persists its receipt outside the vault and observes the host's cache-clean callback after
reload; the earlier `finished` event alone does not establish indexing completion.

Each rebuild records actual click/completion times, requests and vault writes during indexing,
deletions, notices, long tasks, and activity through the subsequent sync settle. Independent
Node-side content snapshots retain existing-file integrity while allowing new peer downloads.
Server-before and local-before hashes distinguish already-present content from pending work.
These snapshots read fixture bytes outside the renderer and their preparation cost is included
in phase timing. Final byte verification and sync settle are still required. Every declared
kind/occurrence must trigger; repeating another occurrence cannot replace one.

Native hash observation preserves hash inputs/results and records stack provenance separately
for host, plugin and unknown calls. Debugger tracepoints in recognized bundled incremental
hash constructors attach digest observers without rehashing content or changing digest results.
Constructor tracepoints are armed at a synchronous debugger gate on the first statement
following `abele:eval-end`, after imported module initialization. Each binding targets that
script instance only; reloading the plugin re-arms the gate without instrumenting the next
bundle's module setup. Startup cannot run past the gate until bindings are installed.
The short debugger setup intervals are retained in `hashTracepointSetup`; raw startup clocks
and long tasks include those intervals and are never silently corrected. A missing evaluation
boundary fails setup. Module initialization is outside JavaScript digest observation; all
post-boundary digests remain observed, including startup and subsequent reloads.
Receipts retain the actual SHA, byte count and stack. Activation must be proved by bindings
and observed JavaScript digests in both renderer generations; missing proof fails the oracle.
The observer correlates digests with fixture file SHAs and prior observations, retaining raw
calls and matching paths. Upload redundancy uses actual PUT body bytes for SHAs already in
the server snapshot, rather than counting upload-session begin requests.

Precise debugger call counts remain available across old and new renderer contexts;
`preciseHashCoverage: false` disables those counters when actual digest observation is used.
Raw coverage files accompany CPU profiles when enabled. Native zero counters alone never
prove zero JavaScript hashing. The recovery window includes normal sync work, so positive
counters and digest matches do not by themselves prove that rebuilding caused each hash.
Observation has overhead and requires live qualification before interpreting timing comparisons.
Owned debugger sessions are disposed on navigation and replacement; a debugger belonging to
another tool is never detached.

If the driver exits from a signal the worker did not send, do **not** restart a live run.
Copy the last checkpoint/observer/CPU/memory evidence, let the supervisor clean up, verify
resource release, and report the external stop. Partial phases remain unqualified. A new live
attempt requires a new instruction authorizing it.

For live qualification, `reindex: true` also enables all three rebuild occurrences in the
smoke profile. `continuousCpu: true` arms CPU sampling before product load at a 10,000 μs
interval, rotating raw profiles every minute, instead of waiting for a stalled heartbeat.
This captures the beginning of long tasks during sustained heavy work. Abrupt app kills can
still censor the current unsaved segment; that gap remains unqualified. Debugger coverage
around rebuilds remains separate. The build receipt distinguishes the candidate's own
verified `pinned-archive` SDK input from a registry pin or an explicit harness override.

Pause write evidence includes caller stacks. Only recognized host settings/workspace
persistence with a proven host stack is reported separately and excluded from the sync-write
budget. The host recent-files save to `.obsidian/workspace.json` may pass through leading
plugin adapter frames in the recognized `ChangeTracker.around` chain; those wrappers do
not make the host save a sync write. An arbitrary plugin callback followed by a host frame
is not that adapter chain. Plugin callers
below a host frame and unknown origins still fail, as do writes to ordinary note paths. Adapter/native layers remain a conservative operation upper bound, not unique
physical bytes. Native handle `sync`/`datasync` start/finish receipts include elapsed durations
for phase analysis; these cover observed vault handles, not every filesystem flush by the
app, database or operating system.

Durability observation includes readonly file and directory handles, including the vault
root, without enabling payload-read observation outside restart. Renderer evidence is sent
over ordered IPC to one bounded asynchronous append queue per file in the host process.
Queues survive renderer reloads; planned process exits finish profiler captures and await
evidence flush acknowledgements before termination. Storage failure or queue overflow fails
the flush instead of silently passing incomplete evidence. State receipts cover both devices.
Handle restoration records use weak ownership, so closed or abandoned native handles remain
collectible while observers stay installed. Still-live handles are restored on unload;
dead weak references are pruned during later opens. RSS measurements still include the
observer and host, rather than isolating product allocations.

Every periodic state receipt, controller snapshot and settled activity snapshot retains each
connection's complete `classification` diagnostic (or null when unavailable). The synced
restart's `restartClassification` section records one final snapshot per device and connection,
including cache storage/loaded rows, hits and misses by caller and reason, read counts/bytes,
and the diagnostic's first-read stacks. These are cumulative diagnostics for that runtime,
not sums of periodic snapshots or replacements for independent read-port receipts.

Synced restarts additionally require zero plugin payload-content read bytes, measured at
adapter reads, native promise readFile and native FileHandle read/readv/readFile ports.
Only generated payload paths count; stat calls and private control files do not. Host
indexing reads are retained separately by stack origin. Unknown callers, incomplete plugin
reads, missing observer coverage in either renderer generation or observer errors fail
closed. Raw read receipts remain in renderer.jsonl; overlapping API layers make positive
byte counts a conservative upper bound rather than unique physical bytes. Read and write
port wrappers are restored together in reverse installation order on observer unload.

Renderer JSONL receipts are read as a stream, so evidence can exceed the runtime single-string limit. In-memory payload-read operations are retained only for the synced-restart window; the raw receipts remain complete. Corrupt completed receipts fail analysis; only a live scan may defer an incomplete final receipt.

Payload-read instrumentation is disabled during initial upload/pull and edits: synchronous
per-read receipt writes can materially perturb a large scan. After the app stops, the driver
enables it in both vault configurations before timing the synced restart. Its zero-content-read
oracle still requires readiness in every restart renderer generation and fails on missing
coverage or unknown/incomplete sync reads. Write observation, pause attribution and all hash
and rebuild oracles remain active throughout. Reports declare this measurement window;
comparisons with recordings that observed every initial read must retain that distinction.

Both devices' strict restart settle checks start together. Each device's first request and
first settled idle are timestamped against its own plugin-load mark; one device cannot gain
time merely because the controller waited for the other. After the strict phases and full
byte verification, a separate control restart makes no forced reindex. Its observer records
only plugin-load and first-idle marks, while the existing server proxy records requests.
The control does not install read, write or hash wrappers, debugger tracepoints, CPU profiles,
coverage, heartbeat, deep activity snapshots or notice wrappers. Control timing is reported
separately and does not replace the strict restart or its read/hash oracles.

Growing JSON checkpoints/final reports and Markdown details are written incrementally to
atomic temporary files. This includes nested restart read evidence; a large row is not
serialized as one string. Snapshot copies use structured cloning, not JSON round trips.
JSONL rows have a 4 MiB limit, enforced before line concatenation. Individual JSON inputs
(rotated CPU/coverage segments, small rebuild receipts and baseline comparison input) have
a 64 MiB read limit; a corrupt/unrotated segment fails evidence analysis explicitly.
Supply a compact baseline summary if its full report exceeds that limit. Main-process
profiles rotate every 60 seconds in continuous mode (10 seconds for stall captures);
profile analysis loads sequentially with four cached
segments rather than loading a whole recording concurrently. Build assets, configuration,
tokens and single rebuild-control receipts are not accumulated log readers.

Every checkpoint first writes a small `phase-status.json` without raw wire receipts.
Monitors should read it instead of loading the full checkpoint repeatedly. Controller
exceptions save a boundary checkpoint with the failed phase, stage (`scenario`/`analysis`)
and explicit `remainingPhaseEvidence: [{phase, status: "not run"}]`. Final-analysis exceptions
also write `failure-report.json`; raw JSONL, profiles and earlier phase files stay intact.
The driver does not execute dependent phases after an abort or manufacture their results.
A failed profile/receipt read fails the run even when the rest of analysis can continue.

For offline window comparisons, run `profile-windows.mjs captures.json profiles windows.json output.json`.
Captures are the `cpu-profile` receipts; windows contain `name`, `device`, `start` and `end`
in epoch milliseconds. The analyzer clips weighted sample intervals using the calibrated
profiler clock, resolves omitted URLs by script ID within each profile, and reports plugin
self/inclusive time plus native leaf ownership. Inclusive rows overlap and must not be added.
Names can combine several functions; retained bundle positions support source verification.
Sampled time includes native waits and is not process CPU accounting. Compare coverage with
window duration: missing spans and `profileFailures` make a window incomplete, never zero work.
Malformed sample timing stays rejected and is listed explicitly. This analysis does not
replace the qualification report or change any runtime gate.

Optional heap diagnostics sample renderer usage and bounded responsiveness throughout the
scenario. Each renderer takes one heap snapshot after synced restart, outside the upload,
pull, edit and restart timing windows, before the stopped-app byte verification. Snapshot
GC and inspector mappings can inflate RSS; report workload pre-capture peaks separately
from diagnostic peaks and do not equate retained JS bytes with total resident memory.


Local fixture shutdown preserves the stopped SQLite database and any WAL, SHM or rollback
journal under `state/server-final` before deleting disposable server storage. A receipt lists
the copied files. This excludes blob payloads; full server byte verification remains separate.
A failed evidence copy retains the source storage and fails cleanup rather than discarding it.
The guardian's later disk-state copy cannot substitute for this pre-disposal capture.

Strict restart timing uses a clean app generation: no comparison hold, rebuild, reload,
or hash-tracepoint breakpoint is scheduled inside that measurement. `strictRestartWindows`
requires exactly one observed renderer generation per device and no interruption trigger.
The comparison/rebuild restart runs afterwards in its own `restart comparison` phase, with
separate activity evidence. Report the host-index wait independently for each generation.

Continuous profiling is acknowledged before the observer enables/evaluates the product.
Only the observer is enabled on disk for these launches/rebuilds; the main-process profiler
survives renderer navigation instead of replacing a running watch. Control mode retains
ordinary loading without profiling. Coverage uses the actual calibrated profile timestamps,
not the claimed receipt duration: missing prefixes, sample gaps and unknown stacks fail
attribution. Mixed sampled stacks do not prove that all time belongs to the plugin.

Queued upload payload digests are reported separately from reindex-created hashes only
when multipart caller stacks match an already active upload session or the rebuild's own
pre-click snapshot proves the SHA was queued. A previous scan/hash alone is insufficient.
The same-SHA session, intent snapshot and digest receipts remain in the evidence.

`interruption-receipts` captures allowlisted pending pull intents, ledger acknowledgement,
live identity-bound installation proof presence, committed host private-stage records and
queued upload sources. Snapshot transaction failures remain explicitly incomplete. The
continuous-profile fixture appends a diagnostic accessor and fingerprint argument hooks
to the disposable copy of the verified bundle; the source artifact is unchanged. This is
diagnostic perturbation, not a production build measurement.

Zero post-seal read-back remains required. The only separate `recoveryVerifications` are
reads joined by exact target/SHA (and exact private-stage path when applicable) to the
latest declared interruption before its observed recovery idle, with a complete snapshot proving an unacknowledged intent
and absent usable identity receipt. A missing/later incomplete snapshot, ambiguous target,
intervening observed target write, acknowledged installation or unexplained caller fails.
Raw post-seal reads and allowed recovery checks are both retained; neither is hidden.
