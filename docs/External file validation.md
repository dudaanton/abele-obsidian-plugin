# External file validation

Use the exact core/protocol revision in `plugin/vendor/sync/provenance.json`, not a
mutable server checkout. From `plugin/`, export the independent fixture:

```sh
node scripts/vendor-sync.mjs /path/to/sync-repository b6d8066cc7a72ade3d1143985b6f0cd510e854e7 fixture
node scripts/verify-sync-inputs.mjs
```

Set `ABELE_SYNC_DIR` to the printed clean archive directory. Tests verify its
provenance and checksums. The integration test uses the installed core engine and
the real fixture HTTP server, with synthetic filesystem hosts and IndexedDB emulation.

## Focused matrix

Run related files only, with `--maxWorkers=2`:

| File under `plugin/tests/`                                                                  | Coverage                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integration/externalRepresentationServer.test.ts`                                          | A evicts; B keeps and edits through ordinary sync; A receives metadata without content GET/upload/commit, hydrates new bytes, and leaves B's policy unchanged. Repeats with reopened state; remote rename/delete/restore; actual retention sweep removes an observed historical version. Changed sidecars, retained staging and unknown outcomes keep hydration/lifecycle blocked. |
| `integration/externalAttachmentApi.test.ts`                                                 | Explicit API, publication, version/SHA/size validation, pin/use, scoped warning, phase/mutation termination matrix and retry safety.                                                                                                                                                                                                                                               |
| `integration/externalState.test.ts`                                                         | Durable transactions and IndexedDB/SQLite reopen.                                                                                                                                                                                                                                                                                                                                  |
| `integration/externalRecoveryBarrier.test.ts`, `integration/externalRuntimeEffects.test.ts` | Recovery-before-effects and stale-runtime fences.                                                                                                                                                                                                                                                                                                                                  |
| `integration/externalMigration.test.ts`                                                     | Activation/downgrade fence and missing-ledger holds.                                                                                                                                                                                                                                                                                                                               |
| `integration/externalFilePorts.test.ts`                                                     | Install collisions, final-check deletion and preserved evidence.                                                                                                                                                                                                                                                                                                                   |
| `integration/externalRepresentation.test.ts`, `integration/externalScopedOwnership.test.ts` | Projection classification, selective/scope changes, identity and authorization.                                                                                                                                                                                                                                                                                                    |
| `integration/externalLifecycle.test.ts`, `integration/externalConnectionSwitch.test.ts`     | Materialization, unsafe departure/re-enrollment/import refusals and phased replacement recovery.                                                                                                                                                                                                                                                                                   |
| `unit/syncBuildInputs.test.ts`, `unit/externalCoreInputs.test.ts`                           | Archive, installed payload and fixture alignment, including negative mismatches.                                                                                                                                                                                                                                                                                                   |

Regression files for the integration gate:

- Ordinary sync: `integration/syncServer.test.ts`, `integration/syncService.test.ts`,
  `integration/syncJoin.test.ts`, `integration/syncHeldDeletes.test.ts`.
- Selective sync: `integration/syncService.test.ts` (manifest rewalk and changed
  participation), `integration/externalRepresentation.test.ts` (external identity/holds).
- Script approval: `integration/scriptApproval.test.ts`,
  `integration/syncStagedSettings.test.ts`, `integration/externalRepresentation.test.ts`
  (attachment-to-code/settings transitions).
- Lifecycle: `integration/externalLifecycle.test.ts`,
  `integration/externalConnectionSwitch.test.ts`, `integration/syncHandover.test.ts`,
  `unit/syncSharingTeardown.test.ts`.

## Live desktop and phone

The supervising runner must build the sharing-test plugin and run these files through
its local batch tooling on **both** targets, with the pinned HTTP fixture reachable:

- `e2e/externalAttachmentApi.e2e.test.ts`: real HTTP-backed personal/scoped-reader
  eviction, verified read, hydration, materialization and revocation. It asserts that
  the original is absent after eviction, the projection exists, restored bytes match
  SHA and size, and the visible projection is retired.
- `e2e/externalStateRestart.e2e.test.ts`: real IndexedDB reopen.
- `e2e/externalFilePorts.e2e.test.ts`: production host filesystem semantics.
- `e2e/externalRepresentation.e2e.test.ts`: real projection/recovery host integration.
- `e2e/externalFileSafety.e2e.test.ts`: retain the original filesystem probe assertions,
  including the demonstrated mobile copy-overwrite failure.

The attachment API file also uploads a synthetic **200 MiB** binary to the real server
and completes eviction/hydration. Concurrent identical hydration requests use core's
actual exclusive scheduler; both must complete with exactly one content download and
peak active download concurrency **1**. This checks hydration buffer scheduling,
not a global memory bound for every other consumer or independent process.

The size case uses the production native transport, releases its synthetic input after
the initial write, and verifies the final SHA/size through the host fingerprint port.
It does not retain a second full-size comparison buffer or take a WebCrypto snapshot.
Desktop downloads bridge response chunks; desktop disk rechecks reuse a 1 MiB buffer.
Expected payload growth is approximately one to two file sizes during download assembly,
not a proven resident-memory bound. Mobile immutable blob/version downloads now use 8 MiB
HTTP ranges and staging uses 1 MiB writes when `appendBinary` exists. Verification still
uses whole-file `readBinary`. See `External file filesystem ports.md` for allocation estimates
and fallback limits. Native bridge and garbage-collection overhead require live measurement
on both platforms. Range downloads add one request per chunk; the current server loads the
blob before slicing each range, so server read cost and transfer duration also need live checks.

The size case samples resident memory every 25 ms and at transfer boundaries, reports
baseline/sample count/sampled peak, and requires growth of at most **1 GiB** over the
baseline taken before local allocation. It has a ten-minute transfer timeout. Sampling
does not prove the absence of shorter peaks. Desktop uses `process.memoryUsage().rss`
where available. A host without it must have the local runner supply a synchronous
`window.__abeleExternalMemoryBytes()` function returning current native resident bytes
for the application process. In particular, mobile JavaScript heap statistics exclude
ArrayBuffers and do not establish this bound. The test fails when the sampler is absent
or invalid; it does not skip or substitute an estimated buffer size. Native sampling
drivers and run artifacts remain local, outside this repository.

LIMIT: the current phone driver and host bridge do not expose native resident memory
for the application process or supply `window.__abeleExternalMemoryBytes`. The phone
resident-memory bound test is therefore an explicit `it.fails`; it does not establish
a passing phone memory bound. The separate 200 MiB transfer test runs normally on both
targets with every transfer assertion retained. Both tests share one round trip from
`beforeAll`, sampling only when a resident-memory sampler exists. Desktop runs both
tests normally. Once the local runner supplies the sampler, remove the expected-failure
marker and rerun the case on both targets.

The local integration matrix is not evidence that live phone memory or installation
passed. Completion still requires the supervising smart-check/build gate, these live
batches and the server's PostgreSQL gate with no backend skips. Record those results
separately from the focused plugin test result.

The attachment round-trip setup, maximum-size hook and teardown explicitly allow ten minutes.
Each remote round trip registers an AbortController and its settlement promise before
attachment work. Failure, timeout, afterEach and afterAll abort the operation and await all
issued hydration jobs before closing the host/database or deleting fixtures. Transfer duration
is logged on success and failure; all transfer and memory assertions remain. Cancellation
cannot interrupt an already-issued adapter write: teardown waits for its settlement.
Hydration forwards its signal to the download callback, rechecks cancellation before staging
and at mutation boundaries, and retains durable pending recovery state while releasing
runtime reservations after settlement. A download callback that ignores the signal is awaited
to completion before cancellation releases the reservation.
