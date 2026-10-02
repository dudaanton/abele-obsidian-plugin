# Personal baseline activation gate

Task 14 is **PARTIAL / BLOCKED**, not a three-native-device pass. Desktop phone emulation,
a daemon or a prior build's device report cannot replace native-device evidence.

## Recorded inputs

- Initial plugin recovery fix: `03f8daab` on the concept branch.
- Reviewed-safety follow-up build: `4f3dbaaf`, including late-receipt rename retirement,
  durable unfenced-backup intent, uninterrupted execution generations and legacy connection
  normalization. Running-engine receipt regression additionally recorded at `0352ffeb`.
- Pinned core/protocol/server/daemon fixture source: `68bb5bb893a98d2ec89b86cdc511805be6f7d229`.
- Read-only stand inventory: source revision matches that pin; health endpoint answered OK.
  No stand content, deployment, daemon lifecycle or credentials were changed by this run.
- Physical phone inventory through the authorized driver: current test-build marker verified;
  native Obsidian 1.13.7 (build 365), iOS 26.5.2, nonvirtual device. Its test sync UI is
  unconfigured. A separately usable test iPad was not available through that driver.
  A fresh physical-phone check on the safety follow-up build confirmed the same prerequisites
  and passed the synthetic native trust supplement below; enrollment/network/stand data were
  not changed.

Private device/vault/endpoint names, driver session paths and raw evidence belong in the
untracked developer report, not this document.

## Acceptance matrix

| Required evidence | Current result |
| --- | --- |
| Three independent native personal installations: desktop, iPhone, iPad | **BLOCKED** — no usable iPad; phone inventory only |
| Full create/edit/rename/delete and joins across all three | **NOT RUN** across native three-device fleet |
| Physical iPhone offline concurrent shared/private edits and reconnect merge | **NOT RUN** |
| Lost committed response plus restart, no duplicate history/content | Native desktop/disposable-server supplement passes; native fleet/remote stand case **NOT RUN** |
| Interrupted native mobile replacement retains target/backup and resumes | Deterministic adapter regression evidence only; physical case **NOT RUN** |
| Unpaused native file/folder-delete burst, no loss or resurrection | Existing automated guards; native three-device case **NOT RUN** |
| Settings/plugin code separate confirmation on personal fleet and daemon | Existing automated guards; current native fleet/daemon command gate **NOT RUN** |
| Device-local script approvals never authorize another native installation | Model/gate, native desktop IDB and single physical-phone approval evidence; cross-installation/native fleet case **NOT RUN** |
| Every retention/quota mutation password-gated | **BLOCKED** — hardening integration task 07 is a prerequisite; known baseline only gates a narrower subset |
| Quiet convergence and continued personal sync with group worker stalled | Desktop/daemon quiet cycles below; native fleet/active-group-worker case **NOT RUN** |

No activation is authorized by a partial matrix. Missing prerequisites remain failures/holds,
not silent skip or success.

## Desktop/daemon supplement

`tests/e2e/personalBaseline.e2e.test.ts` runs a disposable revision-checked local server,
this branch's actual native desktop plugin in a leased pool vault, and the pinned daemon.
Only a unique synthetic namespace is synced; original ignore/connection/ledger/provenance
state is restored afterwards, and generated fixture processes/directories are removed.

The supplement checks:

- exact-path create/binary/rename/delete convergence;
- concurrent desktop and daemon edits preserved by personal in-place merge;
- a committed response withheld from the old runtime across plugin restart, recovered with
  the journal's same idempotent outcome and no extra versions;
- matching content hashes and no new versions during quiet cycles.

It is explicitly labelled **desktop/daemon supplement**, never an iPad/iPhone substitute.

```sh
cd plugin
OBSIDIAN_TEST_VAULT=<leased-pool-vault> ABELE_SYNC_DIR=<prepared-matching-fixture> \
  npm run test:e2e -- tests/e2e/personalBaseline.e2e.test.ts
```

## Single physical-phone trust supplement

Through the authorized driver on the safety follow-up build:

- Supported legacy connection without `enrolledUrl` activated native provenance successfully.
- The real native approval dialog returned a checked exact-byte snapshot; a second load
  required no new confirmation. No script body was executed.
- Native rename, old-path recreation with identical approved bytes and a simulated late
  receipt preserved the source hold and moved identity. The old-path load was refused.
- Pending hold and native IndexedDB close/reopen did not permit that receipt to restore
  old-path authority.
- Original connection/provenance/marker state was restored exactly; only the owned synthetic
  folder and newly created database were removed. Cleanup reported no failures.
- Approval path/hash/source and both actions were visible without clipping in the inspected
  native screenshots. Sync remained visibly unconfigured after cleanup.

This is a single-device storage/UI supplement, not a real server push, physical offline
merge, cross-device approval isolation or three-device stand gate. The real-server running
engine late-receipt regression is separate integration evidence. Device screen sleep was
requested successfully, but the post-sleep capture did not conclusively verify screen-off.

The remaining task-14 matrix is unchanged: native fleet operations/joins, physical offline
merge, remote lost-response restart, native mobile crash interruption, fleet delete bursts,
settings/code/approval isolation, complete password gating, and stalled group-worker
availability must still be supplied. No usable native iPad was exposed.

## Ordered continuation

Task 15 requires v4 server/protocol feature fences and parser instrumentation in the server
stream. Current plugin artifacts remain pinned to the hardening baseline; this worker cannot
change another worktree or activate newer scoped contracts implicitly. Obtain reviewed
server/protocol inputs and complete the native/management prerequisites before claiming that
stage's gate. The following server authority/migration runs likewise remain outside this
plugin worker's fence, not work silently performed against a sibling. In the numbered plan,
15–31 are server/protocol authority and migration runs, 32–34 the core adapter; downstream
plugin runs (owner sharing, synced-link snapshots/publication and scoped join/creation UI)
require those reviewed contracts. They cannot be claimed implemented by reinterpreting
server row 15 as a different plugin-only task or by activating an unreviewed sibling build.
