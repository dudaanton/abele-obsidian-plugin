# External files

External files keep attachment storage local to each device. The server still stores
ordinary files; it does not store a device's eviction or pin policy. One device can
keep `Media/sample.bin` while another keeps only `Media/sample.bin.abele-ref`, a
small metadata projection. The projection is not the attachment's content and is
never uploaded as an ordinary file. Intentional absence of the original does not
publish a server deletion. Remote edits update the known version without downloading
attachment bytes. Remote rename, deletion and restore preserve the file identity and
recovery inventory; deleted or inaccessible files remain dependencies.

This stage exposes explicit attachment APIs, not a new screen or automatic eviction
rule. Selective sync remains a separate participation policy. Code and settings retain
their approval requirements. The file-size limit is **200 MiB**, or
`200 * 1024 * 1024` bytes. Downloads use full-file buffers, without streaming, Range
requests or resumable transfer. Eviction does not reduce server quota or extend history
retention. An observed historical version may expire.

## Eviction

Evict only an attachment that is not being edited. The API finishes ordinary
publication, refuses open, pinned or in-use files, verifies the exact live server
version and actual decrypted size/SHA, reserves paths against this runtime's sync,
and persists recovery intent before creating the projection. It hashes the local
original again immediately before unconditional removal; changed bytes preserve the
original. A successful eviction actually removes the local original. Reclaimed bytes
exclude retained full copies and uncertain deletion outcomes.

An independent program can write the original between that final hash check and
removal. This last edit can be lost. The previously verified server copy remains
subject to ordinary access, deletion and retention rules. Verification is a
point-in-time check, not a lease against later edits, deletion or revoked access.
Scoped readers and editors must explicitly acknowledge the warning that revocation
can prevent downloading an original unless that device still has a copy.

## Hydration

Hydration selects a version, verifies the server proof, downloads its content and
checks size and SHA before and after staging. It preserves an existing original,
including an occupant with identical bytes. It never installs projection JSON as
attachment content. A stale requested version is refused rather than silently
downloading a newer one. Scoped downloads never fall back to personal authorization.

Desktop installs through native `link`, which atomically refuses an occupied target.
Mobile writes an operation-owned staging file, checks target absence immediately
before adapter rename, and uses an adapter that refuses an occupied destination.
Another writer can create the target in that final check-to-rename interval; this
residual race is accepted. Mobile does not use `copy` or a check-then-write fallback.
These platform guarantees differ; mobile rename is not an atomic no-clobber primitive.

Hydration retires an unchanged owned projection into recorded quarantine. Completion
means the original is installed and the visible placeholder retired; small quarantine
files and desktop staging links can remain as recovery evidence. Changed or ambiguous
artifacts remain held. An explicit hydration can supersede a same-path metadata refresh
only when the old projection is unchanged, staging is absent, and there is no unknown
outcome. Moved, changed and uncertain work continues to require recovery.

## After a crash

1. Reopen with a compatible plugin and keep the existing connection, database,
   activation marker, projections and operation-owned files. Startup recovery runs
   before ordinary scanning and mutations. Re-register open consumers and use leases.
2. Inspect attachment snapshots and recovery results. A recorded delete intent with
   a missing original and matching projection can finish remote-only bookkeeping.
   A reappeared original is preserved. Unknown installation or deletion outcomes
   never authorize a blind retry; matching bytes alone do not prove installation.
3. For an active remote-only attachment with no unresolved operation, request explicit
   version-bound hydration. If offline, out of space, denied access or facing an
   occupied target, resolve that condition first. Keep unexpected local bytes and
   conflicting sidecars separately while reviewing them; do not delete evidence to
   bypass recovery.
4. A deleted, revoked or expired version is not guaranteed to be downloadable.
   Check authorized server history or another device's retained original. The plugin
   does not automatically choose a historical version or restore a server-deleted
   file during disconnect preparation. Unresolved cases remain blocked for explicit
   recovery. There is no general quarantine/staging purge API in this stage.

## Disconnect, Forget and downgrade

Disconnect, Forget, scoped Leave, repeated enrollment, Import and connection replacement
share a durable safety inventory. Explicit materialization pauses automatic sync,
stops new evictions, downloads eligible active originals and verifies a revision-bound
ready receipt before credentials or state can be cleared. Inspection alone is not
permission. Offline, no-space, version, approval, access and recovery failures preserve
the connection and inventory. Tombstones, lost access and retained evidence do not
disappear merely because a file is unavailable. See [disconnect preparation](External%20file%20disconnect%20preparation.md).

Before the first eviction, IndexedDB schema version 2 and an activation marker outside
the database fence old normal startup. Missing state with a marker or projections
blocks empty bootstrap. These fences do **not** prevent an old binary's direct Forget
or Leave from deleting its database, or an old CLI's force-init from deleting its ledger.
Those commands are unsupported on an external-enabled local tree. Materialize and
resolve dependencies using a compatible client before downgrading; retain a complete
local backup of originals and recovery state. A schema bump is not protection against
direct database deletion.

Implementation details: [attachment API](External%20file%20attachment%20API.md),
[filesystem ports](External%20file%20filesystem%20ports.md), and
[durable state](External%20file%20durable%20state.md).
