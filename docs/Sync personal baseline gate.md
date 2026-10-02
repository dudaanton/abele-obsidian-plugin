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

## Online stand supplement and current phone blocker

An explicitly selected `personalStand.e2e.test.ts` fixture exercised a leased native desktop
against the existing HTTPS stand: synthetic note/binary creation and rename, an **unpaused**
60-note folder deletion held exactly 60 identities, bounded restore returned all 60, and a
successful committed response withheld before settlement survived plugin reload. The replay
was observed explicitly and the server head did not gain another version. This is stand
rather than disposable-server evidence, still not a native fleet pass.

A sibling connection was minted and encrypted for the authorized phone transfer flow; no
account password was passed to the driver. The phone was blocked before reading or importing
that transfer by a native local-network permission dialog raised during task 06. Home/launch
did not dismiss it. Permission was not silently changed. No phone enrollment or test data
was created. The unused sibling and desktop enrollment were revoked; the encrypted transfer
was removed, local fixture state restored, newly created local databases removed and the
pool lease released. Only the owned tidy synthetic namespace remains on the stand.

That permission dialog was absent on a later fresh driver session; this run did not select
either permission action and cannot establish what canceled it. The phone then completed the
actual encrypted transfer, Merge-both join and HTTPS connection. Owned note/binary creation,
rename and deletion reached the stand. A real phone-local approval returned a checked snapshot
without executing code, while the desktop still refused the exact received script for lack of
its own device-local approval. Both native approval and connected-status screens were inspected.

The long phone driver hit its bounded deadline after online operations; a fresh bounded cleanup
session verified the connected data and completed approval/cleanup. All five original local
values and workspace matched, ignore/marker absence was restored, only the owned root and two
new databases were removed, the phone disconnected with zero pending revokes and the backup
was removed after verification. Desktop state was independently restored and its lease released.

A later physical-iPhone offline/reconnect run used the authorized driver’s real airplane-mode
control. The phone and leased desktop first shared `one/two/three` baseline bytes. The driver
confirmed airplane **on**, Wi-Fi off and Abele Offline; it changed line one on the phone.
A separate coordinator saw the phone's offline-ready signal and changed line three on the Mac
while airplane mode was still on. The phone then turned airplane **off**, Wi-Fi on; its sync
returned idle with zero pending items, and both the phone and desktop read exactly
`phone/two/mac` in place. The existing daemon folder read matched those exact bytes. The
phone-local note stayed intact and was absent from the server's authorized manifest. It had
already existed at the start of that bounded probe, so this run does **not** claim it created
that private note while offline. No Pause substitution was used.

Airplane off/Wi-Fi on was verified before and after phone cleanup. The phone then revoked its
own test connection and restored all five prior local values, original ignore/marker absence,
workspace and original databases; owned local folders and new ledger database were removed,
and the backup was removed only after verification. Desktop restoration and lease release
passed independently. The server retained only the tidy owned test namespace.

A later bounded attempt to prepare a fresh phone sibling for lost-response and mobile-delete
checks did not complete its join. The temporary phone backup, local files/databases and Mac
fixture were restored, the pending sibling was revoked and the encrypted transfer removed.
Neither test is counted as run. The original physical-offline run and its verified cleanup
remain separate evidence.

Fleet settings/plugin-code confirmation checks and **phone** lost-response restart remain
**NOT RUN**. The unpaused burst and real-stand replay evidence above are desktop-only; the
phone does not stand in for those checks. The unavailable iPad remains an explicit hold.
A two-device online/offline supplement is not a three-native-device sign-off.

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
Pure plugin-local tasks 39 and 40 may be implemented/tested against the written contracts behind
an explicitly disabled fence, independently of server API availability. That does not enable
publication or satisfy any live fleet, cache or transport gate.
