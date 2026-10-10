# Deleted-test ledger addendum

Destination requested: `~/projects/plans/abele-sync/2026-10-10-deleted-tests-ledger.md`. That path is outside this worker's writable workspace; append these rows there after review.

| File / removed part | Reason and surviving coverage |
|---|---|
| `plugin/tests/e2e/externalAttachmentApi.e2e.test.ts`: v1 scoped/device fixture, `/v1/blobs`, legacy scoped warning and v1 request-count assertions | Retired `SyncClient`, account/device/grant routes and scoped-warning mode. File retained and ported to production token/v2 engine: authenticated eviction/hydration, concurrent download deduplication, exact read/hash, materialization before disconnect, revoked folder authority, 200 MiB transfer and resident-memory ceiling. |
| `plugin/tests/unit/agentStandHarness.test.ts` | Retired sponsored/scoped v1 agent stand, `absk_` credentials, deployment switch and pending image gates. This is unused fixture coverage, not current token-agent production. Current credential/provenance fences are tested in token fixtures and `syncLiveServer.test.ts`. |
| `plugin/tests/unit/collaborationStandHarness.test.ts` | Retired v1 grant/group preparation routes and `ABELE_SCOPED_SHARING`. Production v2 group sharing coverage remains in token sharing/asset/transfer suites. |
| `plugin/tests/e2e/helpers/agentStandHarness.ts` | Unused server/CLI assembly for removed v1 agent stand; no live callers remain. Current pinned server helper is `syncServer.ts`. |
| `plugin/tests/e2e/helpers/collaborationStandHarness.ts` | Unused alias of the removed agent stand assembly; original live stand tests were already deleted in P21. |
| `plugin/tests/e2e/helpers/collaborationPeers.ts` | Unused generated peer program importing removed `SyncClient`, `ScopedState`, `createScopedClient`, `pullScoped`, `pushScoped`, `scanScopedChanges`, and old `absd_`/`absi_` tokens. Current peer exchanges use `TokenSyncLive`. |

`externalRepresentation.e2e.test.ts` also retains every test, now using token bindings and ordinary v2 engine scan/state ports instead of removed `ScopedState` / `scanScopedChanges`.

Other surviving coverage was ported, not removed: staged plugin code uses `EngineClient`; native desktop transport request shapes use v2 endpoints; range/memory tests use v2 immutable file-content endpoints. OpenAI-compatible `/v1/chat/completions` paths remain: they are unrelated to sync.
