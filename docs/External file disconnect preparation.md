# External file disconnect preparation

External attachment records previously caused an unconditional lifecycle refusal;
`materializeForDisconnect()` was a recovery-required stub. Preparation now uses the
same personal engine scheduler or scoped host queue as hydration and ordinary sync.
Core and protocol are pinned to committed revision
`b6d8066cc7a72ade3d1143985b6f0cd510e854e7`; the server fixture uses that revision too.
The plugin no longer calls the engine's private scheduler.

`SyncService.inspectDisconnect()` returns the inventory revision, required original
bytes and blockers. `SyncService.materializeForDisconnect({ operationId, signal })`
pauses automatic sync, persists `disconnect-preparing`, prevents further eviction,
and hydrates each active remote-only attachment through the existing version-bound
installer. Hydration runs outside the preparation queue slot and re-enters the same
queue itself. Preparation never recursively awaits sync or hydration while owning
that slot.

The final check verifies installed originals against their proven local bases,
checks retained artifacts, and refuses unresolved operations or projections. A
revision-bound readiness receipt and `disconnect-ready` phase commit together.
Disconnect, Forget, Leave, enrollment, Import and service connection changes use
the shared gate before revocation or replacement. The gate re-reads the receipt,
actual database identity, binding and local bytes; inspection alone grants no
permission. Offline, unavailable versions, occupied targets, cancellation, space
or approval failures preserve the connection and recovery inventory. A failed or
ambiguous install remains held rather than being retried blindly.

Deleted, detached and unavailable records remain in the inventory. This plugin
does not automatically select a historical version or perform server Restore for
them. Such dependencies require explicit recovery before departure. This is a
conservative limitation of the preparation API.

## Connection writes and retirement

Replacement over an activated personal connection records old and target
connections and ledger descriptors, then stores the replacement token in a
separate keychain slot. The record contains a fingerprint, never bearer tokens.
The old credential is copied into existing pending-revocation bookkeeping before
the target descriptor and connection are installed. Only confirmation of the
target binding permits retirement of the old active slot. Repeated enrollment and
Import use a fresh ledger even when the vault ID matches; external records are
not rebound to the replacement principal.

Application startup reconciles interrupted keychain, descriptor and connection
writes against the recorded target. Incomplete credential binding, changed
fingerprints, foreign descriptors and malformed records cause recovery refusal.
A missing credential is never interpreted as permission for an empty join.
Personal Disconnect and scoped Leave also record their local departure writes.

Activated predecessor ledger descriptors move into a device-local retired
inventory. Their database identities and recovery bytes remain protected across
startup. Retained artifact paths are held by the new representation classifier,
without adopting their old file identity. Delayed cleanup uses the same gate and
refuses database deletion while it still owns external records or artifacts.
Materialization is permission to leave, not permission to purge recovery bytes.
Consequently Forget can report retained database cleanup pending after departure.

Bare service edits do not provide a new credential enrollment proof and retain
the conservative activation-marker refusal. Use enrollment or connection Import
for credential replacement. Existing pre-activation connection behavior remains
unchanged.

## Verification

Synthetic tests cover preparation, revision-bound readiness, changed local bytes,
failure preservation, retained tombstones/access failures, reopened IndexedDB,
replacement writes and scoped departure writes. Lifecycle integration tests cover
successful personal Disconnect, repeated enrollment and Import after preparation,
alongside the existing unresolved-inventory refusals. A pinned real-server test
materializes before revocation and verifies that local originals remain readable
after the token loses access. The live attachment test also exercises preparation
on desktop and mobile adapters through the same explicit API.

The installer retains the established desktop create-if-absent link and mobile
staging/absence-check/adapter-rename contract. The accepted outside-writer mobile
installation and eviction races are unchanged. Application restart is covered;
arbitrary power-loss survival is not claimed.
