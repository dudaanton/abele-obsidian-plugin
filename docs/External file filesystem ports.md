# External file filesystem ports

## Scope

The plugin now has minimal external-file effects and host coordination. There is no
production attachment-store caller, eviction control, automatic eviction or new UI. These
ports do not replace the later server verification, durable state machine, common sync
classification, restart recovery or lifecycle/materialization APIs.

- `plugin/src/sync/external/filesystem.ts`: portable effects over an explicit filesystem
  port, operation reservation and trusted intent/ownership guards.
- `coordination.ts`: portable identity/path reservations and active consumer leases.
- `ObsidianExternalFileHost.ts`: the thin adapter, all-leaf inspection and workspace events.
- `ObsidianFileSystem.ts`: ordinary engine mutations share the vault's reservation authority.

A host operation requires a supplied **engine-exclusive serialization port**. The host never
calls public `sync()` from inside it. Publication must happen outside exclusivity, followed by
re-entry and complete revalidation. The pinned personal engine currently keeps its exclusive
scheduler private; the attachment API composition must expose that scheduler through a public
core port. A service-only queue is not a substitute for it. The live tests exercise minimal
ports with a test-only scheduler, not full sync/attachment API composition.

Every external operation reserves its identity, original, projection, incoming and destination
paths. Reservations compare case/NFC keys and reject ancestor overlaps. Ordinary apply,
rename and delete take a ticket before their first await; a reservation cannot begin over an
unfinished mutation. Adapter and queued native effects also check the paths at invocation.
Existing installation recovery reserves the whole tree while inspecting its journal. A
reserved-path ordinary mutation fails `busy`; it does not silently skip a write and advance
its ledger. Watcher events are not globally suppressed. Classification and operation-specific
echo handling remain the following integration task.

## Open files and use leases

All workspace leaves are inspected, including nonactive image/PDF/non-Markdown leaves. File
view paths and view-state file paths count. `file-open`, layout and active-leaf events invalidate
an operation if a relevant file opens while it is pending, even if that leaf closes before the
final check. Leaves and consumer leases are checked again immediately before deletion.

Use acquisition and reservation start are synchronous under one coordinator. Acquisition
fails while the identity is reserved; a registered consumer prevents a reservation. Release
is idempotent. Closing a host releases only its own leases, not a successor's registrations.
Consumers re-register after restart; leases are not durable state.

## Intent and evidence

Before invoking an effect, the attachment state machine must supply synchronous guards backed
by the committed operation phase/revision, current binding/generation and the verified server
basis. Unknown, nested or aborted commits cannot produce that permission. The low-level port
requires an intent guard; it does not manufacture one from matching local bytes. No filesystem
or network work belongs in a phase transaction. The production host supplies its runtime fence
and effect tracker, so successors can settle already-issued adapter promises.

Staging is written only to a fresh hidden `.abele-external-*.incoming` operation-owned path
recorded before the write, with exact SHA/size. The caller must choose a unique incoming name
and persist its artifact reference. Existing staging is never rewritten on retry. Input bytes
are transferred for exclusive use until staging settles, without a defensive full-file copy;
written bytes are still reread and hashed. Download references are released before those
reads. Desktop verification uses one reusable 1 MiB native read buffer; mobile uses the
adapter's whole buffer with incremental SHA-256, avoiding WebCrypto input snapshots. The target is never written
with downloaded bytes. Initial projection creation uses the same staging/installation path;
an occupied sidecar is preserved, not replaced or renamed out of the way.

A failed write/install/remove acknowledgement may follow an actual filesystem mutation. The
result is `outcome-unknown`, carrying affected paths and artifact references; subsequent
effects through that capability are refused. Matching installed content is not recovery
provenance. The durable state machine must persist/retain the unresolved outcome and reconcile
it after reopen. Port results do not complete the journal themselves. Capabilities expire at
operation end, and already-issued effects settle before reservations are released.

These adapters have no conditional retirement of user-editable sidecars or retained staging.
`retire()` therefore returns `cleanup-pending` and leaves the artifact and reference intact,
even when bytes match. It never extends the accepted original-deletion race to arbitrary
recovery files. On desktop, a successful link retains the incoming name; later cleanup is a
separate recorded step. On mobile, rename consumes that name, but its journal reference is
not silently forgotten. Changed, occupied or ambiguous artifacts remain recovery evidence.

## Selected installation contract

**Desktop:** native same-filesystem `link(incoming, target)`. `EEXIST` preserves both files,
even when the occupant's SHA matches. No native rename or adapter fallback substitutes for
link. Missing link capability returns `unsupported-storage` for installation only. Native
installation and adapter mutations reconcile engine-owned writes with the host index.

**Mobile:** verified operation-owned staging, a final absent-target check immediately before
`adapter.rename(incoming, target)`, and rereading the installed bytes. The earlier preflight
check is insufficient: a target appearing during staging or before the final check is
preserved. Adapter rename also refuses an already occupied target. Never adapter copy,
`exists → writeBinary(target)` or native overwrite fallback.

