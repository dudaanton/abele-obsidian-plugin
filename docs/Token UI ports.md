# Token sync UI

The Sync settings compose the shared Obsidian kit. Token paste and camera/photo QR
reading require an explicit Connect action. Token validation uses `/v2/connection`
before a new local record is created. A retry resumes an interrupted pending binding.
Only the device secret port receives the key. Disconnect stops the selected runtime,
removes its local credential and record, and keeps files and other connections.

The plugin installs `tokenUi` once, with its token registry, non-following native HTTP
transport and separate device review store. UI observes shallow state refs; native
database and runtime objects are never made reactive. Settings and workspace dialogs
share this controller. A workspace file-open event calls `opened(path)`; background
indexing and receipt do not call it.

## Core adapter ports

The installed archive predates `V2EngineClient`. The core binding is documented in the
server/core repository's `docs/core-v2-engine.md`; refreshing the pinned inputs and
connecting production engines remains separate work. Do not install a legacy fallback.
Until a runtime is bound, Sync now and executable approval are disabled and the settings
explain that file exchange is unavailable. Group exchange also depends on the core/server
group implementation; the UI must not turn `scope_updating` into a successful sync.

Bind one `TokenUiRuntime` per local connection ID with `ui.bind(id, runtime)`. It owns:

- `sync()` and `pause(paused)`: delegate to the one retained engine for that connection.
- `disconnect()`: invalidate and drain its effects before metadata or credentials retire.
- `apply(candidate)`: apply exactly the immutable reviewed operation under the existing
  path coordinator, preserve concurrent local work and original mtime, and handle restart
  idempotently. Never re-fetch a newer version during approval.
- `resolve(localFileId)`: resolve a stable local identity; a same-path replacement is a
  different file, and another connection's server ID is not a local identity.
- `opened(path)`: return only previously observed group-note identities and authoritative
  sources for that opened note. Reading this mapping must not invent permission or upload.

Update the registry's connection status and call `publish(id, activity)` for last successful
sync time, progress counts, refusal paths and plain reasons, and conflict-copy paths. This
also refreshes pending reviews. Set `ui.openFile` to the host file-opening port. Do not
report completion while any retained upload or held item remains. Last successful time
is device-local; no raw token or ledger identity travels with settings.

Sharing uses stable IDs from the authorized paged manifest, including note IDs as group
selectors. The current selector is available for forwarding existing access or another
root device. The server decides whether issuance is contained. The token list is exactly
the caller's server-authorized revoke list, including other participants' tokens for a
root owner. Issued text/QR live only in the open dialog. Revocation requires a second,
explicit action and never claims that local recipient files were removed.

## Review and evidence

Code review displays source, received time, original mtime, operation and immutable bytes.
It approves/rejects only the displayed candidate ID. A newer candidate stays pending.
Attachment questions explain file, connection and future-edit permission. Closing defers
the question; it remains available in settings. Decisions go through the existing durable
per-file/per-connection consent port, including identity revalidation.

The development-only `TokenUiFixture` uses isolated synthetic in-memory state, no host
credentials or file writes. `openDialog` exposes `sync-connect`, `sync-connect-token`, `sync-connect-error`,
`sync-connections`, `sync-empty`, `sync-share`, `sync-share-token`, `sync-review`,
`sync-attachment`, `sync-states` and `sync-disconnect`. The phone layout tier includes them.
Live device batches remain distinct from desktop phone-sized CSS inspection. Retired
access-screen assertions are retained as `it.fails` with `BUG:` notes until their old
fixtures are expressed through token ports; their bodies are not deleted or weakened.

## Removed screens

Removed ConnectCard, DeviceList, JoinVaultModal, OwnerPublicationSettings,
UsageCard, VaultPolicy, GroupSharingModal, InitialAssetBatchModal,
OwnerFolderSharingModal, ScopedCreationModal and ScopedInvitationModal.
Their login, vault selection, invitation and reader-role flows are replaced by
the token controller and native dialogs. Shared generic sync machinery remains.
