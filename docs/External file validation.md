# External file validation

Use the exact core/protocol revision in `plugin/vendor/sync/provenance.json`, not a
mutable server checkout. From `plugin/`, export the independent fixture:

```sh
node scripts/vendor-sync.mjs /path/to/sync-repository 75b84b5d3e83e119e9624b32a331e1827986342d fixture
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

The local integration matrix is not evidence that live phone memory or installation
passed. Completion still requires the supervising smart-check/build gate, these live
batches and the server's PostgreSQL gate with no backend skips. Record those results
separately from the focused plugin test result.
