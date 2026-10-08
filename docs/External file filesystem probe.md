# External file filesystem probe

## Decision

**Blocker: neither tested adapter supplies the complete external-files cleanup contract.**
A hash comparison followed by `remove(path)` can discard a later write. Moving first and
hashing again preserves a changed copy only if that copy is retained; it does not make its
final deletion safe. The desktop local-save queue does not exclude an already-open native
handle or an independent process. iOS exposes no descriptor lock, conditional unlink or
flush API through `DataAdapter`.

Do not enable completed eviction or report reclaimed space on this evidence. Keeping
backups is an honest `cleanup-pending` result, **not** satisfaction of the stage's phone
space-reclamation criterion. A stronger storage capability or a revised approved contract
is needed before implementation continues past this gate. No production behavior or UI
was changed by this probe.

## Observed guarantees

These are live adapter observations, not promises about every filesystem or app version.
The public SDK inspected is `obsidian` 1.13.1. Synthetic fixtures only were used.

| Required guarantee                                              | Desktop                                                                                                                                                                                                                                            | iOS                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detect every write between hash check and removal; lose nothing | **No.** Deterministic `hash → save → remove` loses the edit. `hash → save → move → rehash` detects it and retains bytes. The final backup-cleanup race still loses bytes.                                                                          | **No.** The same three interleavings produce the same results.                                                                                                                                                                                                                              |
| Refuse an occupied installation target                          | **Yes with native `fsPromises.link`.** `EEXIST` preserves both files; a successful install retains the source name and shares its inode. Public rename/copy also refused a pre-existing target in this run; `exists → writeBinary` overwrote it.   | **Not a complete atomic install contract.** Public rename refused a pre-existing target, but its implementation checks `_exists` before a separate native rename. `copy` **overwrote** the occupied file despite the SDK's no-overwrite contract. `exists → writeBinary` also overwrote it. |
| Refuse a busy file independently of path occupancy              | **No.** Native rename replaced a target with an open descriptor. Public rename moved an open editor's source. An engine use lease is still required.                                                                                               | **No.** `copy` overwrote an open editor's target. Public rename moved its source; the editor stayed writable. Occupancy refusal is not a use lease.                                                                                                                                         |
| Write through an already-open descriptor after move             | **Yes, demonstrated.** The descriptor changed the backup inode. A later write after the cleanup hash survived only through the unlinked descriptor; closing it left no recovery pathname.                                                          | **Not testable through the adapter.** No descriptor read/write/close interface is exposed. The undocumented `open` delegates to a native bridge and returns no handle; it was inspected, not invoked. A live editor did save to the moved path.                                             |
| Atomic rename/replace                                           | **Native same-volume rename is the available replace primitive.** An open reader kept the old inode while the target name held the replacement. It overwrites occupied targets and is not an exclusive install. Public rename refused replacement. | **No exposed atomic replacement contract.** Public rename refused replacement. The two-rename fallback has an observable missing-target gap; a new occupant there prevents the second move. Native bridge crash/atomicity guarantees are not exposed.                                       |
| fsync/durability                                                | **No public adapter flush.** Optional native file `handle.sync()` and directory `handle.sync()` both completed on the tested volume. No power-loss guarantee was tested.                                                                           | **No exposed flush/descriptor/directory-sync API.** A resolved adapter promise is not proof of power-loss durability.                                                                                                                                                                       |
| Open editor/leaf behavior                                       | The same Markdown leaf followed adapter rename to the moved path. A subsequent editor save changed the moved file; the original path stayed absent.                                                                                                | Same behavior. A backup name is not protected merely because it belongs to an operation.                                                                                                                                                                                                    |

The iOS copy implementation directly queues native `fs.copy` without a destination check;
the native bridge overwrote both the ordinary occupied target and the open editor's target.
Removal likewise queues an unconditional native delete, with no expected-content argument.
These are adapter constraints, not production changes made or fixed by this task.

Both adapters' private `queue` serialized a real adapter save behind a held callback.
That proves cooperative serialization only. Calling queued adapter operations from inside
that callback would re-enter the queue; it is not a portable critical section for native
file effects. Public `process` is text read/modify/write, not a conditional deletion API.

## Sequence that can actually be claimed

**Complete eviction, both platforms:** refuse as `unsupported-storage` before destructive
file effects. There is no demonstrated sequence ending in deletion of the last retained
local copy that meets the required exclusion guarantee.

The tested reversible experiment is exactly:

1. Hash the original with SHA-256.
2. Move it with `adapter.rename` to a fresh operation-owned test path.
3. Hash the moved bytes and inspect whether the original path is occupied again.
4. Report `local-changed`, `source-occupied` or `cleanup-pending` as appropriate.
5. **Keep the moved copy and any recreated original. Never infer deletion permission from
   equal hashes; report zero freed bytes.**

This experiment is not a production port: it does not supply durable phase commits,
connection ownership, use leases or exclusion of independent filesystem writers. A write
after the final hash can escape that comparison; retaining the copy prevents its loss.

**Desktop installation only:** verify an operation-owned incoming file, use native
`link(incoming, target)` as the create-if-absent action, refuse `EEXIST`, then verify the
installed bytes and journal the result. Do not substitute native rename for exclusive
installation. Retain the incoming name until a separate cleanup contract authorizes its
removal. Busy/use-lease checking and crash recovery remain separate requirements.

**iOS installation:** do not use `copy` as exclusive installation. Adapter rename's
pre-existing-target refusal is useful only within its cooperative-writer boundary; this
probe does not establish a filesystem-wide no-clobber primitive or a complete safe path.

## Executable evidence and checks

- `plugin/tests/integration/externalFileSafetyProbe.ts`: test-only portable experiments;
  the identical function bodies run against the fake vault and inside each live page.
- `plugin/tests/integration/externalFileSafety.test.ts`: deterministic saves before move,
  after move, after the final backup hash, source recreation and occupied backup refusal.
- `plugin/tests/e2e/externalFileSafety.e2e.test.ts`: live adapter, queue, editor, native
  descriptor, install and flush probes. Fixtures have unique owned folders; teardown closes
  their leaves, deletes only those synthetic folders and restores the workspace layout.

From `plugin/`, run the focused fast checks:

```sh
npx vitest run tests/integration/externalFileSafety.test.ts tests/unit/nativeFsSafety.test.ts tests/integration/obsidianFsWrites.test.ts
```

Run the live file against an isolated development-build desktop vault, for example:

```sh
OBSIDIAN_TEST_VAULT=sample-vault npx vitest run --config vitest.e2e.config.ts tests/e2e/externalFileSafety.e2e.test.ts
```

The real-phone run must use the external batch tier and its device lock. Device/pool drivers,
lock locations and run artifacts are deliberately not part of this repository.

Verification: focused fast tests passed (37/37 across 3 files); desktop live tests passed
(6/6); the phone run had
4 passes, **1 reproducible failure** (`copy refuses an occupied installation target`), and
1 desktop-native descriptor test skipped because its required interface is absent. The
no-clobber assertion is deliberately left red, not weakened or marked expected-failure.
The failure reproduced in the batch's initial run, shared retry and isolated retry.
`build:test`, staged repository/privacy guards and `git diff --check` passed. Full suite and
lint were not run. No power interruption, iOS native descriptor experiment or filesystem-wide
writer exclusion could be verified; these limits are part of the blocker, not inferred passes.