**Accepted mobile residual risk:** an independent writer can create the exact target in the
instant between the final absence check (including the adapter's own check) and native rename.
The adapter does not expose atomic no-clobber semantics. That residual interval is accepted;
tests demonstrate preservation before the check and occupied-target refusal, not exclusion
of arbitrary writers during that instant. It is not a remaining native-component blocker.

## Selected original-deletion contract

The caller has already resolved publication, verified the exact live server version, committed
recoverable deletion intent and created/validated the projection. The minimal port checks
ownership, intent, open leaves and consumer state, rereads and hashes the original, then checks
ownership/intent/open/use state synchronously again immediately before `remove(original)`.
A SHA or size mismatch preserves the original. There is no journal commit or network await
between the final hash and removal. Removal errors or a recreated/remaining original produce
an unknown outcome and no reclaimed-byte claim. A confirmed successful removal reports only
the selected original's byte count, not filesystem free blocks.

**Accepted deletion residual risk:** an independent writer can edit/recreate the original
between the final hash and unconditional removal. This implementation does not prevent that
race or require descriptor locks, fsync, conditional unlink or a mandatory backup. The server
verification is point-in-time, not a permanent availability lease. Production deletion remains
disabled until the complete verification/recovery/classification/lifecycle gates are wired.

## Verification

Mobile staging uses sequential 1 MiB `writeBinary`/`appendBinary` calls when the runtime
adapter exposes `appendBinary` (public CapacitorAdapter API since 1.12.3). Each call receives
an exact bounded ArrayBuffer, with ownership, reservation, open/use and journal intent
checked before every write. Missing append support retains the whole-write fallback.
Partial writes or failed checks retain ambiguous staging evidence. Disk SHA/size checks
after staging, before installation and after installation remain in place; rename and its
final absence check remain unchanged. Incremental SHA-256 already avoids WebCrypto copies.

Mobile immutable blob and version downloads request sequential 8 MiB HTTP ranges. Personal
blob and scoped historical-version server routes support Range; vendored clients expose
only whole-byte results, so the mobile transport assembles one full buffer. Authorization,
abort and non-following redirect handling travel through the existing native transport.
Contiguous Content-Range, stable total and exact chunk lengths are required. A server that
ignores the initial Range retains the whole-response fallback. Final server-verified SHA
and size remain authoritative. No server code is changed.

For file size F and download chunk C = 8 MiB (staging remains 1 MiB), download and staging
payload reachability falls from
F plus a whole base64 string (about 2.33F with one-byte strings, 3.67F with two-byte strings)
to F + O(C). An additional whole bridge/string serialization copy could previously raise
that to roughly 3.67F–6.33F; its presence is runtime-dependent. These are allocation models,
not resident-memory measurements. Mobile `readBinary` still reads the whole file and may
hold its base64 response while decoding: the remaining expected peak is about 2.33F–3.67F,
plus unknown native copies and GC lag. Thus the conservative one-string overall bound is
unchanged; the improvement removes repeated whole-file download/write bridge pressure.
The public mobile adapter has no bounded binary-read API. Caller and staging effect release
the download reference before any verification read; spies check sequencing and bounded
bridge arguments, but cannot prove garbage collection or native memory reclamation.
An 8 MiB download chunk cuts a 200 MiB transfer from 200 requests to 25 while keeping bridge
temporaries independent of file size. Live mobile batching and native resident-memory
sampling remain required.

`plugin/tests/integration/externalFilePorts.test.ts` covers nonactive leaves, pending-open
invalidation, leases/teardown, supplied exclusive serialization, engine mutation reservations,
final hash/ownership checks, occupied/new targets, final mobile absence checks, desktop link
boundary collisions, staging verification, lost acknowledgements and cleanup retention.
Existing ordinary writer/native safety and strict filesystem-probe tests are unchanged.

`plugin/tests/e2e/externalFilePorts.e2e.test.ts` runs the actual selected ports against live
desktop and mobile adapters with unique synthetic fixture directories. It checks real image
leaves, leases, reserved apply/rename/delete, mismatch preservation, successful original
removal, free-target installation, target appearance during installation and ambiguous
installation evidence. No real server round trip or restart attachment recovery is claimed
by these minimal-port tests. Device drivers, locks and run artifacts stay outside the repo.

Observed verification: 65 focused fast checks passed (28 new port/coordination cases and
37 existing writer/probe cases). The selected live-port suite passed all five cases on
desktop and all five on mobile, without skips. The initial image-leaf fixture requested two
empty tabs before populating either; Obsidian reused the empty leaf. The fixture now opens
the image before requesting the active note tab, retaining the original nonactive-image
and pending-open assertions. Queued reservation intake also has a regression: caller-owned
path arrays are copied before waiting, so mutation cannot redirect a queued reservation.

The historical `External file filesystem probe.md` copy-overwrite assertion remains a failing
mobile regression: unsafe adapter copy was not fixed, adopted or reclassified as acceptable.
Application restart durability belongs to the existing durable-state tests; arbitrary power
loss, mobile flush and exclusion of independent processes are not claimed.
