# Vault data

The shape of every kind of note the plugin owns: which `type` marks it, which properties it
carries, and where new ones are put. Dates are `YYYY-MM-DD` and times are `HH:mm` unless said
otherwise; a note that breaks that is a note the plugin will read wrongly.

Note frontmatter reads use `js-yaml` 4's default schema. An unquoted time such as
`time: 12:30` stays a string through property updates; leading-zero integers such as
`0755` are decimal (`755`), not legacy octal. Quote a numeric-looking value when its
exact text, including leading zeros, matters.

## Device-local connection trust

The node panel keeps comparison-base refs per worktree in its device-local presentation
snapshot. These choices survive panel reloads and do not grant chat access or change Git.

Connection trust is an optional, default-off `trusted` flag in the device-local
`abele-sync-connections-v2` registry. Only the connection window changes it; settings
tools and transfers do not expose it. Trusted connections automatically approve incoming
executable reviews and linked private attachment questions. Scope, size limits, server
refusals and held-delete reviews still apply. Automatic actions appear in the connection log.

Stopped local chat turns retain a visible system message in their transcript. Approved tool
rows retain the arguments actually executed, including content edited during approval.

## Device-local external-file state foundation

Folder connections retain a device-local `rootIssue` in their connection registry when the
root is deleted or moved locally. Child events share that one stopped state; they do not
authorize server deletions. Explicit restore requests a fresh snapshot. Explicit follow
stores `localRoot` in the device-local connection registry. The server selector and ledger
paths stay unchanged; filesystem access maps those paths into the selected local folder.
This placement survives reconnects and does not travel with a sharing token. Legacy unresolved
server-move evidence at `plugin:scope-root-follow` keeps recovery stopped rather than being
replayed or discarded.

Device-local placement changes refuse overlap with another connection's effective reserved
root. Explicitly connecting overlapping scopes and restoring them remain supported. A stopped folder continues tracking later
moves. Follow scans the destination independently of the watcher: it requires exactly the
known file and folder set, with no extra or missing entries. Known files may contain edits.
A retained, validated offload sidecar counts as its known file; its recorded identity, version,
hash and binding must agree. An invalid sidecar is an unknown entry. Refusal keeps sync stopped
and reports counts of extra or missing entries, including after restart.
External-file state and server receipts retain canonical paths too; their filesystem effects,
reservations and local UI paths pass through the same placement mapping.

The sync ledger reserves a schema-1 external-file document at `plugin:external-files` in its
IndexedDB `meta` store. The SQLite adapter uses `daemon:external-files` in the existing CLI
ledger. The ledger can now classify existing external records during ordinary personal and scoped
sync. Native file/folder/selection actions and commands expose confirmed offload, pin toggling and
download without opening. Per-connection device-local rules store folder, extensions, minimum
bytes and unopened-day filters under a separate local-storage key; applying always requires a
fresh file-list preview and confirmation. Last-opened timestamps are device-local too; unknown
ages are excluded from age rules. No background policy runs.
Device pin intentions also live in a separate local-storage inventory, survive connection
pauses/replacement and follow ordinary file/folder renames.
The device-local `abele-sync-ordinary-retained-v1` inventory records the size and SHA of
unchanged, completed-operation evidence moved into private retention. It suppresses recovery
Notices only while those bytes still match; unknown or changed copies remain visible recovery
work. Empty recovery directories do not produce a Notice. Retention never deletes these bytes.
Reader, gallery, canvas and agent
content reads can hydrate absent originals; listings show original paths, size and offloaded
state. Offloaded paths open an information card, and reading/live-preview embeds show a
local image preview or file row. Only explicit download actions fetch an embed's content;
rendering and hydration do not rewrite the note.
The `abele-external-previews-v1` app-local cache holds at most 128 JPEG data URLs, each
at most 56 KiB encoded and 512 pixels on the long side. The optional projection `preview`
field references a cache entry by SHA-256; `offloadedAt` records the local offload time.
Previews are never separate vault files or sync inputs. Missing previews fall back to a row.

Records bind to the local ledger, normalized endpoint, vault, personal/scoped mode, principal,
grant, connection generation and credential association. They separate local representation
(`hydrated`, `remote-only`, `pending-download`), availability (`active`, `deleted`, `detached`,
`unavailable`), pin and device preference from existing selective-sync participation. Server
heads remain in the ordinary personal/scoped ledger. Earlier proven local bases, retained
artifact references and revision-checked operation phases are device-local recovery data;
they do not travel in settings, manifests, transfers, server device records or projection JSON.

On storage without bounded local reads, streamed receipt and hydration hash acknowledged
append chunks and check the resulting size before publication. Their write identities and
file stamps remain in process memory, never in the ledger or journal. Changed stamps,
uncertain writes or a process restart invalidate that evidence: existing bytes then require
ordinary verification. Without bounded reads, unknown local files above 50 MiB refuse
non-upload whole-file reads while retaining the original and any recovery artifacts. Unknown large staging
bytes still refuse bounded-only recovery above 50 MiB. This
read fallback does not cap streamed receipt or hydration; selective-download limits still apply.

Native unfenced publication retains displaced inodes in a device-local recovery directory
beside the vault, outside its indexed tree. The preserved-copy journal stores their absolute
local locators. Exclusive hard links keep late writes through existing handles recoverable;
publication removes the vault alias. Interrupted archival retries the deterministic locator
and checks inode identity before unlinking an alias. These locators never travel with settings
or sync. A recently published path continues to use disk metadata until the asynchronous
Obsidian index agrees, so a stale row cannot become an apparent local edit or deleted-file echo.

The reserved projection format is `abele.external`, schema 1, at most 16 KiB UTF-8. Its
`.abele-ref` sidecar contains only vault/file identity, logical path, observed version, SHA-256,
size, MIME, mtime and optional media dimensions/duration. Strict parsing, placement and local
ownership are separate: foreign, recognizable moved, malformed or changed projections are
held; a known damaged path remains protected. An unrelated `.abele-ref` is an ordinary file.
Durable commit receipts require actual database completion; unknown outcomes require reopening
and inspection. No memory-store fallback or arbitrary power-loss guarantee is provided.

The plugin's generic IndexedDB ledger schema is version 2, preserving the version-1 rows while
rejecting old version-1 normal opens. Device-local `abele-sync-external-activation-v1` holds
preparing/active bindings and database-instance identity outside the deletable ledger;
`abele-sync-external-generation-v1` associates canonical identity/credential fingerprints with
connection generation. `abele-sync-runtime-owner-v1:<database-name>` is a cooperating runtime
claim, not a filesystem lock. `abele-sync-external-inspection-v1` caches bounded projection
inspection by physical path, size and mtime. It is device-local optimization data, not account
adoption or publication authority. Changed candidates are reinspected; files above 16 KiB are
not read. Departure borrows an existing claim rather than replacing it, so refusal retains
its retryable runtime. Retained `abele-sync-external-connection-switch-v1` evidence is a
recovery hold until its recorded credential and descriptor writes are reconciled. Explicit
disconnect preparation materializes active attachments, verifies local originals and retained
artifacts, then commits a revision-bound external-disconnect-ready-v1 ledger receipt. The
device-local abele-sync-external-retired-v1 inventory preserves predecessor ledger descriptors
and artifact ownership after departure or staged replacement. These records do not travel in
settings or transfers. Tombstones, lost access and uncertain installations remain blockers;
readiness never permits purging retained recovery bytes.

Verified hydration commits `external-installation-v1:<fileId>` plugin metadata alongside its
acknowledged installation phase. The proof binds the installed path, version, size and SHA
to the ledger, generation and hydration operation; it does not replace the historical proven
base used for retained-artifact provenance. Disconnect checks use this current installation
proof. Retired ledgers continue to require readiness and intact recovery artifacts, while
ordinary originals handed to a replacement connection may be edited or renamed.

Startup inspects external, installation and publication journals before constructing the
personal engine or enabling scoped watchers/replay. Projection-update/move, tombstone and detach
jobs for activated, bound ledgers are recoverable per file; eviction/hydration and unknown
inventories remain connection-wide holds. A remote metadata event creates a revision-checked
projection job and advances the ordinary head in the same IndexedDB phase commit, before
cursor progression. Scoped heads remain in scoped state; its checkpoint advances only after
the job and head have persisted. A restart can hold or resume the recorded job without
receiving that event again. An unexpected original retains its earlier proven local base.
An occupied/changed projection stays in `cleanup-pending`; it is never treated as a create,
rename, upload or deletion of the original. Saved representations and operation artifacts
stay device-local, never in settings, transfer data or projection JSON. Effect guards recheck runtime ownership, durable descriptor and credential/
generation at state, filesystem/native and HTTP boundaries. Destructive lifecycle operations
use a shared inventory and existing error handlers; unresolved dependencies cannot authorize
revoke, token/descriptor replacement or database retirement. Activated connections remain
conservatively protected until explicit disconnect preparation exists. Old direct Forget/Leave
can still delete IndexedDB without opening it; the surviving marker makes a new client refuse
empty bootstrap, not magically undo that unsupported old deletion.

## Selection-script menu settings

Plugin `data.json` stores independent ordered lists at `reader.selectionScripts` (books) and
`ai.chatSelectionScripts` (chats). Both use `{script, name, icon}` entries: `script` is the
library header name; empty presentation overrides use the script name/header icon, then
`scroll-text`. List membership pins the script to that surface. Missing or invalid lists
normalize to empty; empty names and duplicate script entries are dropped, keeping the first.
Missing library scripts remain stored but are not offered until available again. Settings
entries override presentation and order on their own surface; unlisted `@book` or
`@chat-selection` opt-ins follow alphabetically on that surface only. Removing a settings
entry does not disable a header opt-in. Book choices travel with the Book reader transfer
section, chat choices with Script settings. Neither list contains credentials or grants trust.
Configuring these lists or pinning in the searchable script picker writes no message annotations
and never executes a script. Launch on saved user/assistant messages and nested discussions
captures the owning session and source evidence before menus/forms. After admission and form
completion, validation initializes legacy identities/versions and ensures a durable selection
anchor before execution receives its backlink. Cancelling the initial form or declining review
writes no selection metadata. Once execution begins, its anchor may remain even if the script
later stops or fails. Ordinary execution leaves message Markdown and provider history unchanged;
note creation is ordinary output, not automatic binding. Explicit `selection.bind(actualCardPath)`
is the separate opt-in decoration operation described below.

## Device-local GitHub comparison bases

`abele-github-comparison-bases` in Obsidian's vault-scoped local storage is an array of
`{origin, owner, repo, enteredRef, baseSha}`. Origins retain scheme and port; repository owner
and name are canonicalized case-insensitively. `baseSha` is the immutable commit resolved and
confirmed when pinning, not a branch/tag that is followed later. Pins are independent of the
account used to read their repository. This is device-local reading context, not synced plugin
settings, settings-transfer data, a vault sidecar, or the separate synced pinned-repository list.

Forgejo bases in this same array additionally retain a `source` identity with provider,
connection, normalized deployment and repository. Their keys use that identity, including the
deployment subpath and account, rather than the legacy GitHub origin key. Their `origin` retains
the full deployment base. Restart validates and whitelists the identity; these rows cannot be
read as GitHub bases. GitHub bases keep their existing account-independent keys.

Workspace GitHub-tab state may store `originalFile: true`, a per-tab escape that leaves the
repository base pinned. Resolved targets and displayed comparison/selection provenance are
runtime-only. Immutable trees, blob text and endpoint indexes/counts are bounded session-memory
caches scoped to credential generation and repository identity, with separate caller capability
guards. Credential retirement clears them. No persistent private-source cache is added.

## Node path views (device-local)

Disconnecting a device revokes its own node credential before removing the local registration
when the node advertises device disconnection. Other devices are unaffected. An older or
unreachable node offers explicitly disclosed local removal instead; its credential remains on
the node. A failed revocation request or lost acknowledgement keeps the local registration,
without automatically enrolling a replacement credential. Reloading or closing a socket does
not revoke credentials or detach debugger sessions.

Chat tool records retain explicit provider file locations and the resolved node/project/target
of node file calls. These are presentation references, not access grants. Folded calls keep
their file paths visible; opening a node path uses its remote place, never vault resolution.

The Node drawer and its main-area file, history, chat and code-editor leaves retain only
registration/node/project IDs, an opaque workspace or worktree target, relative file paths
and session IDs in the workspace layout. They never store node credentials or claim chat
permissions. File navigation is bound to the leaf target, not the current drawer selection.
File leaves also retain their staged/unstaged origin or a committed origin with its full base
ref in layout state. A committed file reopens as a merge-base comparison against HEAD, using
the node's captured patch rather than working-tree bytes. Its base stays with the file when
the drawer changes its comparison.
Debug source mappings may also retain the requested line number so a source opened from a
recorded step or breakpoint list reopens with that line highlighted.
The Debug leaf retains its selected folder target, selected session and up to 256 known session
IDs, plus at most 256 source IDs, relative paths and session incarnations in layout state and
the device-local `abele-debug-selection` preference. Up to 256 watch expressions across those
sessions are retained too, without their evaluated values. Values are read again at a pause.
This also restores observation when a
mobile layout omits the previous desktop leaf. Reopening observes the
node's retained sessions; it never starts or reattaches a program automatically. Source mappings
are used only while their session and incarnation still match. Breakpoint locations retained
in memory can be carried to an explicit attach to the same program and inspector port; source
admission and normal breakpoint approval still apply.
The device-local `abele-debug-launch-arguments:` preferences retain argument text per node,
folder and program for the next explicit launch. They are not sent until the owner runs it.
Source mappings retain their owning session ID, and at most 256 opaque attachment identity
hashes retain the association with a process/inspector across reload without storing its command.
Selected file or comparison text can be quoted into a chat draft with its relative path, line
range and comparison side. Ask here creates a node chat bound to that file's target; Add to
chat uses an explicitly chosen Obsidian chat. Neither action sends a provider turn or grants
Obsidian chat scope. Drafts show a readable source citation and quoted text, not serialized
routing metadata. Quotes use the existing chat-draft stores, not a new selection cache.
A bounded `abele-node-path-cache:<registration-id>` local-preference snapshot retains the
last received drawer metadata, selected target and the loaded pages of its file tree across
restart (at most 1 MiB). Target metadata can include its registered root, full workspace path,
and root/managed/external role. If an opaque target ID disappears, only a unique catalogue
match within the same node, registration and project, with the same root, path and role,
recovers the panel selection. Older snapshots can recover a repository root from its folder
metadata; a worktree basename alone is insufficient. Missing or ambiguous matches require
explicit selection. Recovery reads the current target afresh and never changes session bindings
or grants. Unexpanded folders are not captured; this is not a complete repository
index. Pagination cursors, working observations and active read progress are session-local and
are not restored from that cache. It contains neither credentials, file bytes nor chat authorization and never claims
that a retained agent is still running. Loaded file text is additionally retained in a bounded
4 MiB session-memory cache for offline reopening. History and editor drafts keep their existing
lifetimes; reconnect reloads mutable state without replacing drafts or frozen commit views.
Registered repositories reported as unavailable remain visible as unavailable folders rather
than failing the entire catalogue. Their retained file observations are discarded. The panel
offers the existing confirmed project-unregister action, which removes only the registration,
never files or leftover local data on disk.
`abele-node-local-state-dir` and `abele-node-device-name` are device-local discovery/enrollment
preferences. An edited paired TLS route is stored separately as `transportUrl`; the signed
canonical endpoint, node pin and non-extractable device key remain unchanged.

`abele-node-path-seen` in local preferences records the last successfully opened observed
change ID by node, target kind, target ID and relative path (bounded to 4,096 entries).
It is device-local, not a settings-transfer field. A newer change arriving during loading
remains unread. Owner folder/worktree operations keep `nodePathIntents` in the existing
installation-local node client IndexedDB state until a typed receipt is known. Reopening a
folder picker reuses an unresolved operation's original parent handle, request and ID; it
never guesses that an operation ID alone means the filesystem effect succeeded.
A definitive `stale_resource` mkdir refusal retires only that failed logical intent. The
picker refreshes its parent handle, preserves the requested child name and waits for a new
Create action, which gets a new operation ID. Disconnects, timeouts and unknown outcomes
retain the original operation and parameters for reconciliation. A successful mkdir keeps
its created path in the logical intent until registration succeeds, so retrying registration
does not create the folder again. Directory handles and cursors are never persisted;
reconnection discards them along with mutable target observations, pagination and watches.
Stale target reads refresh the catalogue and retry once only for the same target identity.
A replaced target or stale session binding requires explicit reselection; recovery never
rebinds sessions or transfers execution/editing approval.

## Node repository tabs (device-local)

The shared repository leaf (`abele-github`) stores a discriminated `sourceTarget` in Obsidian's
workspace layout. Existing GitHub URL-only leaves still load. Node targets contain a registration
ID, installation ID, project ID, opaque worktree ID and an explicit home/file/folder/commit/
comparison location. A node leaf also retains its project/workspace display title for an offline
restart. Paths are relative; credentials, node URLs and chat grants never enter tab
state or repository links. Frozen commits retain their resolved IDs. Live Working tree aliases
observe afresh after restart; links to captured bytes include their retained content ID and
working observation. An expired observation/content returns an error, never silently reads the
current file under the old identity.

Forgejo repository tabs use a version-1 `sourceTarget` with provider, exact deployment web/API
bases, stable connection ID, full repository path, native web URL and optional observed commit.
Tokens and keychain slots are never stored in tab state. Removing or rebinding a saved Forgejo
connection leaves the tab unavailable until a connection is explicitly chosen; it does not
silently replace that account. Connection records continue to use `github.connections`, and
their existing provider fields and secret references travel through settings transfer.

Node comparison bases use the existing device-local base store with a source identity; they are
isolated by installation/project/worktree rather than display labels. Repository tab reads keep
at most 4 MiB of decoded content in a source-local LRU and bounded revision/link metadata in
session memory. Node content and per-file patch retention belong to the daemon. External-access
revocation clears the source and pending publications; reconnect requires mutable refresh.
Human-opened tabs grant no agent access. Current working files use the shared durable editor
inside the repository tab. External worktrees start read only; the node retains one explicit
owner editing approval per opaque worktree identity, revoked by the native tab toggle or project
external opt-out. Drafts/receipts stay device-local, and external changes report changed-on-disk
rather than replacing an active draft. Chat edit proposals use separate per-edit owner approval,
retain only a local draft and still require an explicit human Save.

## Device-local template approvals

`abele-template-trust` in Obsidian's vault-scoped local storage holds template confirmations.
It extends the script trust-state schema with `templateHashes`, the SHA-256 hashes of every
explicitly confirmed template version. Identical content may reuse approval at another path;
confirming a different version never removes an earlier version's approval. The `scripts`
mapping still keeps the last reviewed hash and text per path for review diffs (text is omitted
above 100,000 characters). Existing single-version records seed the history when loaded.
For user note templates, the reviewed text includes the full file, the prepared body and the
actual output type, callbacks, path fields and target properties used at application time,
so lagging metadata cannot run unreviewed settings. Prompt templates keep the full file text.
These are explicit approvals only: existing templates, local writes and agent writes are not
implicitly trusted. No vault sidecar or setting is added. Records are not synced or included
in settings transfer, and the optional script-trust switch does not control template approvals.
Notice deduplication is session memory only and lasts only while a review notice is connected;
a dismissed notice can be shown again on the next blocked application.

## Device-local note positions

Vault-scoped local storage `abele-note-places` keeps each note's scroll, cursor and optional
footer-row anchor by note path. An anchor records its row key and top offset in pixels. A
partly scrolled-past row also records its positive `height`, so restoration holds its visible
trailing edge while lazy content replaces a shorter placeholder. Older anchors without height
continue to align their top. These positions are device-local, not note contents or synced files.

## Local agent attention

Chat metadata may contain `attention`: an explicit run identity, timestamp, target message and
`running`/`interrupted`/`done` status; approval request timestamps keyed by request ID; an explicit
question identity, text/options, current index, saved answers and waiting/interrupted/answered/cancelled
state; and failed-run records with unique identities, text, target message and optional `seen` flag.
These records live in the existing `.abchat` metadata log and survive compaction. A stopped run
failure is separate from a tool error handled by the agent. Older files without this evidence
are not inferred to have failed. Loading does not execute tools or model requests; saved local
work and questions without a process are interrupted, not working. Pending tool calls continue
to use the existing approval mechanism. Seen flags acknowledge only their specific failure;
presenting a chat acknowledges its saved failures, while background loads and closing do not.
The chat uses the ordinary error block with Retry, not an additional failure attention card.
`resolved` is a monotonic array of retired request/run identities. `tools` records accepted calls as executing/interrupted/done; acceptance
is saved before a tool starts, and an accepted call found without its process is not re-offered
as a new approval. The approval path captures the call ID and a deep JSON snapshot of its
arguments before awaiting persistence; execution never re-reads a different queue head.
A vanished or changed request cannot transfer that permission to the next call.
Complete metadata records retain positive resolutions across later stale
snapshots; ordinary fields remain last-wins. Compaction keeps those resolution identities.
A Seen action stages its acknowledgement in the write snapshot, leaving reactive state and
index evidence unchanged until the file confirms the decision. Stale approvals/questions/run
references may also be explicitly dismissed: the same resolution-ID write commits before the
ledger entry is removed. No conversation file is deleted and no tool is executed by dismissal.
A later successfully completed local run retires the accepted-but-interrupted tool identities
captured at its start; a failed, paused or aborted run does not.

Obsidian vault-scoped local storage `abele-agents-index` holds a small array of conversation
references and reason/request/run IDs, timestamps, expiry and target message references. It
contains no conversation text, question text, titles or error text. It is an evidence ledger:
live arrivals are unioned into it, and only a disk-confirmed resolution or proven file deletion
may remove an identity. It loads before publication, including node-registry publication.
The device-local `abele-agents-started-at` timestamp is written once before the first inventory,
including upgrades from an index without this cutoff. Errors and interrupted work older than
that baseline count as seen in this list, without changing chat files or deleting ledger evidence.
Waiting questions, pending approvals and incomplete coverage are not hidden by the cutoff.
Mark all as seen commits acknowledgements for all listed local failures/interrupted work, not
only search matches; questions, approvals, working sessions and node coverage remain untouched.
Startup inventories all `.abchat` files, including unopened discussions, without making sessions.
The separate device-local `abele-agents-revisions-v1` cache records verified mtime/size pairs,
terminal IDs, accepted-tool phases and an exact signature of the indexed reasons, including
quiet files. Unchanged files reuse the ledger; changed or unverified files are read sequentially
in idle time. Neither cache holds titles, question/error text, tool arguments or transcripts.
Changed inventories invalidate cached discussion ownership hints; opening still uses the storage
identity gate. Vault-load create/modify events are ignored before startup, and later events are
coalesced per file. Large attention projections run in a disposable worker where available;
the portable fallback yields between log chunks. Discovery does not assemble transcript arrays
for log-format ordinary chats or normalized discussions. Identity normalization retains the
existing checked writer, including full legacy-format migration. Explicit refresh still rechecks files.
Missing fields do not resolve indexed approvals/questions/runs/errors; such rows remain uncertain.
Read-only discovery checks the existing safety copy for a damaged main file, without
repairing or removing either copy. Backup-only or still-unreadable states retain their pointers
as uncertain and do not retire entries. Renames move references before I/O, never delete and rebuild.
Live projection may show an accepted tool as work, but transient projection cannot retire evidence.
External file changes update open holders read-only; file writes preserve disk-confirmed decisions.
Opening a row does not write reconstructed index data back into the conversation.
The index is device-local and does not travel in settings transfer.

Discussion identity belongs to committed file metadata: `{ commentId, commentLocation }`.
The location is an exact canonical vault-relative path, not a basename. An anchored `kind: chat`
is still a discussion. New discussions commit a fresh ID and their location before publishing
markers. A self-located file retains its ID; a location mismatch means a copy, even when its
declared original is absent. Preparation commits the copy's own location and deterministic
`fork-v1-<hex SHA-256>` ID before discovery or opening can expose it. The hash input is UTF-8
JSON of `["abele.discussion.fork", 1, sourceId, canonicalPath]`. Repeated preparation changes
nothing. Messages and unrelated metadata are retained; legacy JSON is encoded as a complete log.

`ChatStorage.prepareDiscussion` is the mandatory gate for direct session loads, tab restoration,
discovery, migrations and writes. Its metadata transform compares exact revisions, rereads a
concurrently changed file, and publishes nothing from a failed normalization. Storage serializes
preparation and writes on the same file. The gate returns the exact verified bytes as well as
the parsed snapshot; a checked discussion append or rewrite compares those bytes, never a
later unverified read. Background summary backfill and manual note attach/detach use this same
gated, revision-checked metadata transform, including for anchored `kind: chat` and legacy JSON.
A changed incoming self-located identity supersedes local observations; obsolete session writes
are fenced until the whole snapshot is reconciled.
Concurrent conversation edits are conflicts, not an identity tie-break.

Only disposable, revision-tagged `path → identity` and `ID → set of paths` indexes are retained.
Old local `abele-discussion-locations` and aliases are ignored. A metadata-only inventory reads
each changed file revision once and retains self-declarations for duplicate detection. Vault
create/modify/delete/rename events invalidate affected observations; unchanged files require no
transcript rereads. Cold inventory/discovery is linear in file count, and a warm discussion save
reads only its own file. ID opening/deletion checks the inventory and validates the exact
candidate; file-link openers address the supplied file through the gate, never its basename.
A rejected legacy normalization caches its conflicting owner-set signature as well as the file
revision. Removing or re-identifying a competing owner permits a fresh lookup without restart.
There is no filename fallback and no basename alias.
Duplicate self-declared owners are conflicts, never first-writer-wins. Legacy discussions can
retain their stored or historical basename ID only at the old canonical marker path (including
an old path established by a trusted rename event). A legacy file with a stored ID can be
normalized as a copy when an actual discussion at that ID's canonical marker path establishes
the original owner. Other legacy files require explicit identity resolution; neither scan order
nor local storage establishes ownership. Unresolved legacy/duplicate identity does not hide
stored attention evidence: it remains visible as incomplete, without a published ID binding.

A trusted rename attaches its old logical path synchronously to the file's pending preparation,
including when discovery or a save is already reading it. Preparation normalizes at that old
logical path first, then commits the retained ID at the new location. Each successful intermediate
normalization advances the pending logical checkpoint, so consecutive trusted moves do not
re-identify an original or fork an already normalized copy again. Only exact paths select
sessions. Vault deletion invalidates and closes only the deleted file's owner, without flushing
it back to disk. **Deleting an original leaves its markers
broken**; a remaining copy cannot open or be deleted through them. Explicit restoration of the
same persisted identity can restore those links. File-link replacement of a contextual discussion
loads and prepares the target before handing the prior contextual tab back. That released slot
can be reused at the tab limit without closing ordinary chats or stopping the prior discussion.
Concurrent opens share file I/O, not caller freshness: each waiter has its own request token and
validity check. Completed contextual tokens are removed rather than restored, so a later
attention-list open cannot inherit a completed file link's contextual policy. Contextual release
also uses a per-session presentation generation. Every open/reveal of that session advances
its generation before deferred I/O; each contextual operation carries the generations it was
allowed to release through preparation, shared loading and final showing. Releases recheck
that generation after saving, and every deferred presentation step rechecks the same lease.
Late shared-load joiners therefore cannot retry a release superseded by a newer open.
Registration and caller freshness are checked again before removal or selection.
A superseded release is terminal for the participating contextual opens, including plain file
links with no selection guard. Its cancellation propagates through tab hand-back and the file
opener, so it cannot retry with a new token; independent shared-load waiters remain unaffected. These identifiers travel in chat files, not
settings or secrets.

Boundary: bytes alone cannot distinguish an unobserved move from a copy followed by deletion.
Without trusted provenance, a location mismatch forks. Identity-preserving synced renames must
provide final location metadata and the move as one logical revision; reordered intermediate
states need a sync adapter's pending/conflict protocol, which ordinary vault events do not
provide. The regression for that missing protocol remains an explicit expected failure.
Deterministic `(source ID, path)` identifies a fork slot, not successive independent copy births;
distinguishing those requires a synchronized birth token. Local indexes do not solve either.
This is not multi-device arbitration for local tool approvals.

## Node sessions (device-local)

Node history is owned by the daemon journal, not vault Markdown or `.abchat` files. A message
that replies to places is sent and journaled as the links block over the words, and read back
from it for display; the plain text box of a node chat shows each place as a `[↩N]` marker with
its numbered chip above the field. The
plugin never runs local tools for a node tab. Obsidian's vault-scoped local storage holds
`abele-node-installation` (local namespace UUID), `abele-node-registry` (installation
registration id, label, endpoint and pinned node identity; paired registrations also retain public key coordinates, public node fingerprint and installation ID), and the discriminated
local-chat/node-session layout in `abele-agent-tabs`. None of these travel in settings
transfer or `data.json`. Tokens use device-local keychain slots `abele-node-<registration id>`
and bypass the synced secret catalog even when it is unlocked.

Paired private keys live only in origin/device-local IndexedDB `abele-node-keys-device`,
version 1, object store `keys`, keyed by stable node ID. Each record structured-clones a
non-extractable ECDSA P-256 CryptoKey, public coordinates, endpoint, node fingerprint and
optional installation ID. Pending `enrollment` retains the invitation secret and label only
here for lost-response recovery. Its optional `claim` stores the acknowledged installation,
device fingerprint and pending/confirmed claim state for that exact invitation. Remembering a
new invitation resets this receipt; an old registration/installation ID never proves that the
new claim reached the node. Legacy enrollments without a receipt remain explicitly retryable.
Confirmed connection clears only the captured invitation ID, endpoint, node fingerprint and
acknowledged installation/device fingerprint; stale completion cannot clear a newer enrollment.
Web Locks serialize
all windows sharing this namespace; cryptography happens outside short atomic IndexedDB
commits. Devices lacking these facilities refuse pairing. Nothing here is a vault file,
JSON setting, synced secret or transferable configuration. Removing a registration leaves
its key/history intact for re-pairing; actual revocation is node-owner controlled. Node pin
changes require explicit out-of-band owner verification, never automatic recovery. An endpoint
change with the same pin has its own explicit owner-verified action and transactional comparison
of the previous endpoint/pin; it preserves the device key and principal.

Local enrollment uses IndexedDB `abele-node-<local namespace>-<registration id>`;
paired history uses `abele-node-paired-<node id>-<installation id>` so same-principal
re-pairing retains receipts/cursors without sharing them with a new principal. Both use
version 1, object store `client`. Its `state` record holds pinned node/installation identity,
stream cursors, cached journal events, immutable operation outbox entries and durable receipts.
Optional `chatDrafts`, keyed by session ID, retains unsent composer text and a quiet offline
submission note. Drafts survive closing a tab and reloading; they are not outbox entries and
are never sent automatically on reconnect. Only an explicit Send admits a turn, and admitted
text is removed from the draft without overwriting newer edits. Optional `turnDrafts`, keyed
by operation ID, retains the exact submitted composer bytes while a guarded turn's receipt is
unknown. These bytes are not another sendable draft. A terminal target refusal restores them
to `chatDrafts` with a no-send notice only when there is no newer draft, then removes the retained
submission. A successful receipt removes the retained submission without restoring it. Target
refusals never enqueue a fresh operation or automatically resend text. Observed node chat targets
may carry an opaque session-binding `incarnation` in device-local tab layout and presentation
snapshots; it is neither a path nor a Git revision and grants no authority.
Optional `delegation` in this same transactional `state` stores delegation task requests
and stable parent/task identities, the exact create request body, child links and last observed
status. Legacy stored delegation grants are ignored without a migration prompt. `awaitingResult` arms parent delivery when creation is reserved. After a follow-up,
`followupMailboxSeq` records the previous mailbox head so an old terminal event cannot settle
the new turn. The card's bounded child transcript uses the existing session window; branch
and changed-file summaries are replaceable in-memory projections. Parent IDs use the existing durable `chatId` metadata identity (allocated with a
checked chat save before delegation), never transient tab IDs. Reopening/renaming retains
it; the ordinary chat-copy flow creates a new identity and does not copy authority. Only that
public chat identity is in vault metadata; delegation task keys and mailboxes remain
installation-local/node-side.
Mailbox journals use independent stream IDs/cursors, not child session cursors. Delegation
receipts retain their request identity for recovery after a lost response. On startup registered
node connections resume mailbox delivery without needing an open chat tab. The parent card is
a replaceable projection of durable mailbox events, so replay/reload cannot append a second
result. Reports stay device-local (not appended to the parent's `.abchat`); `node_delegation_status`
returns their bounded summaries to the parent model on request. Complete child history stays on
the node and opens as a normal node chat. Revocation cancels active tasks but retains files,
workspaces and transcripts. Grants are node-authorized and device-bound: no new secret,
transfer entry, synced setting or vault file is introduced. Clearing local storage loses the
plugin's task links/caches; it does not stop children or erase node history.

Optional `artifactData` caches parsed normalized provider payloads by artifact ID for offline
projection after reload; it does not replace journal references or advance cursors. Old state
records without this cache remain valid. Project/workspace/job state, trust, repository Claude
permission opt-in, workspace leases and native provider resume identities belong to the node,
not plugin settings or vault files.
Workspace file bytes and immutable diff snapshots also belong to node storage, identified
by workspace/content/diff IDs. Open read-only views and unsent review comments are tab-local
memory, retained while the node chat presenter lives; they are not vault files, settings,
or a persistent file cache. A submitted `review.submit` batch enters the existing IndexedDB
operation outbox with its immutable anchors and comments; reconnect retries that operation
identity. Review receipts, rejection labels and the resulting journal/input are retained by
the existing stores. No new settings, secret identifiers or transfer entries are introduced.
Optional `fileDrafts`, keyed by the JSON pair `[workspace_id, relative_path]`, stores a text
editor's original content identity and text, current unsent text, save status, immutable pending
operation ID/body, and retained result/error. It stays in the installation's IndexedDB `state`,
not settings transfer, synced secrets, vault Markdown or agent context. Baselines and saves are
bounded at 32,768 UTF-16 code units; unsent drafts may grow to the retained-content limit without
being silently discarded when save admission refuses them. A save identity/body commits locally
before outbox admission; source recreation resumes exactly that operation. Each shared
`[workspace_id, relative_path]` draft has a revision UUID, migrated transactionally for old
records. Repository-target drafts use `['repository', worktree_id, relative_path]` in the same
`fileDrafts` map, isolated from legacy workspace drafts. Their immutable pending bodies and
receipts use `worktree_id`; shared draft CAS and uncertain-operation retention are unchanged. Editing, rebase and discard compare that revision; save also verifies the exact visible
text and base identity before queuing that snapshot. Different models/windows cannot silently
replace each other's draft or submit text that their editor did not show. Failed-CAS private
text stays visible for copying; passive dialog reopening does not discard it. Explicit reload
refreshes shared drafts after network reads and local writes, and programmatic code restoration
never becomes an editor change. Synchronous validation failures use the same copy-warning and
save/reload fence as storage failures. A binary/oversized current file cannot hide retained text. File receipts retain
optional `request` method/params so client ID/body reuse is checked after settlement too. Known
conflicts can be explicitly rebased against a freshly loaded version; uncertain drafts retain
their identity/evidence and cannot be blindly edited, discarded or resubmitted. Node pre-write bytes, node-state recovery references and mutation receipts belong to the daemon.
Recovery references are not workspace-relative files: new copies are read with
`workspace.recovery.read`, and explicit `workspace.restore` has its own operation identity and
fresh current-content precondition. Physical copies have a 32-file/16-MiB per-workspace quota,
including uncertain writes; oldest copies can expire while immutable receipts remain. Existing
files are written in place, retaining their access metadata; new-file writes require an explicit
null base and exclusive creation. Save/check completion cannot adopt a newer shared revision
without its corresponding shown text/base. Historical read snapshots keep their separate
retention policy. Catalog file-change
invalidations are refresh hints, not authoritative contents. No new settings, tools or transfer
entries are introduced.

Prompt-answer receipts additionally retain optional `answer` metadata (session identity, prompt
identity and the submitted allow/deny choice), including terminal rejections. This is committed
with outbox removal, so a tab or plugin reload cannot offer another answer while journal
resolution is still pending. Older records without the metadata remain readable; pending
outbox entries and older successful prompt receipts also identify prior answers.
Events and cursors commit together before acknowledgment; the outbox commits before sending
and is removed only alongside a durable result. Rejected send receipts retain their session
identity and original text for an explicit local rejection card, including after an offline
replay and reload; they never become accepted journal messages. Unknown valid journal records remain cached.
Removing a connection forgets only its local preference and token; it neither deletes daemon
history nor revokes the daemon credential. Retained caches are installation-local, not encrypted
at rest, and are not canonical history. Re-enrollment uses a fresh cache namespace.

## ZIP archives

Agent `zip` stores an ordinary binary `.zip` file at the explicitly requested new path, creating
missing parents through normal vault APIs. There is no archive sidecar, new note type, settings
schema or source mutation. Entry names describe virtual archive hierarchy, not vault scope.
The successful tool result and rewind record refer to the saved output. ZIP outputs are
not added to the chat touched-file list, which still includes only Markdown and scripts;
packing does not fabricate text diffs or mark source contents as read by the model. Rewind
records only the invocation's own writes, including prepared ZIP creation. Failed/stopped construction saves
no partial ZIP; parents already created before a later failure may remain. See `tools` topic
**ZIP archives** for selection, permission, byte preservation and resource contracts.

## Note columns

An ordinary `abele-columns` callout contains two or more direct `abele-column` callouts.
Metadata `ratio=2:1 mobile=stack` gives one positive weight per child; omitting the ratio makes
them equal. A parent-quoted blank line separates children. `mobile=stack` preserves written
order on narrow panes; `mobile=keep` keeps a horizontally scrolling row. The text-and-aside
insertion template uses `ratio=2:1` and marks its second child `abele-column|role=aside`.
An aside shows its native callout heading (or “Aside” when no heading was supplied); main
column titles remain hidden. `mobile=aside-first` stacks asides before the main columns,
retaining source order within each role. `mobile=aside-collapse` stacks in written order
and initially folds each aside under its heading on panes up to 500 px wide. Click/tap the
heading, or use Enter/Space while it is focused, to expand it. Folding is ephemeral view
state, not a source mutation. Wide panes always show the complete aside.
The column menu can change a column's role and select any of these narrow-screen policies.

Print/PDF export restores the written order and configured proportions, expands all asides,
and omits layout/folding controls. Code and table cells wrap for paper instead of leaving
content outside a horizontal scroller. Screen stacking and collapsing do not hide exported
content. The ordinary Obsidian PDF export command works with this record.

Each column supports native lists, tables, code, inline/display math, images, attachments,
note embeds and clickable tasks, plus Abele galleries, Mermaid diagrams, maps and charts.
Wide tables and code scroll within their own block, not the surrounding prose. Galleries
inside rendered columns are read-only (their images and viewer still work); edit the source
to change them. Diagrams, maps and charts size to their column and respond to its resize.
Their resources belong to the render, including asynchronous results arriving after a
Live Preview widget has been replaced. Without Abele the same source remains nested quotes
and ordinary callouts, with all content retained.

Insertion, add/move, proportions and removal commands modify only the Markdown frame.
Removal retains body content, deeper quotes and explicit titles. There are no new properties,
sidecars, settings or transfer keys. The renderer never rewrites source. Unknown parent
metadata, mismatched weights, folding or extra parent content retain native callout rendering.
Source-mutating commands require a strictly accounted-for frame and revalidate its source
range before serializing; unassigned parent content, foreign/collapsible sibling callouts and
code examples are not admitted. Rendered callouts receive source line ranges from the native
quote-tree grammar before strict admission. Rejected ranges are not removed from identity
binding, and any DOM/source or range disagreement refuses the operation.
Code fences close only with a matching delimiter and whitespace-only suffix. Cursor commands, rendered controls and mutation revalidation share one target resolver:
the innermost quote-tree frame is resolved before strict admission, including rejected nodes.
Rejection never falls outward. Both source-range endpoints must equal the strict frame's,
so unsupported lazy continuation is refused. Established DOM bindings cannot be reassigned
after node reordering, including reordering before the first lookup. Identity is captured in
the early post-processor from its original section, never established by a menu or prose click.
Live Preview supplies the full source snapshot and original range before invoking Obsidian's
Markdown renderer; plain task markers retain their render-time source positions. Missing
render-time provenance refuses controls. Frame discovery walks the quote-tree nodes with
normalised callout names read from each node's own first paragraph, not its full container
line. Frames with any non-quote syntax ancestor are not admitted, including frames separated
from a list item by wrapper quotes. Between the cursor and the chosen frame, only
that frame's own direct column quotes are transparent; plain or foreign callouts, extra
quotes and quotes inside lists refuse the command rather than selecting an outer frame.
Every mutation independently verifies the original line prefix profile before serialization.
Leading indentation and retained quote-prefix spacing are copied exactly, not rebuilt from
quote depth; prefixes that cannot be reproduced consistently refuse the write. The surrounding
quote is retained on supported nested-frame removal.
See the writing guide for commands and editing limitations; there are no column agent tools.

## Presentations

`type: presentation` marks an ordinary Markdown note that opens as a deck. Deck frontmatter
stores `aspect` (`16:9`, `4:3`, `9:16`), optional `theme` (a vault CSS wikilink or `default`) and
optional `transition` (`none`, `fade`, `slide`). Slide markers can enable `steps` for list reveals
or override `transition`. Navigation steps and the presenter timer are ephemeral, not stored.
Standalone `---` lines split slides outside properties and code; `***` is a horizontal rule
within a slide. A slide may start with `::slide{layout=split bg="[[sample-image.png]]" dim=0.4}::`.
Region markers are `::left::`, `::right::`, and `::cell::`. Speaker reminders are ordinary
`> [!notes]` callouts retained in the note but excluded from audience rendering. Links in these
notes derive source counts and a final Sources slide in memory only; no appendix or source-count
metadata is written into the note. Fenced `css`
blocks store deck styling. `slide-script` fences store named-script parameters and refresh policy;
`slide-html` fences store HTML. Optional `htmlNetwork: true` requests interactive HTML network
permission, not an approval itself. Vault-scoped device local storage keeps a boolean under
`abele-slide-network:<deck path>`; allow, deny and dismissal are remembered, do not sync or travel
in settings transfer, and a renamed deck needs a new decision. Pending decisions and activation
lifetimes are ephemeral. Nothing is written to a side file. Agent deck edits keep this same
Markdown format; fit reports are transient. A slide `screenshot` stores a PNG in the ordinary
attachments folder and includes its path in the tool result, as other agent images do. It does
not change slide source or device-local network consent. See `slides` for the full codec.

## Canvas diagrams

Diagrams stay ordinary JSON Canvas `.canvas` files, with `nodes` and `edges`. There is no sidecar.
Only standard node `type` values are written: `text`, `file`, `link`, `group`. A semantic shape is
still a text node. Shapes use Advanced Canvas `styleAttributes.shape`: `rectangle`, `pill`,
`diamond`, `parallelogram`, `circle`, `predefined-process`, `document`, `database`. Borders use
`styleAttributes.border`; edge path/arrow styles use `styleAttributes.path` / `styleAttributes.arrow`,
with `pathfindingMethod` and floating-end fields retained. Groups retain `collapsed`; file nodes
retain `portal` and `subpath`. Standard `file` paths and text-card links follow Obsidian renames.
Precise routing stores world-space bend points as edge `abele.waypoints: [{x,y}]` and an optional
caption centre as `abele.labelPosition: {x,y}` (`null` means automatic). Native side anchors and
pathfinding fields remain present; native Canvas can ignore these extensions without losing the
standard connection. Obstacle routing computes and stores bends at edit time; rerun it after moving
cards. Fit-to-content writes ordinary node dimensions, with no measurement cache or sidecar persisted.

Free-line `labelPosition: {x,y}` stores an optional world-space horizontal caption centre at the text baseline; omitted or null uses the segment midpoint. Moving/scaling the line transforms an explicit label position with it.

Free lines/arrows are root `abele.lines` entries: `{version:1,id,from:{x,y},to:{x,y},fromEnd?,toEnd?,label?,labelPosition?,color?}`.
Ends are `none` or `arrow` (omitted ends mean none), coordinates are finite world coordinates, and endpoints are distinct.
Their ids share the node/edge namespace. They use the same edit batches and history, appear in reads, pictures and embeds,
and contribute to Fit bounds even without nodes. Bound connections remain standard edges. There is no drawing sidecar.
Unknown entry versions and fields remain opaque and preserved; an incompatible non-array `lines` container is never overwritten.
Native Canvas may not display the primitives, but retains the extension for returning to Abele.

Freehand ink is stored in root `abele.ink` (free strokes) or node `abele.ink` (attached strokes),
never in a sidecar: `{version:1,id,tool:pen|marker,color,size,points:[x,y,pressure,...],frame?:{width,height},transform?:{x,y,sx,sy}}`.
Colour is a native Canvas preset (`1`–`6`), a six-digit hex colour, or empty for the theme default.
Size is the authoring width; pressure is finite and within 0–1. Attached samples are node-local,
with the node's authoring dimensions in `frame`; painting transforms the entire pressure outline
by the current node's translation and independent width/height scale. It never rewrites points
when the node moves/resizes. The optional positive axis scales and translation in `transform`
are applied before the node/frame transform (identity when omitted). They preserve the entire
outline, not just the centreline, when detaching nonuniformly resized annotations or scaling
ink selections. Free strokes have no frame; their transformed coordinates are world coordinates. IDs share
one namespace with nodes, edges and lines, including opaque ink entries. Unknown versions and
malformed legacy ink are preserved unchanged, not migrated or drawn; incompatible non-array
containers cannot be overwritten by drawing. Attached ink follows its owner's visibility,
even when its bounds reach outside that owner. It appears with the owner in walkthroughs;
free ink is revealed by its ID. Fit, node crops, embeds, agent pictures and exports include ink.
Human pen/marker gestures use the shared `add_ink {stroke,node?}` edit operation, one history
item on completion. Cancellation discards the whole preview; no predictions are saved.
New hand-drawn ink and migrated Excalidraw pencil ink also store
`freedraw:{simulatePressure,streamline}`. Canvas and drawing gestures retain their established
stored sampling: bounded full-precision stylus points with `linear:true`, and rounded
mouse/finger points without that flag. Lift-off retains the last contact pressure at the
endpoint. Reader gestures keep full-precision samples and `linear:true`.
Pen pointers preserve contact pressure; mouse/finger input records neutral .5
pressure. Live profiles use `simulatePressure:false` so velocity cannot shrink sensorless nibs
below the selected diameter. Imported profiles retain their source pressure response.
Perfect-freehand supplies the pressure easing, round caps and quadratic outline for live paint,
saved ink and exports. Pen `size` remains the half-pressure diameter; markers retain uniform
width and opacity and store a filled outline. Older strokes without this profile retain their
rendering. Picking and selection bounds follow the displayed quadratic outline, including
short-stroke caps. Partial erasing bakes the streamlined
centreline and equivalent native nib widths into the resulting fragments, removing the profile
so they are not streamlined twice.
An explicit single-drawing migration creates a new canvas beside prior results; bulk migration
skips drawings already converted. Neither rewrites a prior canvas.
Whole/partial eraser sweeps and lasso edits use that same history. Partial cuts keep the first
fragment's ID and give further fragments fresh IDs, interpolating pressure at cut boundaries.
`update_ink` changes a compatible stroke; `attach_ink` changes its owner while composing the
outline transform. Mixed `move`/`scale` skip a separately selected stroke whose owner is already
moving, preventing double transforms. Grouping may attach selected ink to the group; ink owned
by a selected card remains with it. Ungrouping detaches group-owned ink before removing the
frame. Ungroup refuses opaque/malformed group ink or an incompatible root container instead
of guessing attachment geometry or losing unknown data. Deleting a node deletes its owned
ink, restored with that node by Undo.

Each node/edge has a stable id; agents choose meaningful ids. Native Canvas reorders elements
and keys on save, so all edits and references are by id. Unknown extension data survives Abele
parse/edit/serialize; unknown node types are refused because native Canvas drops them on save.
Abele hierarchy hints are stored as node `abele.parent` (group id, or null at the root), with
`abele.parentGeometry` anchoring the intent to the node/frame geometry that Abele wrote. Native
moves/resizes or deleted frames invalidate the hint: current containment is inferred instead,
without refusing the file. Legacy unanchored hints are trusted only while their frame still
contains the card. No read rewrites stale metadata; a later successful layout refreshes it.
Group metadata is not stored in a second membership file. Creation stores its title in `metadata.frontmatter.title`.

Other Abele-only data lives under `abele` at file/node/edge level. `abele.steps` is an ordered
list of `{id,reveal:ids[],say:string,highlight?:ids[],focus?:id|{x,y,width,height}}`. Step ids are
stable author-chosen names; referenced ids name diagram nodes/groups/edges. Reveals accumulate,
a group reveals descendants, and connections appear once both endpoints are visible. Older
steps without ids receive temporary `step-N` names, persisted on the next step-authoring write.
Unknown step extension fields are retained. Lint reports invalid steps, missing ids and overly
dense reveals (including group descendants). Opaque legacy ink and layout hints are retained. Do not invent new `type` values for these features. Agent changes use an atomic vault
transaction with an expected revision of the file bytes and pending native state. `canvas_read`
and successful writes return that revision; edit/layout refuse versions changed since the read,
checking again at publication. The token is not a stored canvas field or sidecar. An open native
editor receives one undo item per batch. `canvasViewer` is a transferable plugin setting,
on by default, choosing Abele for newly opened canvas leaves; the per-leaf native action keeps
that tab native until reopened in Abele. A view switch never writes the diagram. If the native
editor and stored version differ, adoption waits for native saving/reloading rather than deciding
which version to overwrite; pending edits remain in their native tab. Camera and selected step live only in the workspace
leaf state, not the `.canvas` file. `![[sample.canvas#step=N]]`, `#node=id` and `#part=x,y,width,height` embeds store only
that link in the note; their pictures are transient. Opening an embed as an image keeps the source
path and crop/step in workspace navigation state and regenerates the picture; it creates no
image attachment. Edit opens that source canvas in the same leaf. User whole-canvas PNG/SVG/PDF exports go
into the ordinary attachments folder as new files; current-view and step PNG/SVG exports remain
available. `canvas_export` creates the exact new output path supplied by the agent. Neither
changes the canvas source. SVG embeds PNG pixels, not editable vector paths; PDF stores one
JPEG-backed page, without scripts or selectable text. Output is encoded completely and staged
in a temporary attachment before final delivery; cancellation/failure cleans up that temporary
file where possible, never publishes an incomplete final picture. This is not canvas recovery
or an editable sidecar. Inserting an export appends an ordinary attachment embed to a picked
note, preserving its existing bytes. `look_at_canvas` creates no export file, cache note or
diagram attachment: its PNG is an agent-message image. Source notes and local images are read only within scope.

A canvas migrated from an Excalidraw drawing is an ordinary new `.canvas` beside the drawing,
with `abele.excalidraw.source` naming the drawing's path — the only record that it was migrated,
read to skip drawings that already have a canvas. Pictures kept inside a plain `.excalidraw` are
written once beside it as `<drawing> <id>.<ext>`. If migration fails, it removes only pictures
successfully created by that attempt, leaving pre-existing files and replacements untouched.
Cleanup failures are included in the failure reason. The drawing itself is never written.
After the new canvas is saved, resolved backlinks in Markdown notes and file nodes in other
canvases are redirected to it through atomic file processing. Only link destination tokens are
changed; Markdown image syntax becomes a native canvas picture embed. Each migration reports
reference counts per referring file and update failures. Such a failure leaves the published
canvas and its extracted images intact; it does not roll files back.

Uncertain publication and confirmed-writing/local-acknowledgment-pending work is retained only
in the running session: proposed draft, original baseline, operation kind, and revoked-attempt
evidence. The local recovery action reviews freshly read persisted bytes separately from this
work and native unsaved data. Keep/cancel leaves it intact. Confirmed local discard removes only
that memory and its unresolved evidence, leaving source bytes and history unchanged. It does
not undo a write, acknowledge matching bytes, reconstruct missing history, or save a sidecar.
Any desired change afterward is a new ordinary edit from a fresh read. No reload/crash durability
or automatic uncertain replay is provided.

Human selection and drag/resize previews are transient and never stored as canvas fields.
Note panels are off by default. The canvas menu's “Notes show header and footer” choice is
stored as the boolean `abele.notePanels` in the `.canvas` document. A markdown card's
“Show header and footer” choice is stored as `nodes[].abele.panels`; an explicit `false`
overrides a canvas-wide `true`. Both use ordinary document undo and batched publication.
At an on-screen size of at least 280×320 CSS pixels a card shows the normal header and footer,
with all lists after the first folded locally. At least 120×96 pixels shows task, linked-note,
log and time-entry counts instead; below that, panels are hidden. Camera changes do not
rewrite the canvas. These panels are live card controls, not part of exported canvas pictures.
A completed gesture, text edit, undo or redo applies at once in memory as its own undo step.
Writing the file is batched: after a short pause (about 1.5 s) and at most about 5 s after the
first unwritten change, and at once when the canvas tab closes or switches file, the window
loses focus or the app goes to the background or quits, before native Canvas takes over, and
before any agent tool or export reads or writes that canvas. Each batch is one file write; its
steps keep their own undo entries. Until then the changes exist only in this running session.
Group movement translates descendants once and refreshes the existing parent geometry anchors
only after the entire translation. Group/ungroup use the same ordinary group nodes and hierarchy
hints as agent edits. Resizing changes the standard node geometry, not linked file contents.

## Device-local key destinations

Obsidian's vault-scoped local storage holds `abele-key-destinations-v1`: key identifiers and
approved HTTP(S) origins, never key values. It is not exported or synced. Existing service
origins are recorded once on upgrade; a changed origin arriving elsewhere needs confirmation
on this device. Deleting or changing ordinary notes does not approve a destination.
Named keys in `ai.secrets` store `allowedOrigins`, a list of recipient HTTP(S) origins beside
the keychain identifier, not the secret value. This list travels in the stored-keys transfer
section; local destination and HTTP approvals do not.
`abele-key-http-origins-v1` holds explicitly allowed home-network HTTP origins on this device;
it contains no secrets and does not travel either. Review key destinations can manually bind a
selected saved key to a canonical scheme/host/port, even with no pending destinations. Explicitly
saving a new named key there writes its exact value through SecretStore, never ordinary settings
or local trust storage. Only its name, stable ID, keychain ID and `allowedOrigins` enter
`ai.secrets`; the existing stored-keys transfer carries that metadata and protected key.
Home-network HTTP transport exceptions are separate from per-key recipient approval: an exception
does not approve other credentials. Removing the exception blocks credential-bearing HTTP again.
Manual approval never queues or replays a script. The dialog lists named key-recipient
permissions after save/reopen. Removing one persists its removal from `allowedOrigins` and
revokes its local pair trust, without deleting the protected key or other HTTP allowances.
Basic authentication compares the decoded password exactly against protected saved values;
its username and derived Authorization/Base64 material are request-local, never new settings,
trust-cache identities or duplicate stored keys.

## Excel files

Workbooks remain ordinary binary `.xlsx` or read-only `.xlsm` attachments at their original
vault paths. Opening/reading creates no Markdown conversion, cache note, sidecar or persistent
setting. The grid indexes one sheet at a time and displays saved formula caches; it never
executes macros, external links or embedded active content. Phone views offer no hand editing.
ZIP limits and strict lexical XML parsing are shared with Word. `.xls` is not supported.
Value/formula edits patch only affected cell spans (adding rows/cells in coordinate order).
Shared groups touched by an edit become ordinary formulas with translated relative references.
Unknown cell metadata survives; unrelated XML and package parts retain their uncompressed bytes.
A no-op retains the exact ZIP. `calcPr` marks recalculation required, and calc-chain parts,
relationships and content-type overrides are removed together. Saves refuse conflicting external
changes and never create a Markdown intermediary. Array/data-table formulas and protected
workbooks are not edited. Local recalculation patches `v` caches and cell type attributes on
formula cells, including other sheets' dependents. Formula XML and unknown metadata survive.
Excel ST_Xstring escapes are decoded once and escaped when writing literal escape-looking
text or carriage returns. Shared whole-row/whole-column references are translated too;
unsupported shared references remain viewable but cannot be unshared. Row span hints and used
range dimensions expand when needed. Trailing row changes never shift existing addresses;
row deletion refuses formulas/structural references rather than attempting a lossy rewrite.
The size cap is checked before reading a vault attachment and again before saving, so an edit
cannot create a file too large to reopen. No calculation engine state is persisted; `calcPr` still requests the spreadsheet app's native
recalculation. Engine-only cycle errors are stored as Excel-compatible `#REF!`, not nonstandard
error tokens. Cell formatting appends styles to the existing stylesheet (fonts, fills, custom
number formats and `cellXfs`); original records are retained verbatim. Cells are patched only
at `s` attributes. If a workbook has no stylesheet, a new part, workbook relationship and
content-type override are created together. Formatting does not touch formula caches.

## Word files

Word documents remain ordinary binary `.docx` attachments at their original vault paths.
Opening and reading creates no Markdown conversion, cache note or persistent document setting.
The Word view displays a disposable rendering of the package; it does not rewrite the file.
All parts are inflated through small input chunks with actual per-part/aggregate byte limits.
The preview receives a rebuilt archive of those validated bytes, never an unchecked original ZIP.
Large packages use a paged text view. External relationships and active HTML chunks are omitted
from the rendering only, not removed from the original document. Text edits patch only affected
`w:t` lexical spans in `word/document.xml`; untouched XML/ZIP parts are retained as their original
uncompressed bytes. A no-op retains the exact original ZIP. Edited packages are re-compressed,
so ZIP container bytes may differ; no Markdown intermediary is written. Immediately before the
binary write, the current bytes are compared with the edit's original bytes; a difference refuses
the write. A read-back immediately after publication checks the prepared result. A different
version reports a conflict and asks the person to reopen rather than claiming success.
The tiny race between the final check and publication remains, as for other vault writes;
in-place editing remains enabled. With agent rewind enabled, the prepared original is retained
in that chat's existing rewind history, including Word archives above the generic 20MB blob cap.
Formatting and structure edits patch only their selected XML nodes. New lists may add
`word/numbering.xml` plus its relationship and content-type entry; new links append relationships.
Inline images imported from the vault are embedded under `word/media/abele-image-N.ext`, with
relationships and content types. The source vault attachment is not moved or removed. Replacing
or deleting an inline image removes/changes its drawing reference; original media and unused
relationships remain in the package, since unsupported parts may still reference them.
There is no new persistent editor setting or sidecar. Phone views do not offer hand editing.

## Imported images

Images imported through Abele's chat, gallery, file importer and media downloads are stored
as vault attachments. HEIC/HEIF inputs become PNG only where native decoding is available
(iPhone/iPad), before allocating a collision-free filename. Converted external imports keep
only PNG; an existing vault HEIC is kept beside its new PNG copy. Without native decoding,
HEIC is kept with its original bytes: an external file is imported unchanged,
except that a HEIC/HEIF recognized only by MIME gets `.heic`/`.heif` appended to its filename
(e.g. `sample.jpg.heic`). That suffix preserves the binary type through storage and chat reloads.
An existing vault file is reused without making a duplicate. A notice explains that
conversion is available on iPhone/iPad. Chat attachments store the resulting file's vault
path, not base64 bytes or a temporary system path.

## Notes about recorded runs

A run the debugger recorded stays on the node, in a folder on its disk (by default `.abele/runs`
in the project, which ignores itself in git). Nothing of it is synced. A note about a run is
written only when asked, by the person from the run's tab or by an agent with `trace_note`, into
the folder `traceNotesFolder` (Settings → Nodes, default `Trace`; it travels with the other
settings). It is a vault folder, or on a computer any folder given by its full path, outside the
vault too; vault file tools cannot reach a note written there. A device where that full path does
not exist, or a phone, refuses to write the note and says so, rather than writing it anywhere
else. A note already there is never overwritten: the next one gets a number.

The note holds the record points, the timeline, for the first 50 steps each value's shape and
first lines in a folded callout, the marks and the questions, and an empty last heading for an
account of the flow. Recorded text is written as text, never as markup. Each step and value
links to the whole of it on the node as `obsidian://abele-trace?node=…&project=…&run=…&step=…&name=…&path=…`;
the link opens a tab while the node is reachable and says the node is away when it is not.
Marks written by hand into the note do not go back into the run.

## Attachment folder rules

`attachmentRules` in the plugin's `data.json` is an ordered list of
`{ notesFolder, location, attachmentsFolder, subfolder }`. An attachment saved for a note —
pasted, dropped, recorded, imported, or written by the plugin itself — goes where the rule on
the deepest `notesFolder` holding the note at any depth says (folders compared without regard
to case; `/` is the vault root). `location` is Obsidian's own choice: `note` beside the note,
`folder` into `attachmentsFolder` (`/` is the root), `subfolder` into the folder named
`subfolder` under the note's folder. The field the current `location` does not use is kept, so
switching back finds it. A rule missing its notes folder, or the field its `location` needs,
applies to nothing. Notes under no rule use the vault's Files and links setting, which the
plugin never changes. Rules from the first shape, `{ notesFolder, attachmentsFolder }` with
`./` or `./name` meaning beside or under the note, are moved to the matching `location` when the
settings load or arrive in a transfer. The rules travel in the Other block of a settings
transfer.

## Naming notes

A note's name cannot carry `* " \ / < > : | ?` — Obsidian refuses those itself — nor `#`, `^`,
`[` or `]`, which it will write to disk and then never link to: `[[Note#x]]` addresses a
heading, `[[Note^x]]` a block, and a bracket ends the link.

`create`, `mv` and `cp` take those characters out rather than refusing, and their reply says
what the note is really called: `Created: Notes/Weekly report.md (renamed from "# Weekly
report.md": "#" cannot be used in a name)`. **Read the path back from the reply** — linking to
the name you asked for will point at nothing. A name that cleans to one already taken is still
refused, because that is a collision rather than a typo.

The usual way this happens is deriving a name from a markdown heading and keeping the `# `.
Apostrophes, commas, ampersands and percent signs are all fine and are left alone.

## Links to lines

To point the person at particular lines of a note — in a reply or written into a note — link
the lines, not just the note. The range goes where a heading would:

```
[[Projects/Budget#L12-L18|the totals for March]]
[[Projects/Budget#L40]]
[the totals for March](Projects/Budget.md#L12-L18)
```

A click opens the note with those lines selected in the editor, or flashed in reading view;
Mod-click opens it in a new tab. Lines count from 1 over the whole file, **frontmatter
included**, exactly as `read` numbers them — take them from there rather than counting by
eye. Give the link a label saying what is there. A range
past the end of the note stops at its last line. Without the plugin the link still opens the
note, only at the top.

The person gets the same links from **Copy link to lines** on the editor's menu.

## Tasks

`type: task`. One note per task, in the tasks folder (`Tasks` by default).

| Property     | Meaning                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `created`    | Date the task was made                                                                                                                                                                                                                      |
| `date`       | The day it is scheduled for                                                                                                                                                                                                                 |
| `dateTime`   | Time on that day, `HH:mm`                                                                                                                                                                                                                   |
| `due`        | Deadline date                                                                                                                                                                                                                               |
| `dueTime`    | Time of the deadline                                                                                                                                                                                                                        |
| `completed`  | Date it was finished. Its presence is what "done" means                                                                                                                                                                                     |
| `recurrence` | Repeat rule, when it repeats                                                                                                                                                                                                                |
| `groups`     | What the task belongs to — the project, the person, the note it came out of                                                                                                                                                                 |
| `priority`   | `low`, `medium` or `high`. Anything else, or nothing, is no priority. The property's name is selected by `taskPriorityProperty` (default `priority`); read that setting before writing. `priorityProperties` only controls property widgets |
| `labels`     | Labels, one value or a list — `labels: [work, errands]`. The property's name is a setting (`taskLabelProperty`); read it before writing labels, it may not be `labels`                                                                      |

Priority orders the task list of tasks without a date, highest first; dated tasks stay in date
order. Labels are free text: write them plainly, without a `#`. Colours for labels live in the
settings, never on the task. The task's own body is its description.

A subtask is a task with another task named among its `groups` — `groups: ["[[Tasks/Mount the
station]]"]` — and nothing else: there is no `parent` property, and one task may be a subtask
of several. Lists show it under its parent, the parent's row counting done of all; a parent the
list does not show is named under the subtask instead. Closing the last open subtask automatically
closes its parent and eligible ancestors. Unticking a subtask reopens only ancestors whose
current completion was automatic; manually completed parents stay closed. Tasks
written into each other's groups (a circle) show flat and never participate in automatic completion
or reopening, including propagation to their external parents. To make a subtask,
add the link to the task's `groups`; to undo it, remove that link.

Expanded subtask rows are remembered locally under `abele-subtasks-open`, as a list of task
paths in Obsidian's local storage. This affects every task list on that device and does not
change task notes or travel with settings.

An automatically completed parent stores `abeleAutoCompleted` alongside `completed`, with the
same date value. This provenance travels with the task note. Reopening removes both properties;
an explicit completion toggle clears the marker. A changed completion date or a missing marker
prevents automatic reopening. Parent writes change only completion fields and preserve the
current body and other properties, including unsaved content in an open editor.

Completion is `completed` being set. Do not add a `done` or `status` property.

Completing a repeating task through its header or card creates the same next occurrence:
advance each existing `date` and `due` by `recurrence`, or calculate them from the instant of
completion when the rule says `from completion`. Missing endpoints remain absent. The copy
has no `completed` property; existing subtasks keep their completion state and group links.
Undoing completion creates no copy.
Counted rules skip inactive periods: `every 2 weeks on Monday` advances two weeks, and
`every 2 months on 15` advances two months after the current month's 15th.

## Inline checklists

An inline checklist is Markdown in a note's body, not a `type: task` note. Do not create a
separate task note merely to track a list item. Preserve the list's text, indentation and
links when editing a marker with the normal note read/edit tools.

| Marker         | Meaning     | Open | Done |
| -------------- | ----------- | ---- | ---- |
| `[ ]`          | Open        | yes  | no   |
| `[/]`          | In progress | yes  | no   |
| `[x]` or `[X]` | Done        | no   | yes  |
| `[-]`          | Cancelled   | no   | no   |
| `[>]`          | Forwarded   | yes  | no   |
| `[<]`          | Scheduled   | yes  | no   |
| `[?]`          | Question    | yes  | no   |
| `[!]`          | Important   | yes  | no   |

Write `- [/] Sample item` while it is in progress and `- [x] Sample item` once it is done.
Cancellation is not completion. When reporting progress, keep cancelled items separate from
both done and open items. Do not treat every non-space marker as done, even though Obsidian's
rendered HTML can mark it `checked`. Leave unknown theme-specific markers unchanged.

The note tools and scripts read/write these markers as ordinary Markdown; there is no
checklist-item API or automatic inline progress counter. `read_tasks` and the task-note
lists still deal with task notes and their `completed` property, not these list items.
Repeating task notes reset completed `[x]` items in their body as before; alternate markers
are retained. The special `- [ ] [[task-note]]` embed remains a task-note widget, not a new
inline state control.

Reading view and Live Preview draw each state distinctly. A checkbox's context menu (hold
on mobile) chooses a state, and **Cycle checkbox state** cycles the editor's current list
line. Normal clicks keep Obsidian's toggle. Neither action edits fenced code examples.

## Calendar views in bases

A `.base` file can show the notes it finds on a calendar: a view with `type: abele-calendar`.
Its options sit in the view's own entry and all of them may be left out:

```yaml
views:
  - type: abele-calendar
    name: Calendar
    mode: month # month, week, year or life — where it opens
    dateProperty: note.date # the day a note is on
    timeProperty: note.dateTime
    endProperty: note.due # the last day, for something that spans days
    endTimeProperty: note.dueTime
    showCalendarEvents: false # true adds the external calendars' events
    doneLast: true # false lists done tasks where the sort puts them
    lifeExpectancy: 90 # years the life layout draws; left out, the plugin setting
```

Left out, the four properties are the task's own, so a base over the tasks folder needs none of
them. A note goes on its date, or on its end date when that is all it has; with both it spans
the days between. A time comes from the time property or from a date written with one
(`2026-09-26T10:00`). A note with `completed` set is struck out. The base's `groupBy` colours
the notes, one colour per group, and its `sort` orders the notes within each day, done tasks after the rest unless `doneLast`
is false. Nothing about a
calendar view is stored anywhere but the `.base` file — except what the `life` layout counts
from: a life in weeks, a row per year of age and 52 weeks to a row, starts at the person's
`birthDate` in the plugin settings and runs to `lifeExpectancy` years, both shared by every base.
A row starts on a birthday, so its weeks are counted from there, not from Monday; the last week
of each row takes the day or two a year has over 52 weeks. Each week is tinted by how many of the
base's notes fall in it.

A base can also draw its notes on a timeline of history, `type: abele-timeline`, read from dates
written as text (`490 до н.э.`, `XVI век`, `ок. 1450`) — see the `history` section.

Dragging a note on the calendar writes into that note's frontmatter: every date property it
has (start and end) moves by the same number of days, and dropped on an hour its time is set,
an end time on the same day moving with it. A time goes where the note already keeps it, in
the date value or in the time property. Formula dates are never written.

## Transactions

`type: transaction`. One note per transaction.

| Property                           | Meaning                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `date`                             | When it happened                                                  |
| `from`                             | Wikilink to the account it left                                   |
| `to`                               | Wikilink to the account it went to                                |
| `amount`                           | Number                                                            |
| `currency`                         | Currency code                                                     |
| `foreignAmount`, `foreignCurrency` | The same sum in a second currency, for multi-currency             |
| `category`                         | Wikilink to a category note                                       |
| `groups`                           | Anything the transaction relates to — a trip, a project, a person |

Whether a transaction counts as income, spending or a neutral transfer is decided by the
_types of the accounts on each side_, never by the sign of the amount. Amounts are positive.

## Accounts

Account notes have `type: account` and are what `from` and `to` point at. Their `accountType`
is one of `asset`, `revenue`, `expense`, `liability`, `computed`, `mixed`. Money moving from a
`revenue` account is income; money moving to an `expense` account is spending. A `mixed`
account is a category that can act on either side: `mixed` to `asset` or `liability` is income;
`asset` or `liability` to `mixed` is spending. `mixed` to `mixed` is a neutral transfer, as is
`asset` to `asset` (which changes the individual balances, not net worth).

Like expense and revenue categories, mixed accounts have no fixed currency or wallet balance.
Their activity is tracked per transaction currency. They are excluded from net worth. The
account chart shows separate income and expense activity; the accounts list shows signed net
category flow (money into the category minus money out). Edit `accountType` in the note's
ordinary Properties editor.

## Time entries

`type: time-entry`. One note per tracked stretch.

| Property | Meaning                                                             |
| -------- | ------------------------------------------------------------------- |
| `start`  | Start, date and time                                                |
| `end`    | End, date and time. Absent or null means the timer is still running |
| `groups` | What the time was spent on                                          |

Totals roll up through `groups`: time tracked against a task also counts towards the project
that task belongs to, and so on up.

## Journals

Journals are configured sets of dated notes — a daily note, a monthly one, a health diary —
each with its own path template such as `Journals/{{date:YYYY}}/{{date}}`. A journal note is
found by its date and path, not by a property, so creating one by hand in the wrong place
makes a second note for that day that nothing will find. Use the journal commands.

## Logs

A log is a piece of writing that shows up in the notes it mentions. Two kinds:

- **A paragraph** inside a note whose `type` is in the log types list (`journal`, `log`,
  `daily` by default). Every wikilink in that paragraph makes it appear in that note's timeline.
- **A whole note**, when it points at something through `groups` rather than in its body. This
  is how a meeting report is written.

So a line in a daily note mentioning `[[John]]` and `[[Coffee House]]` appears, dated, on both
of those notes. That is the plugin's central idea: write once, in the place you are writing,
and read it from every relevant context.

## Any note: description and cover

Two optional properties on any note. The backlinks at the foot of a note are cards, and a
note that has these shows them on its card; a script's `noteInfo` returns the cover too.

| Property      | Meaning                                                                             |
| ------------- | ----------------------------------------------------------------------------------- |
| `description` | One or two sentences on what the note is; a card shows the first two lines          |
| `cover`       | A picture: `"[[poster.jpg]]"`, a vault path, or a web address. Shown as a thumbnail |

Worth filling on notes that are linked from many places — a person, a place, a film — so the
list of backlinks says what each one is without opening it.

## Files in properties

A property can hold a file of the vault. Obsidian's **File** type is one file, and the plugin
adds **Files**, a list of them; the type is chosen per property name, the way Obsidian keeps any
type (`.obsidian/types.json`). While the plugin draws properties, `file` is a File and `files` a
Files property unless another type was chosen for them, so those two names need no type picked. Write the value as a wikilink with the extension, so Obsidian keeps
it up to date when the file moves: `file: "[[Books/Dune.epub]]"`, `files: ["[[a.pdf]]",
"[[b.png]]"]`. A bare vault path is read too. The plugin draws these, and `cover`, as cards with
the file's picture; the value stays plain frontmatter, and without the plugin a Files property
shows as a raw list.

## Counters

A property named in the `counterProperties` setting is a counter: the plugin draws it with − and

- beside the number. Its value is a plain number, `reps: 12`; empty or missing counts as 0, so the
  first + writes 1. Write a number, never text, into one; a value that is not a number is shown as
  it is and the buttons leave it alone.

## Dates, priorities, labels and groups

Properties named in `dateProperties` (by default `date`, `due`) are drawn with a day back, a day
on, how far away the day is and a button to its daily note. A step keeps the shape: `2026-05-01`
stays a date, `2026-05-01T09:30` keeps its time. An empty one counts as today.

Those in `priorityProperties` (`priority`) take `low`, `medium` or `high`, raised and lowered a
step at a time; lowering `low` empties it. Those in `labelProperties` (`labels`) are a list,
`labels: [work, errands]`, added to from the labels the vault already uses. Those in
`groupProperties` (`groups`) are a list of links, `groups: ["[[Garden]]"]`, edited as any list
of links, with a button adding one of the notes already used as groups; any note, or one not
written yet, can be a group, a new one is written as a plain `[[link]]` and the others are kept
as they were. Write these values in those shapes; a value the
drawing cannot read is shown as it is and left alone.

## Skills and prompts

Notes with `type: abele-skill` or `type: abele-prompt`. A skill teaches an agent how to do
something and is loaded on demand with the `skill` tool; a prompt is a reusable piece of text
for the person to insert into a chat. Both are ordinary notes and can be edited as such.
Skills are offered from the configured `ai.skillsFolder` or the calling chat's scope; loading
another asks first. The folder choice is saved with AI general settings and travels on transfer.

## Chats

Chats may be placed in real folders under the configured chat directory. Existing files remain
where they are until explicitly moved. Moving a parent also moves its nested discussions;
helper transcripts retain their parent reference. Closing a parent closes its nested chat
presentations without restoring any files.

Each folder may contain `_folder.abeleaccess`, a JSON object mapping tool permission keys to
`off`, `ask`, or `auto`. Folder modes apply to all descendants and only raise the chat's resolved
agent/default modes. They are resolved at use time, never copied into chat overrides; leaving a
folder removes its contribution. These vault files sync normally and travel in the settings
transfer's **Chat folder access** section, relative to the receiving chat directory. A folder
can be deleted only when it contains no chats, child folders, or other files.

The existing device-local chat layout also retains closed node-session references, their
local parent-chat paths, and closed helper-run IDs. These are presentation state, never a
command to restore files or restart execution. Helper transcripts stay in their existing
sidecars; their parent references follow a moved chat.

New message discussions are created beside a parent already filed in a chat folder. Existing
discussions stay in place until a move. The tree discovers closed discussions through the
discussion inventory, including files outside the chat directory; it does not add margin-only
discussions to the ordinary chat-history index. Untitled discussions use their first question
as a display name.

An explicitly cut local branch carries `pendingBranchCut` in metadata until its first new
record is appended. That record carries `branchCutAfter`, referencing its parent assistant
or completed tool-call message ID. These optional fields survive log writes and compaction;
copies remap references to their fresh message IDs. The selected model context trims the
original assistant bundle at that boundary, retaining genuine prefix results and their
linked injections, never synthetic results for omitted calls. Image injections and stored
result access follow the same cut. The original transcript remains unchanged for its other
branches. Creating or selecting a branch never restores files or executes a tool; the
filesystem remains its current state. Older clients do not implement this optional context
boundary, so use compatible versions when continuing a cut branch on another device.

Agent definitions keep `toolDiscovery`: `sections` (the default) or `all-at-once`. Older
values `all` and `by-group`, and an absent value, mean sections. This setting travels with the
whole agent definition in settings transfer. Open sections are not stored: they are derived from
the `open_<section>` calls on the active branch. Chat metadata keeps `openToolSections` only for
sections open before the chat's own history — those a delegated run inherited from its parent,
or those carried over from `revealedToolGroups`, the legacy list of tool groups revealed before
sections existed. These are discovery state, not permissions; every request still filters tools
by the current agent's and chat's settings. Starting a new chat clears them.
With sections an agent may also keep `toolSectionOpening` (section id, such as `nodes`, →
`always` or `on-request`; absent means the section's default, on request) and
`toolSectionDescriptions` (section id → the owner's own words for what the section is for, used
in place of the default and of a global description override). Both travel with the agent.
Do not edit these records by hand.

Chat metadata `overrides.nodeScope` stores remote scope separately from vault paths:
entries identify a whole node, registered project, or exact plain workspace/Git worktree,
with read/edit access. `overrides.nodeTarget` is this chat's selected remote target, not a
permission. Both travel with the chat log and its sparse overrides. Whole-node scope includes
future registered projects. Message discussions, including discussions nested in other discussions,
copy the nearest parent's node scope on creation or opening if their own scope is unset.
An explicit child scope, including an empty one, is retained. Existing device-local approvals
for the inherited entries are copied to the child's durable identity on that device.
A copied or synced configuration does not authorize itself:
owner approvals live only in device-local preferences, bound to durable chat identity,
exact scope entries, node installation/key and durable local registration authority.
The local registration authority changes on re-pairing and on removal/recreation; it is retained
across ordinary restarts and never travels with chat metadata. The process-local authorization
generation fences in-flight reads, writes and scope approval, but is never part of persisted
approval or mutation principals. Removing/changing
scope fences pending tool reads and new mutations. Node writes and their durable receipts stay
on the daemon; successful edits retain before/after Diff text in the ordinary chat tool result.
`node_propose_edit` remains a separate device-local draft, not an immediate disk writer.
The existing device-local node client database also retains `chatMutations`: immutable requests,
operation IDs, executing-chat identity, pairing authority, before/after text and known receipts.
These records do not travel with a chat. Pending/unknown mutations survive a disconnect or restart;
explicit exact-request retry uses the same ID and cannot rebind it to changed arguments.

Chats are `.abchat` files under the chat folder, one JSON record per line. While one is being
rewritten whole, a copy of the new content sits in the plugin's folder under `chat-backups/`, on
this device only, and goes once the file is written; a file found cut short by a crash is put
back from it. Besides the
conversation, a chat's metadata record remembers what it _did_: `touched` lists the notes it
is linked to — the ones it wrote to (created, edited, replaced, moved or copied into place,
never merely read), each with the time it was last written, and the ones the person attached it
to by hand, each with the time it was attached. The two are the same entry and look the same;
detaching a chat from a note removes its entry either way, and a later write links it again.
Scripts — `.js` files under the scripts folder — are linked the same way, `create_script`
included, and list their chats under the code when opened; no other file is linked.
`recap` is a one-sentence summary of the work, written by the background model after a turn
that wrote something. Both are copied into the chat index, which is
what draws the **Chats** list under a note: one card per linked chat, with its title, its recap
(or, for a chat that never wrote, its summary) and the date of the link. `summary` is a sentence or two on
what the chat is about, shown under its title in the chat history; the background model writes
it from the text the person and the agent exchanged — never from what a tool returned — after
the first turn and again as the chat grows, and for an older chat when its card first comes on
screen in the history. It is copied into the index the same way. The history's first/last
message dates are cached from sent user and assistant turns only: system dividers, tool records
and drafts do not move a chat. Cached dates are versioned and rebuilt once when their derivation
changes. When no turn has a date, the last-message order uses the chat's stored creation date,
or leaves its date unknown, never a file time or the current time. The creation-date order can
use the file's creation time when neither a first turn nor a stored creation date is known. A comment chat carries the
same fields but is not in the index, so it appears in no footer until it is opened as a full chat.
Renaming a note or a script rewrites the path in both places. Do not edit these fields by hand.

Stopping an agent keeps completed tool-call/result pairs and already streamed text in the
chat log. Unfinished tool-call message records carry `toolExecution: "interrupted"`; requested
calls that never executed carry `toolExecution: "not-run"`. Neither outcome invents a
`toolResult`. Their model-facing tool-result records carry the same phase as `interruption` and
explicitly tell the next model request that the call was interrupted by the user. Completed
messages are checkpointed individually, even while a later call is still settling. In that
case request projection derives missing pairings from the persisted stop outcomes, without
waiting for the abandoned runtime. A real late result replaces the stop outcome. These are
history pairings, not tool-produced output or permission to retry. A tool that finishes despite
cancellation retains its real completed result. Stop does not restore files or replay calls.
Node chats retain completed work in the daemon journal; replay marks unfinished calls when a
run is interrupted without executing tools locally.

Completed tool-call message records may carry `toolImagePath`, copied from the tool’s own
`details.imagePath` only after successful execution. Generation and editing set that detail
after saving the image; text-only responses set no saved path. The field survives normal log
appends, compaction and reload without a format migration. The artifact view requires this
save evidence for generated/edited images: an approved status and model-authored saved-path
text alone are ambiguous, including in older chats. No evidence is backfilled from transcripts.
Uploaded images and other image-tool references retain their existing sources. Absolute,
schemed and parent-traversing artifact paths stay visible as unavailable references rather
than being normalized into a different vault resource.

A person's message that replies to places of the agent's answers keeps them in `replyTo`, in the
order they stand: each has `messageId` (the answer replied to), `quote` (the selected words, or
the answer's opening of up to 280 characters when it was replied to whole), `start` (where the
selected words begin in that answer's rendered text; absent for a whole answer) and `at` (where
the place stands in this message's `content`, as an offset; `content` holds only the person's own
words). A place whose answer is not on the shown branch stays in the record and is drawn faint.
The model-facing record of the same message carries the links block instead (see the agent's
Chats reference); a copy made with **New chat from here** points `messageId` at the copied
answers. The composer's draft holds each place as a private-use token inside its text, so a draft
restored from the queue, Stop or Edit carries them without a separate field.

Unsent messages waiting behind an active turn are stored in the chat metadata as
`queuedMessages`: each has an `id`, `content`, optional `replyTo` as above, and optional
`attachments` containing vault paths, exactly as in a normal user bubble. Imported media stays in the ordinary attachment
folder, never as binary data in settings. Enqueuing saves immediately; consumption, editing
and cancellation update the chat's queue. Reopening restores the queue without starting a
request; the user can return a message to the composer and send it again. Cancelling a queued
message removes only its reference, not the referenced vault file. Automatic node-result
notifications also carry `delegationWake: {sessionId, generation, stopEpoch}`. These are
runtime cancellation markers, not authority: Stop invalidates them, and queued notifications
from a different session/reopen are discarded on consumption. Both queue-draining and
iteration injection preserve the fence through asynchronous preparation. Discarding a wake
does not remove the durable result from the device-local node mailbox.

A `current_location` tool answer contains personal coordinates, accuracy, acquisition time and
the answering platform. Like other tool answers it is sent to the model and retained in the
chat file; it is not saved as a note property or a global location setting. Background recap
and compaction redact this tool-result content before sending their transcript to the helper
model; the original chat record is retained. The map's **Show my
location** action keeps its position only in the live map and discards it when the map is closed.

A chat that chose its own interceptors rather than following its agent's keeps the choice in its
metadata as `interceptors`, the list in running order, each entry with `id`, `agentId`, `script`,
`checks`, `pattern`, `replyOnly`, `contextDepth` and `enabled` (an empty list is Off). Beside it,
and alone in chats saved before lists, are the single fields of its first switched-on entry:
`interceptorAgentId` and `interceptorContextDepth` for a reviewing agent,
`interceptorScript` for a script, `interceptorPattern` for the messages it is shown,
`interceptorChecks` (`answer` or `both`; absent means the person's messages only), and
`interceptorReplyOnly` for either kind. `interceptorReplyOnly: true` sends the message at once
while the agent reviewer or script may answer beside it; absent or false keeps draft review
or the script's blocking decision. The reply is stored on the reviewed message in
`interceptorChat`, with `interceptorName` and `interceptorCollapsed`, not as an assistant turn
in the main conversation. A script's side reply also has `interceptorScript: true`; ignored
rewrites, holds and tool policies, or failures and timeouts, leave notes in `interceptorChat`.
Following the agent stores no interceptor override. Agent definitions in the plugin's settings also
hold their `interceptors` list (absent on agents saved before lists) and the single
`interceptorReplyOnly` (false by default) and `interceptorChecks` (`message` by default) fields
that mirror its first entry, and all of it travels with the agent in settings transfer. A line in
`interceptorChat` may carry `by`, the name of the interceptor that said it, when several read the
message. A message held among several interceptors carries `interceptorWait`: the `entry` id it
waits at, its place `at` among the `of` that read messages, and `error`, the reason, when that one
failed or was stopped. An answer the interceptor replaced is an assistant
`msg` with a `revisions` entry whose `by` is `"interceptor"`, `proposal` empty and `author` the
interceptor's name (see Reply highlights and revisions); a note, failure or stop of an answer check
is stored in that answer's `interceptorChat`, with `interceptorName`, `interceptorCollapsed: false`
and, for a script, `interceptorScript: true`. Nothing marks an answer that was checked and kept. A message a
script held back, or one it was stopped on, stays in the chat as a draft (`draft: true`,
`interceptorScript: true`), with the script's lines beside it in `interceptorChat`; so do the
lines a script left on a message it rewrote or failed on.

The chat index is `chat-index.json` in the plugin's folder under the config directory, beside its
settings file — not inside the settings, which sync between devices. No sync carries it: each
device keeps its own and rebuilds it from the chat files it holds, so a chat that arrives from
another device joins the list on its own. It is a cache: do not read it to find chats (list the
chat folder instead) and never write it. One that would not parse is kept beside it as
`chat-index.broken.json` for the person to look at, and a fresh one is built.

A tool result or message that showed the agent a file carries `reads`: the file's path, a hash
of its text at that moment, the time, whether it was read, attached or written by the agent, and
the lines when only a window was seen (with the file's length, so windows read one after another
add up to the whole). Bounded deck source reads instead carry `chars` (1-based inclusive UTF-16
source character range) and `totalChars`; character and line ranges are never combined. Once
contiguous reads cover the full current file the range is absent. That is what lets
`edit`, `replace`, `write` and `deck_edit` tell whether the agent has
seen a file as it is now (see the tools section). It travels with the message, so it is gone once
that message is compacted away or left on another branch.

Automatic compaction can run between model requests within a tool loop. The summary marker is
followed by copies of the latest complete tool-call exchange and its injected messages, or the
new user messages waiting for a reply. These retained `int` records keep their content, `reads`
and `stored` data, but their `chatMessageId` names the compaction divider. Older records remain
in the log for earlier branches: selecting a branch before the divider does not include the
retained copies. Only the summary and its following records are sent on the compacted branch.
Reviewed corrections are projected separately from their source replies: they do not define
which model turn has finished and are not copied into the retained exchange under the divider's
id. Their empty `model` identifies a correction rather than a new provider reply, including
corrections materialized in the log for older clients.

What a chat's tools changed in the vault is not in the chat file. It is kept in the plugin's
folder, under `rewind/`, one folder per chat named by the id of its first message: `log.json`
lists every change with the user message whose turn made it, the text a file had before (or
that it did not exist, or where it was moved to) and a fingerprint of what it held after; a
picture or other binary it replaced sits beside the log as `<fingerprint>.bin`, unless it was
larger than 20MB. Explicitly prepared Word edits keep their original archive even above that
opportunistic cap, under the same configured history budget. This is on the device where the
chat ran, nothing more. It is kept under the
size the **Rewind space** setting allows (100MB by default; 0 keeps nothing): the chats written
to least recently lose theirs first, then the oldest changes of the chat being written. A change
that has been put back leaves the log. Deleting this folder only takes away the way back.

Version 1 log entries additionally carry `chat` (the first-message key) and `run` (the invoking
session/turn identity); delegated branches retain their run identity in their root chat's log.
Ownership is passed through a call-local file facade, never inferred from which chats happen
to be running. A suspended script keeps that owner, including its journal directory and binary
copies: late writes are saved under the captured chat key even after its host selects another
chat or no chat. Each key has independent loading and persistence state. Built-in script agents,
cover/thumbnail creation and interactive template creation carry that owned IO context too;
a nested agent still uses its own permissions and scope, not the parent's approval. Unattributed writes through a global app
or third-party command are not claimed by a chat. Restoring does not mute other recordings.
`uncertain: true` on a change means another mutation overlapped its snapshot interval.
Undo refuses those files, discontinuous histories (another writer edited between two changes),
and files whose current fingerprint differs from the recorded result. Rename sources and
destinations (including chains of moves) are one restore unit: refusing any member also blocks
mutating the others, and every member is rechecked before each native mutation. Conflicting files remain
untouched and in the journal; there is no force-overwrite option. Preconditions are checked again
when applying, including at the native adapter queue boundary. Adapters without that boundary
refuse undo rather than risk a read/write race. Old entries without a `chat` owner remain
readable in their existing chat folder but are refused with an ownership explanation, even
when current bytes match: the old broadcast recorder could have captured somebody else's edit. Legacy folder moves cannot prove
ownership of their descendants and are left untouched.

A tool result too long to send whole carries `stored`: its key and the whole text. The model was
sent only the start of it; `read_result` reads the rest by that key, for as long as the chat file
holds the message — compaction and closing the chat included.

### Copies from a conversation point

**New chat from here** writes another ordinary `.abchat` log, containing only the selected
message's ancestry on the displayed branch and linked internal records. Message IDs are
fresh, including the first-message rewind key. The metadata carries the source agent and
sparse overrides, provider/model, custom prompts, tool discovery and interceptor choices;
creation date is new and the title adds `(копия)`. No format field is added for provenance:
`anchor` is a discussion anchor, not a clone-source link, and is not reused.
Queue, pending approvals, recap/summary, discussion anchors/comments, durable selection
identity/bindings and revision proposals are not copied. Message parts, attachments,
highlights and accepted revision history are retained; source selection version IDs are
removed. Unmatched provider tool calls beyond the cut are removed from the copied internal
reply, without executing or resuming them. Wholly unlinked legacy history uses the existing
positional migration first; remaining unlinked records are excluded, never copied wholesale.
There is no provider-side session identifier in the local chat format.

`touched` copies only source-linked notes with explicit `reads` evidence of `via: write` on
the retained internal records, using the last retained write time. Chat-wide manual links and
older links without path-local evidence are omitted, not inferred from tool arguments.
Attachment paths still reference ordinary vault files. Delegated run sidecars receive new
run IDs and paths, recursively, and point back to the new chat/run; they are independently
owned for deletion. Deleting the chat walks run references recursively across every branch,
with repeated/cyclic references visited once. Unreadable transcripts can be removed, but
unknown child references are not inferred. A nested run's `parentChat` may point to its parent run file; returning
there opens the read-only run view, not an editable chat. Chat storage refuses run transcripts
(including recognized torn run headers) on both load and save. The source file, comments and
device-local rewind data are not changed. The reserved clone tab stays read-only during
copying; adoption does not reset its draft. A change to the tab's conversation lifetime cancels
the copy and removes only its independent files, never the replacement conversation.

## Durable chat selections (storage adapter)

Optional `chatId` in the chat's metadata is a durable identity for selections, independent of
file path, tab/session id, and the first-message rewind key. It is initialized lazily by a
checked serialized write, not when an old chat is loaded. Each selected user/assistant `msg`
may carry `selection`: `revisionId` (current version), `versions` (retained source and rendered
projection, once per referenced version), and `anchors` (immutable captures and proven
placements). Each version has a `{chatId, messageId, revisionId}` reference, source `content`,
and `projection: {version, text}`. Anchors carry `id`, `original`, captured `snapshot`, and
`placements`; title/path/context are hints, never identity or quote-matching proof. Offsets are
half-open UTF-16 rendered-text positions, not Markdown positions. The adapter requires an
injected deterministic projector and validates the exact captured current version before saving.

Revision preparation and anchor creation share the chat writer with normal saves and highlights.
They leave message Markdown and internal/provider history unchanged, publish only after durable
success, and retain concurrent turn events. Drafts and unfinished streaming targets are refused;
previously saved messages remain annotatable during a turn. Failures return no successful anchor
address. Referenced source versions and anchors survive append, reopen, crash recovery and log
compaction. Before a checked rewrite of a recognised but torn/damaged chat, the safety copy
stores a clean v2 snapshot of every still-readable prior record, not the damaged bytes or the
proposed annotation. A crash immediately after truncation can therefore recover that prior state. Accepted semantic edits allocate fresh version IDs, even for equal text; reply
`revisions` store optional `beforeRevisionId`/`afterRevisionId`, and undo restores the recorded
before ID. Without a rendered-edit proof, old anchors remain historical, never guessed onto a
new occurrence. Undo without version proof allocates a fresh ID instead. New user branches and
regenerated replies have new message IDs and inherit no selection metadata; shared ancestor
messages keep their anchors. Navigation and selection-script UI are separate adapters, not
provided by this storage layer.

Explicit card binding stores a real `[[Cards/sample|selected words]]` in only the renderer-verified
captured occurrence. `decorationOperations` records operation/binding/anchor IDs, actual target
path, captured/resulting revision references and the verified source patch. `ownership` stores
its proven inverse placement (`revision`, source `start`, current link `after`) on a retained
version; source is kept once in `selection.versions`, not per operation. Decoration creates a
fresh version and copies only proven current anchor placements because rendered text is unchanged.
Highlights/comments keep their exact rendered offsets. Semantic reply revisions stay separate.

Metadata `bindingRecovery` journals `id`, `anchorId`, captured `snapshot`, actual `targetPath`,
optional published `operation`, optional `evidence`, and status (`pending`, `applied`,
`known-not-written`, `uncertain`, `undone`). The actual created/existing card path is durable
before message publication. If intent journaling fails the API reports the path but does not
claim recoverability. The writer durably marks intent uncertain _before_ attempting publication;
message text, operation evidence and applied status publish atomically. Lost acknowledgement is
settled only from operation identity in a valid log. An unresolved write blocks further local
writes until reopen/inspection, so a later ordinary save cannot overwrite its evidence.
Checked semantic/anchor writes keep their existing rollback policy; journaled binding writes
retain published evidence after a returned I/O failure. A torn publication still recovers the
prior committed source through the safety copy, with its uncertain journal intact.

Recovery never executes a script, creates another card or blindly retries an uncertain operation.
Pending/known-not-written retries revalidate the original capture. Equal source bytes alone are
not acknowledgement. Remove link/Undo applies a proven owned inverse only, preserves unrelated
edits/other bindings and never deletes the card. Unprovable inverses refuse instead of restoring
an entire message. Correction Undo likewise proves that each active card link remains owned
in both the current source and the restored source; otherwise it refuses without changing text,
operation evidence or recovery status. Remove the owned link first when that proof is unavailable.
Card rename maintenance follows open and unopened chats through their existing writer/external-change
guards. A closed-chat rename transforms one recovery-aware read and checks those exact same bytes
at publication, so a concurrent sync append cannot be replaced by an older parsed snapshot.
Retained historical source remains immutable. Unresolved
recovery and referenced versions survive compaction. Original provider records are unchanged;
semantic corrections project undecorated text and active associations are separate untrusted
user words-to-note annotations. No card-content read is issued for model projection.

Format version remains 2. Legacy chats without these optional fields load unchanged and migrate
on their first write. The v2 codec preserves additional fields when records pass through intact;
an older client rebuilding only fields it knows can drop `chatId`, selections, version proofs or
recovery evidence during a round trip. Preservation by such older writers is **not guaranteed**.
Keep compatible clients on all devices; never reconstruct lost identity from matching text.
Retaining many anchors on one source costs the source/projection once plus per-anchor captures,
not a full source copy for each anchor. Do not edit these records by hand.

## Selection return links

**Copy link to selection** creates a durable anchor before exposing an ordinary wikilink:
`[[chat-path.abchat#abele-selection=<encoded-chat-id>/<encoded-anchor-id>|Return to selection]]`.
Each ID is percent-encoded independently; the path is a navigation hint only. Returning rebuilds
an identity-to-path index across all `.abchat` files, including unopened/nested discussions,
validates identity even at an existing path, and asks for an explicit choice between copies.
The index is transient, not another persisted store. Discovery and path validation are read-only:
a whole main file wins; a torn file may use a whole safety copy matching its path and recovery
record-count rules. Neither the file nor the safety copy is repaired or removed by discovery,
so an active writer cannot lose its crash protection. Recovery belongs to normal serialized opening.
A recoverable torn file retains its identity and still counts as a duplicate.
Already-open sessions reconcile changed files before resolving the anchor, preserving their draft
and containing branch without flushing stale records. A conflict with pending local work is
reported instead of replacing it or exposing a cached current placement. Reconciliation captures
a local revision counter before reading; any local publication, setting change or write during
that read invalidates the return instead of applying the older snapshot. Return generations are
checked before tab activation as well as before publication. Repeated quotes are never matched
by proximity.

The chat text projector is `chat-text-v1`: concatenated rendered text nodes, excluding comment
badges and code-copy controls; positions use half-open UTF-16 offsets. The current message
source, retained projection and live renderer must agree before its recorded range is marked.
The active branch is retained if it contains the message; otherwise return chooses the oldest
valid descendant leaf, breaking equal timestamps by message ID. Historical placements open the
retained source read-only. Unresolved/conflicting placements keep the captured quote without
highlighting a guessed occurrence. This changes no message Markdown or provider history and
implements no card binding or script launch.

## Reply highlights and revisions

Assistant `msg` records may carry `highlights`: entries with `id`, `quote` (rendered text),
`start` (UTF-16 offset in that rendered text), and `color` (yellow, green, blue, pink, purple,
or orange). They are owner annotations, not markdown inserted in `content`. They travel in the
chat file and survive reopen and file sync. Provider history does not include their colours or
turn them into instructions or emphasis. A highlight whose exact anchor no longer matches is
not relocated to another occurrence; its removal remains available in the message actions.

A node tool-call `msg` refused for want of access may carry `nodeAccessRefusal`: `kind`
(`no-access`, `not-approved`, `no-worktree` or `offline`), `node_id` (empty when the chat had no
node access at all), and where known `project_id`, `target` (`kind` with `worktree_id` or
`workspace_id`), `access` (`edit` when the call would have changed files where the chat may only
read), `wanted` and `known` (the worktree asked for and the branches there are). It is what the
chat shows under the call with its way through; it grants nothing, and the agent reads the call's
text result only. Giving access afterwards never repeats the call.

A comment tool-call `msg` may carry `replyProposal`: `id`, `parent` (chat path), `message` (parent
reply id), `before` (expected full source), `from` and `old` (verified source passage), `text`
(replacement markdown), `request` (owner message), `author`, `at` (epoch milliseconds), and
`status` (`pending`, `accepted`, or `rejected`). A pending proposal changes nothing in the parent.
Only the owner's diff acceptance applies it, with a stale-source check. Tool permission modes
never bypass that decision. Acceptance is written to the comment file first with `application:
"pending"`; only then is the parent changed. A completed application records `application:
"done"`. If either later write fails, the accepted proposal can be resumed idempotently via
**Finish accepted revision**, not rejected; undo belongs to the parent reply. A stale externally
rejected comment or failed initial decision write never changes the parent.

An accepted parent reply keeps its id and timestamp, replaces `content`, and appends a
`revisions` entry: `proposal`, `before`, `after`, `author`, `at`, and the previous `highlights`.
A replacement written by the chat's interceptor is the same entry with `by: "interceptor"` and an
empty `proposal`; it is projected into the agent's history and undone the same way.
Rendered annotations are retained with the previous version, not guessed onto changed text.
Undo restores that version and its highlights, marking the revision with `undoneAt`. The oldest
`before` remains the original. These fields survive log compaction and file sync. Accepted revisions and undo also update linked assistant `int` text in the same parent-file
write, retaining tool and reasoning blocks. If compaction omitted that reply, an assistant
correction is stored after the summary, linked to the reply id. Corrections never elevate reply
text into a system message. This keeps provider history consistent on older v2 clients too;
the original remains in `revisions`, not the active provider transcript. Normal turns still
append internal records. Do not edit these records by hand.

## Comments

A comment chat is a conversation anchored to one place in a note. The anchor is a marker
written into the note's own text:

    The passage somebody asked about%%c:k7d2ph%%
    The same passage with two chats on it%%c:k7d2ph,3mq0xa%%
    A comment on a position rather than on any text:%%c:v9s1bn%%

`%%c:`, then one or more ids separated by commas, then `%%`. An id is six characters of
`[a-z0-9]`. The marker sits immediately after the passage it is about. Whether it quotes
anything depends on how the comment was made, not on what precedes the marker: one made with a
selection quotes that passage, one made without quotes nothing and marks a position instead.
Markers inside fenced code, inline code and frontmatter are not markers.

A marker is never written into the middle of a construct that a dozen characters would break: a
`[[link]]` or `![[embed]]`, a `[text](url)` link, inline code, a `==highlight==`, a `[^1]`
footnote reference, a callout's `[!type]` or a task's `[ ]` box. A comment made on a selection
that ended halfway through one of those is anchored after the end of it instead, and its quote
reaches that far as well. A fence, frontmatter, any line of a table and a callout's title line
have no such end, and a comment there is refused rather than written — the last two are drawn
by widgets of Obsidian's own, which swallow a marker whole and leave a comment nothing can
reach. The body lines of a callout take one normally.

**Never write, move or edit a marker.** It is an index into a file the plugin owns: an id with
no file behind it draws an icon that opens nothing, and a marker carried away from its passage
silently reattaches somebody's conversation to different text. Editing the note _around_ a
marker is fine — surviving that is what it is for. For an AI discussion, change the commented
passage with `edit_selection` rather than `edit`: it moves the AI discussion's stored quote
with the text. Human comments use exact quote resolution; changing their passage can leave an
unresolved point marker, as described below.

### Free-form text comments

Human comments use the same `%%c:<ids>%%` anchor tokens, but are **not chats**. Each thread
is versioned JSON at `<commentFolder>/<id>.abcomment` (default `AI/Comments`), next to AI
comments, never in chat history. Only the token enters the Markdown note. One thread owns
`anchor: { note, quote }`, `appearance` (one of the nine note highlight colours or `underline`)
and an ordered `entries` array. Every entry has a stable six-character `id`, Markdown `body`,
immutable full UTC ISO `createdAt` and optional full UTC ISO `editedAt`. The file also stores
`version: 1` and its six-character thread `id`, which must match its basename. Unsupported
versions, invalid timestamps, duplicate entry ids and malformed JSON are refused, not rewritten.

The thread file is created before the marker is published. A failure between the writes leaves
an orphan file which can be reopened and its marker explicitly republished; this does not
duplicate entries or change creation timestamps. Recovery uses a unique exact quote in the
current note, or an explicitly captured current selection when the quote is repeated. Selecting
the same passage with Add comment reopens the retained orphan instead of creating another thread. Cancelling an unsaved comment creates neither file nor marker. Writes compare the
current file revision to the revision read, refusing stale external changes rather than
silently overwriting them. Note and folder renames update anchors, including unloaded threads.
Removing one entry preserves its siblings. Final-entry deletion compares the revision inside
the native adapter's shared trash queue item, after any approval/recording delay. Writes and sync
updates through that adapter cannot enter between the check and trash; unsupported storage is
refused, not deleted with a separate precheck. Out-of-band filesystem writers do not participate
in this adapter queue. Only after the thread deletion succeeds is its marker id removed from
the note. A deletion refusal leaves the marker intact. Chained rename events are serialized. Manually removing a marker never collects the thread file.

Anchoring is exact, not fuzzy: text immediately before the marker, then the nearest exact
quote, otherwise an unresolved point marker. Changes before a passage survive; replacing the
passage may leave it unresolved. AI and human ids at one marker keep separate icons and counts.
These files are JSON system files, not ordinary Markdown notes or AI conversations. Media
cleanup scans their bodies relative to `anchor.note`, exactly like the dialog renderer, so
an image used only in a comment (including a relative `./assets/` link) is not considered unused. With
Obsidian Sync, enable syncing other file types to carry `.abcomment` files to another device.

### AI discussions

Each AI comment is a chat file of its own at `AI/Comments/<id>.abchat` — the folder is
`commentFolder` in the settings — in the same format as any other `.abchat`. The quoted
passage lives there, as `anchor.quote` in the file's metadata, together with `anchor.note`,
the note the marker sits in. The note carries the marker and nothing else. A discussion in a
book is a comment too, anchored to the book and a place in it (`anchor.cfi`), with no marker:
the book's highlights note lists it (see Book highlights). Comment files stay
out of the chat history until somebody opens one as a full chat. Not every user turn in one was
a question: a comment may hold notes the person kept without asking anything, which no agent
has answered and which are simply part of the conversation from then on.

A comment can also be on a message inside a chat — an agent's answer or the person's own. A
message has no text of ours to put a marker in, so the chat keeps the list itself, as `comments` in its own metadata:

    "comments": [{ "id": "k7d2ph", "message": "V1StGXR8_Z5jdHi6B-myT",
                   "quote": "night train", "start": 9 }]

`message` is the message's id, `quote` the words selected as they read on screen, `start` where
they begin in its rendered text; a comment on the whole message has neither. The comment
file's `anchor` is `{ note: <the chat's path>, message, quote }`. Deleting the chat deletes these
comments with it. Leave both lists to the plugin — an entry with no file behind it draws nothing,
and a file no chat lists is reachable from nowhere.

A comment is a chat, so its own messages can carry comments too, to any depth: the list is then
in the comment file's metadata, and the new comment's `anchor.note` is that comment file's path.
Following `anchor.note` upwards from any comment ends at the note or the ordinary chat where it all
started. A comment is tied to a message by the message's id, which neither compacting the
conversation nor editing a user message changes — a user edit starts a new branch and leaves
the old message where it was. An accepted reply revision changes that reply in place and keeps
its original in `revisions`; if its words no longer read the same, its icon sits
dimmed at the end of the message. Deleting a comment deletes every comment under it, at every
depth, and deleting a chat deletes the whole tree hung on it.

## Message cards

A message from a chat can be kept in a note: "Insert into note" in a message's actions writes a
fenced block at the cursor, which the plugin draws as a card with the message's text. Pressing
the card opens the chat — a comment as a comment — and scrolls to that message.

    ```abele-message
    chat: AI/Chats/Planning the trip.abchat
    message: V1StGXR8_Z5jdHi6B-myT
    title: Planning the trip
    date: 2026-09-23 14:05
    ---
    The message's text, as it was when the card was made.
    ```

`chat` is the chat file's path and `message` the message's id in it, always the first two lines
and in that order; everything after `---` is the text shown. `title` (the chat's title when the
card was made) and `date` (when the message was written, local time) are optional: the card
shows the chat's current title when the chat history has one, then `title`, then the file name,
with the date under it. The card's delete icon removes the whole block from the note. The fence is longer than three backticks when the text holds a fence of its
own. The text is a copy: editing it changes what the card shows, not the chat. A chat renamed
since is found again by the message id and the `chat` line is corrected when the card is next
pressed. Do not invent these blocks — a `message` id that is in no chat opens nothing.

## Saved key identity

Named saved keys in `ai.secrets` carry a stable `id` independent of their editable `name` and
keychain reference `keyId`. Older records acquire identities at settings load, persisted by
migration without changing keychain references. A legacy keychain reference is sufficient
when unique; labels distinguish older aliases of the same key, with a suffix for duplicate
records. Unsaved new records acquire an identity before editing. Settings transfer carries
each saved-key record separately by this identity, and `ai.autoRetry` travels in AI general
settings. Incoming settings cannot move an open key editor onto another record.

## Model client identity

Model connections may store `ai.providers[].clientName`, image connections
`ai.imageProviders[].clientName`, and dictation `ai.voice.clientName`. These optional text
values select the request's `User-Agent`, not an agent's display name or prompt. Absent,
empty or whitespace-only leaves the existing transport identity unchanged. Whole providers,
image providers and the voice block carry these fields in settings transfer. Sharing a
keychain reference does not inherit another connection's client name. See `settings` for
transport limitations.

## Mobile background audio

`ai.backgroundWhileAgents` and `ai.backgroundAlways` are booleans, both false by default.
They travel in AI general settings. Their settings rows and audio playback exist only on
mobile. The first keeps silent looping audio active during agent turns and releases it two
seconds after the last turn ends; the second keeps it active even when idle. The plugin uses
the mixing-friendly ambient audio session where supported, never an exclusive playback
session. Operating-system suspension, autoplay and battery policies can still prevent
background execution. No audio file is stored in the vault.

## Returning from mobile suspension

While a local agent turn is in memory, native app-state and mobile visibility/page lifecycle
events identify an unfinished model request that failed across backgrounding. Hosts that keep
the document visible also use suspended JavaScript timer gaps to detect return. On return, that request is retried
without requiring a button press, independently of `ai.autoRetry`. A quiet reconnecting status
appears in the chat. Completed response messages and tool results remain in history; only the
failed response is requested again, and its uncommitted partial text/tool arguments are
replaced rather than appended. No completed tool is replayed. A frozen, idle transport is
cancelled after a short return grace period; a healthy stream or a running tool is not.
Stopping, replacing or destroying the conversation cancels its reconnect. Authentication and
other non-transient provider refusals are not automatically retried. Recovery does not survive
an app process being killed or a plugin reload; it is not a durable background job.

## Model request timeout

`ai.requestTimeoutSeconds` stores the shared chat-model timeout in seconds, defaulting to 60.
Values from 1 to 3600 are accepted; absent or invalid values use 60. Each model in
`ai.providers[].models[]` may store its own optional `requestTimeoutSeconds` in the same
range. An absent or invalid model override follows the global value, then 60 if that is
invalid too. Clearing the model field removes the override rather than copying the current
global value. The override travels with its whole provider in AI providers; the global value
travels in AI general settings.

The resolved timeout limits connection wait, error-body reading and each idle wait for a
streamed chunk, not the whole response. It applies to all OpenAI-compatible chat models,
including background, review, fallback and delegated requests. Other request types keep
their own limits.

## Background model settings

The shared `ai.auxiliaryModelId` setting stores `providerId::modelId` for new background-model
selections, so providers offering the same model name remain distinct. Older bare model IDs
are still read by searching providers in their configured order. An agent's own background
provider/model pair takes precedence, and an empty global selection follows the chat's model.

## GitHub connection settings

Connection records may also carry a `provider` string. Missing means GitHub; existing IDs and
keychain slots are retained. Other provider records retain their full normalized deployment
base (scheme, host, port and path) in `server`. Unknown provider names survive normalization
and transfer but are unavailable to the GitHub adapter. Only GitHub records participate in the
old single-server credential projection or legacy agent-grant migration. Transfer credential
bindings include provider and deployment path; replacing a connection cannot retarget an
existing slot. Forgejo and Gitea adapters share the existing inbox pane; its account selection retains a connection ID, never a credential.
Codeberg presets persist as `provider: forgejo` with the Codeberg deployment base. Defaults
are independent per provider and exact deployment; account connections keep separate IDs and
key references even on one server. Transfer without keys preserves those references, so a
missing key remains unavailable rather than becoming anonymous access or another account.
New connections do not inherit legacy GitHub agent grants. Removing or rebinding a connection
retires its cached/pending authority without changing remote repositories or node files.

New remote adapters have a version-1 workspace target with provider, connection, normalized
deployment, full repository path and original URL. Restoration validates the API binding and
repository URL boundary and discards unrecognized fields. Unknown target versions/providers
remain unavailable. Existing GitHub URL-only leaves, snippets and comparison-pin keys retain
their format; this adds no persistent source-content cache.

The plugin's `github.connections` list in settings holds stable connection IDs, names, server
addresses, repository-owner patterns, per-server default marks, the last explicit access-check verdict (ok, partial, refused or error), and optional account metadata
(discovered login, avatar URL and access-check time). Each `keyId` names a keychain slot, never
contains the token. A migrated connection keeps the old `github.keyId` slot; the old `keyId` and
`server` fields are retained as a single-server compatibility projection. An explicitly empty
list does not reimport an old token. Connection entries can be selected individually in settings
transfer; keys travel only when the transfer includes keys. The separate notifications credential
is still part of the GitHub general settings block. Its `boundKeyId` and `boundServer` retain
its original server when the projected default moves to another host; the old-version
`notifications.keyId` is blanked if the old plugin would send it to the wrong host. Deleting a
connection forgets its local keychain slot, not the encrypted shared copy another device may
still use; unused shared keys can be revoked deliberately in the synced-key catalog.

Repository trees, downloaded search indexes and pending builds use an opaque credential
generation, not a host/repository-only key. These are session memory, never settings or note
files. Token replacement, server edits, connection removal and key-store lock changes retire
the previous generation; a retired request cannot publish a late result. GitHub workspace tab
state also holds `connectionId` and `connectionIntent` (automatic or manual) beside its URL.
Account-only navigation adds a history entry. Successful repository routing lives in session
memory; item refusals expire after roughly ten minutes. Manual owner preferences live only in
connections' `owners` lists. An agent opening a tab may attach a runtime-only allowed-connection
restriction; it is not persisted as permission granted by the person. Each stored agent may
hold `githubConnections`, a map from stable connection IDs to `off`, `ask` or `auto` (shown as
Off, Ask, On). A missing ID means Off. New agents store an empty map. Saved agents lacking
the entire map migrate once: only the original `github-legacy` credential receives Auto if any
GitHub tool is Auto, otherwise Ask if any is Ask; agents with all GitHub tools Off get an empty
map. An existing map is never broadened. It travels with the agent; unresolved IDs remain visible
in its Access settings until the connection arrives. One-operation approvals and executing-agent
restrictions on a tab are runtime-only, never written as persistent grants. Each Ask grant
also identifies the exact credential generation approved, not only the connection ID; token,
server, or key-store state changes invalidate it for primary and secondary tab loads.

## GitHub file tree layout

Obsidian's vault-scoped local storage holds `abele-github-tree-panel` (whether a new desktop
GitHub tab starts with the tree open) and `abele-github-tree-width` (the desktop split width in
CSS pixels, or null for the default 18em). The width is clamped to fit the current tab without
rewriting the saved preference. These are device-local UI choices, not plugin settings, synced
files or settings-transfer entries. A narrow tab keeps its drawer layout regardless of the
remembered desktop width.

## GitHub links

A GitHub tab writes plain markdown links into a note when the person asks it to — "Insert into
note" on a comment, on the item itself or on selected lines of code — at the cursor of the note
last worked in, on a line of its own:

    [acme/widgets#42 · src/app.ts:10–20](https://github.com/acme/widgets/pull/42/files#diff-<sha256 of the path>R10-R20)
    [acme/widgets#42 · comment by alice](https://github.com/acme/widgets/pull/42#issuecomment-123)
    [acme/widgets@1a2b3c4 · src/app.ts:10–20](https://github.com/acme/widgets/blob/<full commit sha>/src/app.ts#L10-L20)

The address is GitHub's own and opens the same place on GitHub; with the integration on, a click
on it opens a GitHub tab scrolled to that line or comment. The label is only text. A link to a
file is pinned to a commit, not a branch, so it keeps pointing at the lines it was made from.
Lines of a markdown file — selected in its rendered view or in its code — are linked to the
source with `?plain=1` before the anchor (`…/README.md?plain=1#L3-L7`), which is how GitHub
itself shows a markdown file's lines; a snippet of them carries `lang: md`. In a GitHub tab such
a link opens the file rendered, with the pieces holding those lines marked, unless the GitHub
setting "Markdown files open as" is Code (`github.markdownView` in the plugin's settings).

## GitHub people

The names and pictures of the people shown in GitHub tabs are kept in `github-users.json` in the
plugin's own folder, on this device only: under the server and the login, the name from the
profile (or none), the picture as a `data:` URL, and when each was read. An entry is asked for
again after a week. Nothing in a note depends on it — links and snippets name people by login —
so the file can be deleted at any time; **Settings → GitHub → Kept names and pictures → Clear**
does the same.

## External event completion

An external calendar's checkbox marks **one occurrence**, not the recurring series. It is an
owner annotation only: Abele never writes it back to ICS or CalDAV. Calendar chips, the event
menu and timeline rows can mark it done or undone; completed events follow the same completed
visibility control as tasks. The calendar view's control hides completed notes and events together.

Marks are stored in `calendarCompletion` in the plugin's `data.json`, alongside the calendar
definitions, like other shared plugin settings. Sync the plugin settings to carry them to other
devices; **Calendars** in settings transfer also carries them. They are not in the device-local
calendar cache, so deleting that cache does not clear them. Settings received from another
device replace these marks like other settings; this is not a concurrent per-occurrence merge.
Local mark edits made while an older settings read is still in flight are retained, without
reverting unrelated incoming settings or marks.

Each key is a JSON tuple `[feedId, uid, recurrenceId]`; a one-off has `null` as its last part.
Recurring occurrences use their original start (or `RECURRENCE-ID` for a detached override),
never their rescheduled start: `date:YYYY-MM-DD` for all-day events, `floating:` followed by the
source wall time for floating events, or `instant:` followed by epoch milliseconds for zoned
times. An unresolved source zone keeps `wall:` with a JSON tuple of its zone name and source
wall time instead of using a device offset. Moving an occurrence or changing the device timezone does not change the mark. A value
holds `feedId` and `seenAt`, the last successful observation or tick time in epoch milliseconds.
No event title, description, link or calendar credential is stored in a mark.

On successful calendar reads, marked occurrences still present renew that observation at most
once a day. Marks absent from the expanded window for **180 days** are removed, including old
occurrences that have fallen out of the window and marks of removed calendars. A failing feed
does not prune its marks, and a disabled feed retains them until read again. Unticking removes
the mark immediately. Legacy event-only caches are refreshed before ticking, so missing
occurrence identity can never accidentally mark a whole series. If a detached override's old
ID changes during that refresh, its feed, UID and displayed start must identify exactly one
refreshed occurrence. Ambiguous matches or an occurrence moved again since caching require a
fresh tick on the updated row instead of guessing which occurrence to mark.

## Calendar cache

The events last read from each external calendar (**Settings → Calendars**) are kept in
`calendars-cache.json` in the plugin's own folder, on this device only: per calendar, when it was
read, the version tag its server gave, and every occurrence from a month back to half a year
ahead — title, start and end, place, description, link and the people invited. It is what the
lists show before the network answers and when it does not. Nothing in a note depends on it, so
it can be deleted at any time; the next read writes it again. The links and passwords are not in
it — they are keys, in the keychain. Cache version 2 identifies credentials only by a
per-key generation number, not a password or secret-link checksum. The generation and its
change detector stay in the device keychain. Version 1 caches are discarded once and refreshed;
changing a credential invalidates its cached source, including a response already in flight.

## Exchange-rate cache

Today's exchange rates (**Settings → Finance → Exchange rates**) are kept in
`exchange-rates.json` in the plugin's own folder, on this device only: one table of how many units
of each currency a US dollar buys, with the day each rate is for and its source, the moment it was
fetched, the moment of the last attempt and, when that failed, why. It is fetched at most once a
day, and after a failure at most once an hour. The request is the whole public table against the
dollar, from Frankfurter (`api.frankfurter.dev`) and, for currencies it lacks or when it fails,
currency-api (jsDelivr, then its `currency-api.pages.dev` mirror); it never names the currencies
the vault holds, and needs no key. Offline, the last table is used; older than four days it is
marked stale. Nothing in a note depends on it: it can be deleted at any time, and the next fetch
writes it again. It is not synced and not carried by settings transfer. The two settings that
govern it, `fetchExchangeRates` (on by default) and `displayCurrency` (`USD` by default), are in
`data.json` and do travel. Converted figures are only shown and sorted by; no balance or note is
ever written in another currency.

## Native repository records

Native pinned and recent repository entries retain version 1, provider and complete deployment
base alongside the repository URL. Legacy GitHub URL-only entries remain readable. Native
snippets use the `abele-forge` fence with `version: 1`, `provider`, `server` and `repository`
fields in addition to the existing snippet fields below. They contain copied text and safe
source identity, never connection IDs, tokens or keychain references. Unsupported versions are
not interpreted as another provider. They render offline after a connection is removed.
Native PR submission outcomes and uncertain write fingerprints are bounded session memory,
not durable recovery records; restarting the plugin does not establish whether a lost write
succeeded. Fingerprints remain tied to the connection, deployment and operation across credential
refreshes and conversation remounts. There is no automatic write replay.

## GitHub snippets

"Insert with code" on lines selected in a GitHub tab, and "Insert as quote" on a comment, write a
fenced block the plugin draws as a card: the label as a link to the place, then the code — or
the comment — itself.

    ```abele-github
    url: https://github.com/acme/widgets/blob/<full commit sha>/src/app.ts#L10-L12
    label: acme/widgets@1a2b3c4 · src/app.ts:10–12
    lang: ts
    start: 10
    ---
    the lines, as they were
    ```

`url` and `label` are what a copied link has. `lang` is the file's extension and picks the
highlighting. Lines of a file carry `start:`, the number of the first line. Lines of a diff
carry `diff: true` instead, and the text is unified-diff lines (` `, `-`, `+`) under an
`@@ -old +new @@` line holding the numbers of both sides. A comment carries `comment: true`, and
its text is a `**author** · date` line, a blank line, then the comment's markdown. The fence is
longer than three backticks when the text holds a fence of its own.

The text is a copy taken when the block was made: it reads without GitHub and does not follow
the repository. Editing it changes what the card shows. A block without `url`, `label` or the
`---` line is shown as plain text, as written. Do not invent these blocks: `url` must be an
address the GitHub tab can open.

## Plugin version on this device

The changelog is bundled with the plugin, not written into the vault or fetched from a
server. Obsidian local storage keeps `abele-changelog-version` with schema 1 and the last
plugin version run in this vault on this device. It is not `data.json`, a note or part of a
settings transfer. The first run with this feature sets a quiet baseline; no previous version
can be inferred from older installations. On an upgrade the new baseline is saved before
showing a dismissible notice. A downgrade records the older version silently; re-upgrading
can offer its changes again. The changelog's recovered historical boundaries use commit
dates, not claimed publication dates.

## Where notes were left

With `rememberNotePlaces` on, each device keeps, outside the vault, where every note it opened
was left: the scroll and the cursor, by path. A note opened plainly comes back there; one opened
at a heading, a block, a search result, a line or a book's highlight goes to that instead.
Nothing about it is written into notes or synced, a rename carries the place along and a delete
drops it. The local footer-view memory also keeps expanded list pages, opened task descriptions,
whether the timeline's overdue fold is open (`calendarOverdue`), whether the note’s logs
use the month view (`logsCalendar`), and whether its calendar tasks do (`tasksCalendar`, only
under a note; the timeline sidebar is always a list). The same record keeps each calendar's month/year choice
(`logsYear` and `tasksYear`, true for year, absent for month), even while its list is shown.
The sidebar stores its own choice in local storage as `abele-sidebar-calendar-view`
(`month` or `year`); these preferences are device-local, not transferable settings.
Both view choices follow a renamed note and
are kept locally rather than in note content, independently of `rememberNotePlaces`. An open overdue fold
is drawn again before restoring a saved overdue-task anchor. Past days with done tasks show only
while the completed switch shows done tasks, which is not remembered; an older `calendarPast` or
saved day boundary is still read but no longer opens anything.
With place restoration off, the timeline starts at today. Search windows are not remembered.

## Places

The separate Abele Bases map view uses `type: abele-map`; the `map` type remains owned by
Obsidian Maps. It reads the upstream 0.2.2 option keys `coordinates`, `markerIcon`,
`markerColor`, `center`, `defaultZoom`, `minZoom`, `maxZoom`, `mapHeight`, `mapTiles` and
`mapTilesDark`. Selectors are native Bases property IDs (`note.*`, `formula.*`); Bases owns
formula evaluation, filters, search and row order. `groupNearby` defaults to true and can be
set to false for separate markers. Map viewing, panning, theme changes and filtering do not
write notes or Base configuration. History camera state is ephemeral. Only explicit menu
actions save `center` or `defaultZoom`. Native Bases note creation writes a compatible
`lat, lon` string into an ordinary note property chosen by the user, never a formula output.

Plugin settings store `mapBackgrounds`, an ordered list of `{ id, name, light, dark }` objects;
`light` and `dark` are URL arrays. Multiple raster templates draw layers. Missing dark URLs
fall back to the light URLs. The list travels in the Maps settings-transfer section.
Explicitly copying upstream backgrounds reads its `tileSets` list without writing it.
Background selection in an open map and device-location watches are not persisted. Location
watches are released when that map closes. This view does not migrate existing maps.
Place-card contents are read on demand from current notes; Abele gallery pictures use the
same local-link resolution and viewer as galleries. Cards do not save note content.
List visibility, selected place, sorting origin and refreshed centre are temporary per-view
state, not stored options. Moving the camera does not reorder the list until refresh.
Distances measure a straight line; they do not request routes. A selected coincident marker
can move visually apart from its remaining group without changing the stored coordinates.

A place is a note with its coordinates in one property, written `lat, lon` — `coordinates:
"56.9496, 24.1052"` by default, or whatever `mapCoordinatesProperty` names in this vault. The
map block accepts both `coordinates` and `location`. Five decimals is about a metre, which is
as precise as anything here needs. Obsidian's map view reads the property; an `abele-map` block
written into the note carries its own points and routes. Both are read when shown rather than
cached anywhere.

## Diagrams

A fenced ` ```mermaid ` block is drawn as a diagram — in notes, in the chat and in GitHub
tabs — so a flowchart, a sequence, a class, state, ER or Gantt diagram, a timeline, a pie or a
mind map is written as Mermaid source in the note rather than as a picture. The person sees it
at the width of the note and zooms, drags or opens it full screen themselves, so a large diagram
is fine: do not split one up to make it fit, and do not add `%%{init}%%` sizing for it. Leave the
theme alone too — it follows Obsidian's light or dark theme unless the source picks one. A node
given the class `internal-link` links to the note its label names. The source must parse: a
block with a syntax error shows Mermaid's error in place of the diagram. Nothing is drawn until
the person has allowed diagrams in the vault (Obsidian asks once); the block is still the right
thing to write.

## Transfer files

Files named `Abele transfer <date> <time>.txt` are settings on their way to another device: one
line beginning `ABL1:`, holding the settings the person ticked on the Transfer tab, compressed
and — if a key went with them — encrypted. The Transfer tab saves them outside the vault where
the device lets it (a save dialog, the share sheet), and otherwise into the hidden
`.abele-transfers/` folder, which Abele Sync never carries; older versions put them in the
vault root. They are not notes, they are not content, and nothing reads them except the
Transfer tab on the receiving device. Leave them alone; the person deletes them when the
transfer has landed.

## Scripts from other devices

With `ai.confirmForeignScripts` on, each device keeps, outside the vault, the SHA-256 of every
version of a script it wrote or had confirmed, and runs from a button, an automation, startup or
an agent only a version it has. Nothing about it is stored in the vault: a script file is just
its text. A script the agent writes or edits with its file tools counts as written on this
device; on another device the same change waits to be confirmed there.

Choosing Not now in script review keeps the script unconfirmed and suppresses its arrival
notice for that exact path and content hash across reloads on this device. Up to 256 such
revisions are kept in the device-local `abele-script-notice-dismissed` preference. A changed
revision notifies again; an aborted review does not record a dismissal. The review command
still lists the waiting script, and its execution approval is unchanged.

## Sync path identity

Sync directory metadata (`v2-directories` in the device ledger) uses schema version 2. Server
paths remain NFC; `localPath` retains each physical spelling alongside its directory identity.
Existing records migrate without resetting file entries or the feed cursor. Pending directory
requests retain their original operation and idempotency key. Legacy removals without identity
evidence remain held. Downgrading this metadata to an older client is unsupported; preserve the
ledger rather than resetting it. Normalization collision evidence is retained in
`normalization-collisions` and `normalization-directory-collisions` across restarts. Physical
paths in write journals, projections and retained artifacts remain unchanged.

## Synced keys

The plugin's settings file (`data.json` in its folder under the config directory) holds, when
the person has turned synced keys on, a `secretStore`: every API key and token the plugin
holds, encrypted with AES-GCM under a key derived from a passphrase (PBKDF2-SHA-256, the salt
and iteration count stored beside it), with a check value that tells a wrong passphrase from a
damaged file. It lives in the settings file rather than a file of its own because Obsidian
Sync carries only `data.json`, `main.js`, `manifest.json` and `styles.css` out of a plugin's
folder. Without the passphrase it is unreadable. Each device keeps only the derived key, in its
own keychain. The device sync token is never in it: that one belongs to the device that
enrolled, and stays in its keychain alone.

Two devices changing keys at once are merged key by key, the later change winning, and the
store out of a Syncthing conflict copy of the settings file (`data.sync-conflict-….json`) is
merged the same way; the copy itself is left for the person to delete. Never edit the store
by hand: a single changed character makes it undecryptable on every device. Once the store is
turned off, `secretStore` holds only `{"off": true, "id": …}`, the marker that tells the other
devices so; a settings file with no `secretStore` at all turns nothing off.

## MCP servers

The MCP servers connected in the settings are kept in the same settings file, `ai.mcpServers`:
each server's address, the headers sent to it, the name of the keychain slot holding its token
(never the token), and a copy of its tool list from the last time it was fetched — names,
descriptions and parameter schemas, as the server gave them. Nothing is written into the vault.

MCP entries in `ai.toolModes`, each agent's `toolModes`, and saved chat overrides use
`mcp:` followed by the JSON pair `[server.id, originalToolName]`. Provider-facing names are
only aliases, not permission keys. Renaming a server keeps these entries unchanged; settings
transfer carries the identities and mode maps. At upgrade, `ai.mcpLegacyToolMap` freezes each
legacy `mcp_<server>_<tool>` alias's owners as `{ serverId, toolName, serverName }` records.
Closed legacy chats use that snapshot when later opened, never the server labels at that time.
The snapshot travels with AI general settings but never replaces one already established in
the receiving vault. A legacy mode migrates only for a unique recorded owner still present;
ambiguous or removed owners become `ask`. Unmatched aliases are retained as dormant `ask`
entries under `mcp:unresolved:` followed by their JSON-encoded alias. One notice lists the
choices to set again, and the migrated chat is saved so the notice does not repeat.

Saved pending MCP calls also carry `permissionKey` and `destinationKey`, pinned from the tool
list offered in the model request. The destination is the JSON pair `["http", fullEndpointUrl]`
(HTTP is the only supported MCP transport); saved agent modes still use the server/tool identity.
Approval and execution require the current alias to select the same tool and exact endpoint. Missing tool or destination identities in older pending calls, removed tools, reassigned
aliases and changed endpoint URLs are refused with a request for a fresh call; they never select a replacement server.

## Sync

Sync access is being rebuilt around one token connection kind. Each token carries an address,
a bearer key and a stable folder/group selector. Root `/` is an ordinary folder selector.
Connection state and secrets remain device-only; settings transfer does not connect another
device. The native token UI and production v2 engine are active for root and folder connections. A self-hosted **abele-sync** server is required; there is no hosted service. Groups fail closed while their access is being prepared.
See **Token connection registry** below for the local record and discard semantics.

The retained file engine keeps its independent journals, immutable pending bytes, file/version
identities, history and conflict handling. Its path coordinator protects placement together
with state updates across independent connections; network downloads do not hold path leases.
Incoming executable operations require immutable source-aware review in the later review stage.
Attachment consent is connection-specific and cannot be granted by background processing.

## Screenshots

Every picture the `screenshot` tool takes — of a note, or of the visible part of a script view —
is written to the attachments folder as `Screenshot <what> <YYYY-MM-DD HH-mm-ss>.png`, the
same folder generated images go to. That is what lets the chat show the picture under the tool
call, so the person sees what the agent saw. They are ordinary image files: nothing reads them
back except the chat that made them, and nothing deletes them — one more each time the tool is
called. A person who does not want them keeping is the one who removes them, like any other
attachment.

## Books

Book files anywhere in the vault — `.epub`, `.mobi`, `.azw`, `.azw3`, `.fb2`, `.fbz`, `.cbz` — open
in Abele's book reader, a tab of its own; `.pdf` files
open there too when the person has chosen so, and otherwise in Obsidian's own viewer. The plugin
never changes a book or PDF file. Where each book was left is kept outside the notes, in
a JSON file in the vault — `abele-book-places.json` at its root unless the reader setting
`placesPath` says otherwise — so every device reads the same places. It maps a key to a place:
the book's `dc:identifier` as `id:<identifier>`, so renaming or moving the file keeps its place,
or `path:<path>` for a book without one; each place is `{ cfi, fraction, path, at }`, `at` being
when its position last changed, in epoch milliseconds. A normal reader open adds optional
`openedAt` (the last successful open, without changing `at`), `title` and `author` from the
book's own metadata, and `measure: { kind, count }` with `measureAt` (epoch milliseconds when
the measurement changed). Position (`at`), last opening (`openedAt`, with cached metadata),
and measurement (`measureAt`) merge independently. An incoming legacy position that omits
these optional fields does not erase them. Measurements saved before `measureAt` existed use
their recorded opening/position time as a fallback when merging; a measurement-only update
neither advances `at` nor makes the reader follow another device. `kind: 'locations'` is the engine's
whole-book text locations (roughly 1,500 bytes each) for reflowing books; `kind: 'pages'` is
its fixed-layout/PDF page count. These are **not printed-edition pages**. Older records omit
these fields; nothing reads unopened binaries to fill them. A new open before any saved CFI
may have an empty `cfi` and `at: 0`, which is not a saved position. Every device writes that file and keeps the latest `at` for each
book. A copy, `book-places.backup.json`, is written just before it in the plugin's own folder, on
this device only. Obsidian's file list does not show a `.json` file; Obsidian Sync carries it with
"Sync all other types" on. The only note written beside a book is its highlights note; a PDF with ink also has its ink folder.

Bookmarks — pages the person marked to come back to — are kept the same way, in
`abele-book-bookmarks.json` in the same folder as the places file, under the same book keys: each
key maps bookmark ids to `{ id, cfi, fraction, label, text, created, at }` — the page's CFI (a
PDF's page as `/6/<2×page>`), the chapter or page it is in, the page's first words, and when it
was made and last changed, in milliseconds. A removed one stays as `deleted: true` for 180 days, so
another device's copy does not bring it back. Every device keeps the latest `at` for each bookmark;
`book-bookmarks.backup.json` in the plugin's folder is this device's copy. The agent sees them
through `book_views` and `book_highlights` and adds or removes one with `book_bookmark`, never by
writing the file. Writers on this device share a per-file queue for the whole read–merge–backup–write
transaction, including separate agent invocations; each retains its own rewind attribution.

`.epub` and `.pdf` files can be linked at a place, like notes at lines. The place goes where a
heading would: `[[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:22|Chapter 3]]` (an EPUB CFI without its
`epubcfi(…)` wrapper, with `[`, `]`, `(`, `)`, `|`, `#`, `%`, `^` and spaces percent-encoded) or
`[[Papers/Paper.pdf#page=4]]` (a PDF page, from 1). A click opens the file there. Give the link a
label saying what is there, usually the chapter.

### Navigation panel width

Obsidian's vault-scoped local storage holds `abele-book-panel-width`: the reader's desktop
navigation split width in CSS pixels, or null for the default 21em. The split uses the same
12em minimum and smaller-of-40%-or-36em maximum as the GitHub file tree. A narrower tab clamps
the displayed width without rewriting the saved preference. This is a device-local UI choice,
not a plugin setting, synced file or settings-transfer entry. On narrow screens the navigation
panel remains a drawer, independent of the remembered desktop width.

### Book highlights

A book's highlights are kept, by default, in `<book name> highlights.md` beside it, with
`type: book-highlights` and `file: "[[<the book file>]]"` (a wikilink, extension included, in a
File property). Notes made before this link it as `book:` instead, which is read the same way;
leave either as it is. It is found by that property, not its name. Each highlight is one callout, in the order of the book:

```markdown
> [!quote|green] [[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:22|Chapter 3]]
> Fear is the mind-killer.
>
> The person's comment, after a blank quoted line.
```

- The type is always `quote`; the colour after `|` is one of `yellow`, `green`, `blue`, `pink`,
  `purple`, `orange` (none means yellow).
- The title is a link to the place (`#cfi=…`), labelled with the chapter or `Page N`.
- The first paragraph is the highlighted words as they were; after a blank `>` line, the comment.
- A highlight is told apart by its place: two callouts linking to the same CFI are one highlight.
- In reflowing EPUBs, if the saved CFI points away from the quote in an opened chapter, the reader may draw the words at a found occurrence instead. The highlight's action row offers **Repair highlight link…** only for verified mismatches. A confirmation lists one or all mismatches found in chapters opened during this reading session; it does not audit the whole book. No link is changed on detection or dismissal. On confirmation only the encoded CFI value of each selected callout title link changes; all other note bytes, including quote and comment, remain as written. Changed, duplicated or colliding locations are skipped. Repeated quotes use the nearest occurrence when the saved anchor is available, so inspect the proposed context before confirming. Other copied links and a discussion's separate saved anchor are not repaired.
- A **discussion** — a chat about the words, started with "Ask here" in the reader — is kept in the
  same note: its chat's file linked after the place in the title. Words only asked about are a
  `chat` callout with no colour; a highlight that was asked about keeps its `quote|colour`:

  ```markdown
  > [!chat] [[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:22|Chapter 3]] · [[AI/Comments/k7d2ph.abchat|Discussion]]
  > Fear is the mind-killer.
  ```

  The chat is a comment (see Comments): its file is `<id>.abchat` in the comments folder, with
  `anchor: { note: <the book>, quote, cfi }` — the book and the place, and no marker anywhere; the
  book is never written to. The link is how the reader finds the chat again, so leave it as it is;
  removing the callout takes the mark off the words and leaves the chat where it is.

- Other callouts, headings and paragraphs in the note are the person's and are left as they are.

**Where highlights go is a setting** (`reader.notesTo`, `notesPath`, `notesTemplate` in the
plugin's settings, and per book `reader.bookNotes[<key>]`, the key as for places): a note of the
book's own as above, or one named note several books share. In a shared note a book's highlights
are the callouts whose place link resolves to that book; a new one is added at the end, its link
labelled `<title> · <chapter>` unless a template says whose it is. A place no chapter of the
contents comes before is labelled with the book's title. Highlights written before the
choice changed stay where they are and still count while their note is the book's own or named in
the settings.

A **template** is an ordinary note in the plugin's template language. The first highlight makes
the note from all of it; after that only the part between `{{#body}}` and `{{/body}}` is added,
at the end, for each highlight. In it `{{ highlight }}` is the callout above (on a line of its
own); `{{ title }}`, `{{ author }}`, `{{ book }}` (a link to the book), `{{ chapter }}`,
`{{ color }}`, `{{ link }}` (to the place) and `{{ date }}` / `{{ date.format('…') }}` are filled in,
anything else is left as written. A template without a body gets each highlight at the end.
Removing a highlight removes the lines its body wrote around it while they still read as written.

The quote and the comment can be fields of their own: `{{ quote }}` is the callout (on a line of its
own) and `{{ comment }}` is the comment, on a line of its own with whatever the body puts around it
(`**Comment:** {{ comment }}`, `> {{ comment }}`), before the quote or after it. With that field the
callout holds the words alone and the comment is kept in the field — read from there and written
there when it changes — for as long as the lines around the callout still read as the body wrote
them; otherwise, and in notes written before, the comment is inside the callout as above. A comment
of several lines goes on the lines after the field's, each with its `>` marks if it has them;
without them its blank lines are left out, since a blank line ends it.

A highlight can also name **forms of its word to underline everywhere in the book**. With a
`{{ forms }}` field in the template's body (on a line of its own, like `{{ comment }}`), they are
kept there, comma-separated; otherwise as the callout's last line, `> forms:: māja, mājas, mājā`,
after a blank `>` line. Keep either shape when editing; an empty field or no line means none.
Set them with `book_highlight` or `book_highlight_edit` (`forms`) rather than by hand. In the note the
forms are a link: it opens the book with its search on them, every place listed. Any link to a
book can do the same: `[[Books/Novel.epub#words=māja,mājas]]`.

The open book redraws whatever the note holds as soon as it changes, so adding, recolouring or
removing a highlight by editing the note is fine; keep the shape above or the reader will not see
it. To highlight words, prefer `book_highlight`: it finds the exact place (a CFI a hand-written
link rarely gets right) and writes the callout where the settings send it, template included.

### Words underlined everywhere

A note whose properties name forms of a word is a **vocabulary rule**: the book reader underlines
each form wherever it stands as a whole word in the books the rule applies to, and a tap on one
opens the note. A translation card is the usual one:

```yaml
word-forms: [māja, mājas, mājā]
word-language: lv
word-books: ['[[Books/Novel.epub]]']
```

- `word-forms` — a list; the note is a rule while it has one. Matched whole and case-insensitively;
  letters with a diacritic are other letters, and nothing is stemmed, so list each form.
- `word-books` — wikilinks to the books it applies to, extension included.
- `word-scope` — `book` (the default: the books listed) or `language` (every book whose language
  is `word-language`, by primary tag: `lv` matches `lv-LV`). With neither books nor the language
  scope it applies nowhere.
- `word-underline: false` — off, the forms kept.

Several rules (notes, highlights with forms) for the same word make the tap a menu. Reflowing
books and PDFs with selectable text use the same forms and properties; scanned/image-only PDF
pages need a text layer to show underlines. Other fixed-layout books are not supported. Only
single words are underlined. Language-wide rules require the book's language metadata (a PDF
without it can still use book-scoped rules). Scripts write these properties with
`vocabulary.mark`; write them by hand the same way.

### Ink on PDF pages

What is drawn on a PDF's pages (the pen under the page) is kept in the vault, never in the PDF:
one SVG per page in a folder beside the book, `<book name> ink/<book name> page <N>.svg` (N from 1).
Each file is the page's size on white paper, one `<path>` per stroke; the reader reads back only
each path's `data-tool` (`pen` or `marker`), `data-color`, `data-size` and `data-points` (`x y
pressure`, repeated, in the page's units at 100%). The page's first stroke also puts a callout into
the book's highlights note, the picture embedded, so it shows without the plugin:

```markdown
> [!ink] [[Papers/Paper.pdf#page=4|Page 4]]
> ![[Papers/Paper ink/Paper page 4.svg]]
```

A page whose last stroke is erased has its file and its callout removed. Renaming or moving the
PDF renames its ink folder and files. A change to a file from another device is drawn when it
arrives.

New reader strokes additionally store `data-linear="1"`, `data-simulate-pressure="true|false"`
and `data-streamline="0.5"`. These preserve the same freehand outline after reload; the original
tool, size, colour and point attributes remain, so older readers still open the files. New
marker paths use a filled outline with `fill-opacity="0.4"`; older marker paths remain stroked.

## Drawings

The picture editor saves crop, quarter turns, mirror and ink together as flattened pixels at
the source resolution, clipped to the crop frame. Copies use a free `drawn` name beside the
source. PNG, JPEG and WebP retain their format; HEIC/HEIF copies are JPEG and cannot overwrite
their source. Edits remain in the open editor until explicitly saved or discarded.

A drawing is an `.svg` file anywhere in the vault whose root element carries
`data-abele-drawing="1"`. Standalone editing and creation have been removed; SVGs open in
Obsidian's picture view and saved legacy drawing tabs are read-only. It is an ordinary picture — white paper sized to what is drawn plus a
margin, one element per item — so `![[Sketch.svg]]` shows it in a note without the plugin. What
the plugin reads back is only the JSON in `<metadata id="abele-drawing">`: `{ "v": 1, "items": [...] }`,
the items oldest (lowest) first, each with an `id` and a `type`:

- `stroke` — `tool` (`pen` or `marker`), `color`, `size`, and `d`, its points packed: the first
  `x, y, pressure` as they are (pressure in hundredths), every one after it as the step from the
  one before;
  hand-drawn stylus strokes keep bounded full-precision triples in `points`, `linear:true`
  and `freedraw:{simulatePressure,streamline}`; mouse/finger strokes retain rounded triples
  and omit `linear`. The profile preserves real pen pressure or
  uses neutral .5 pressure for sensorless mouse/finger nibs and supplies the same outline for
  painting, picking and export. The SVG outline uses compact relative commands. Legacy packed
  and linear strokes retain their renderer; no old stroke data is rewritten. Metadata remains version 1 with the
  original point/tool/size fields, so older plugin versions still open new drawings;
- `shape` — `kind` (`rect`, `ellipse`, `line`, `arrow`), the two corners or ends `x1 y1 x2 y2`,
  `color`, `size`;
- `text` — `x`, `y` (the top left), `text` (lines split by `\n`), `size`, `color`.
- `note` — a note shown on the drawing: `path` (the note's vault path), its box `x`, `y`, `w`, `h`,
  and `scale`, the drawing's units per pixel of the note's text. The file's picture shows it as a
  card with the note's name. Legacy SVG metadata is no longer rewritten on note renames.

Colours are names: `black`, `red`, `blue`, `green`, `yellow`, `pink`. Units are CSS pixels at
100%.

A note shows a drawing by embedding it, `![[Drawings/Sketch.svg]]`, at the drawing's own size
within the note's width and a modest height. A size is Obsidian's own for any picture, written in
the embed: `![[Drawings/Sketch.svg|400]]` for a width, the height following the drawing, or
`|400x300` for a box; the handle at the embed's corner writes it there. To show a part of it,
name the part in the link after `#part=`, `x,y,width,height` in the drawing's units; without it
the whole drawing shows. Nothing goes round the embed:

```markdown
![[Drawings/Sketch.svg#part=120,40,800,500|600]]
```

Older notes name the part in a callout of type `drawing` round the embed,
`> [!drawing|120 40 800 500]` with `> ![[Drawings/Sketch.svg]]` under it; those still show the
part, and a part changed there is kept in the callout.

One drawing may be embedded several times in a note, each with its own part and size. The
legacy embed renderer remains available, without an editing action for the drawing itself.

The explicit **Convert legacy drawings to canvases** command scans all SVGs in the vault.
Each new `.canvas` stores `abele.drawingSource` with the original vault-relative SVG path.
It also stores `abele.drawingSourceHash`, the SHA-256 of the original SVG bytes. If that path
no longer exists, matching bytes identify a renamed or moved source, including folder moves.
Identical SVGs that still coexist at their recorded paths remain separate drawings. Older
conversions without a hash retain path-based matching.
Repeating conversion finds that provenance anywhere in the vault and skips that source,
including when the source or destination was edited. A deleted destination can be converted
again. Existing filenames without matching provenance get a numbered alternative, never an
overwrite. Failed or unsupported metadata is reported and the original remains untouched.
Raw metadata is validated before the tolerant display reader: invalid sizes, colours, pressure
or freedraw profiles are unsupported, never silently repaired during conversion.

Pen and marker strokes become root `abele.ink`, retaining coordinates, pressure, width,
linear mode and freedraw profiles; named drawing colours become their literal RGB values.
For mixed drawings, a file node to the original SVG sits beside the editable ink, preserving
an exact read-only picture of shapes, text, note cards and their original layering. Those
legacy objects are not converted to editable canvas objects. No original or note embed is
rewritten, moved or deleted. The picture editor and reader ink retain their existing formats.

## Temporary execution context hold

A durable local `abele-script-execution-context-hold` plus `.abele-script-context-hold`
sentinel blocks script snapshots and their final compilation checks during isolated maintenance.
It is written before any managed provenance is temporarily detached and released only after
original state restoration succeeds. A missing original trust record is never local-code trust.

The offline/paused pending count is computed from a read-only local scan against the personal
ledger, using this device's selective and ignore filters. A failed first server request does not
mean there are no local edits; counting asks the server nothing and acknowledges no changes.

## Token connection registry

`abele-sync-connections-v2` is the device-local registry, containing only kind `token`. Each
record has an address, authoritative space/token IDs and stable folder/group selector, an
independent ledger ID, pause and status. Secret references use the device-only keychain
namespace `abele-sync-device-token-…`; raw keys never enter the registry, synced settings,
encrypted synced secrets or settings transfer. Engine-local state is bound to the local
connection ID under `abele-sync-token-state:`; copied settings cannot carry that identity.

Startup discards old personal/scoped records, journals, ledger references and known access
credentials. It performs no migration, backup or baseline import. Actual vault files and
IndexedDB databases are not deleted. `abele-sync-retired-access-cleanup-v1` temporarily holds
only credential references until verified deletion succeeds, allowing interrupted cleanup to
resume. Settings-only credential references and their server proofs are journaled before
rewriting old settings, so keychain failures remain recoverable even without those settings.
New token credentials and unrelated keys are protected. The old access runtime is
not started, including when cleanup fails.

A pending token binding is written before the device keychain write, then activated only
after the key reads back. Re-pasting the same new token resumes interrupted provisioning;
different authority cannot take over that binding. A bound record cannot be retargeted: a different token needs a separate local record, preserving existing pending state. A renamed selector keeps its stable ID,
ledger and credential, including during interrupted provisioning: only address, space,
token and selector kind/ID bind the pending identity; the latest authoritative path is saved.
Malformed active storage requires recovery. Forget removes only the
selected metadata; credential/database retirement remains the runtime’s separate action.

Retained push placement stages verified download bytes under the reserved local directory
`.abele-sync/placement-outbox/<request-hash>/<sha>` before path leases. This directory never
syncs. Bounded runs are loaded during settlement and successful settlement removes staged
files. Interrupted settlement retains its request journal and staging for retry; orphan
temporary-directory cleanup belongs to the later recovery stage.

Pull placement fills its byte cache before path leases even for a matching baseline hash:
the ledger cannot prove that the local source still exists. Source and target are revalidated
under the lease before placement.

The token adapter's `abele-sync-token-state:commit` slot stores immutable request
operations, an idempotency key and the accepted receipt until host settlement
finishes. Use the registry's connection-bound storage port; this journal is
device-local and never enters settings transfer. An uncertain response retains
the original request, and a failed follow-up download retains its accepted
receipt. The production runtime uses core V2EngineClient and SyncEngine with per-connection IndexedDB state, shared placement coordination and durable executable staging. Upload byte staging remains the core engine's responsibility.

## Executable review and attachment consent

`abele-sync-reviews-<device-local-vault-id>` is a separate device-only IndexedDB
writer using the retained store format. It must never share a server-space name
or an engine's pending metadata overlay. Initial open persists `device-review-identity-v1`
before exposing review ports; automatic reconnect verifies that durable identity without
reinitializing it. `token-executable-review-v1` stores
immutable code candidates: connection snapshot, file/version, operation and
paths, exact bytes/hash, original mtime, receipt time and review/apply status.
An explicit approval is saved immediately as `queued`, independently of connection
startup, pause, reachability or the engine lock. Installation consumes that durable
decision when a runtime is available. A blocked pull read may yield for installation;
issued writes settle first, then downloading resumes. Failed installations retain
the queued decision for retry; only successful installation changes it to `approved`.
Only explicitly selected IDs are approved; interrupted application retains the
same candidate. Later versions stay pending and active files are unchanged by
staging or rejection. Answered receipts remain stored for delivery deduplication.
Disconnect retires that connection's code candidates after its runtime stops. Review
refresh also removes candidates whose connection no longer exists; reconnecting stages
fresh candidates under the new connection rather than transferring old approvals.

`token-attachment-consent-v1` stores observed note references, received provenance,
questions and allow/deny decisions by connection plus stable **local** file ID.
Only an actual note-open creates questions. Received content from another
connection grants no publication consent. A decision follows edits/rename of
that identity, while a replacement at the same path has a new identity. Neither
document enters settings, synced secrets or settings transfer. Screens and core
runtime integration consume these ports separately; no UI or engine is started
by the metadata adapter.

The native Sync settings now read `abele-sync-connections-v2`. Connecting validates the
token with the server before adding a record; interrupted keychain provisioning reuses the
same pending binding. Disconnect stops that connection, verifies removal of its local
credential, then forgets its metadata without touching files or other connections. It does
not revoke a server token. `abele-sync-token-state:last-sync` stores only the last successful
sync time in the connection's device-local state. Progress, errors and conflict paths are
runtime state supplied by the core adapter, never synced settings.

Folder connections pin their initial local folder in the device-local registry's
`localRoot`. An existing connection pins its current scope path on first start.
A server rename stops exchange with the old and new paths shown; local files stay
in place and disconnect remains available. Server paths are validated before local
handling, and filesystem operations reject paths outside the pinned folder.
Folder discovery starts at that root and preserves foreign directory identities and
pending removals without processing them. Noncanonical incoming Unicode spellings
are rejected before local access. Host-resolved physical Unicode spelling is retained
inside the exact local root; canonical wire paths use retained file identities for
local placement and never authorize a Unicode root sibling. A folder connection stops if shared write recovery
requires touching another root, keeping the recovery records and local bytes.

Write-journal and retained-backup records carry a device-local connection owner.
Each connection's startup, enrollment, departure, and recovery select only its own
records. Other owners' and legacy unowned records remain intact for their owner or
local recovery; they never authorize this connection to read or change those files.

Folder connection startup, projection inspection, recovery, and native/adapter file
access share the same root boundary. Private placement downloads, write staging, and
recovery copies use a device-local `.abele-sync/connections/<connection-id>/` namespace.
Mobile capability probes use that same owned staging area. Abandoned owned inbox
downloads are discarded on restart, including journal entries whose temporary file
was never created or was already removed. Another connection's uncommitted inbox
downloads and legacy inbox stages remain untouched and do not block startup. Folder connections
honor the vault-root ignore file through an exact-path, read-only control-file
exception. This file is never listed, uploaded, or synchronized by a folder
connection; the exception permits no configuration-directory walk.

Non-root folder connections persist their initial device-local placement in `localRoot`,
including records migrated when their runtime starts. Server scope paths never redirect
local discovery. A server rename stops the connection and keeps local bytes, showing both
names. The explicit same-local-folder action records `serverRoot` and projects wire paths
onto the unchanged saved namespace; it never migrates existing baselines or moves local files.
A new manifest is required after confirmation, so the historical rename is never replayed
as local moves or server deletes. Disconnect remains available.
Incoming folder paths are validated before placement or review, and filesystem translations
refuse paths outside the connection boundary.

`abele-sync-device-review-id-v1` is a verified device-local UUID for the review database.
Incoming-code review selects the exact displayed candidate ID; later candidates remain
pending. Only workspace file-open events ask the attachment-consent port to resolve stable
local identities. Closing a question defers it; allow/deny goes through that connection's
resolver and durable decision store. Camera/photo QR input reuses the settings-transfer
decoder; it populates the token field and still requires pressing Connect.

Token issuance and revocation use v2 directly. Issued token text is held only while its
dialog is open; it is never saved into settings, transfer, the registry or the sync log.
Each token connection uses the production v2 runtime. Root, folder and group connections use the same engine. Group attachment publication is explicit and follows the connection’s saved consent. No legacy engine is started.

Agent settings tools expose device-only token preferences as `sync.connections.<local-id>.address` and `.paused`. Only an unprovisioned record may change address; a live token never moves to a different endpoint. Credentials, ledger identity and internal state are not exposed. Writes reconcile the token host and report startup failure beside the saved value.

Explicit token-host eviction and hydration use the existing journalled external-file store.
Activation proofs and external-file journals stay in the device-local ledger and local storage.
All connections share the intentional-absence view; reference files are never uploaded as content.
Hydration may use another live token only after verifying that token’s own file/version identity
and the exact retained bytes. Downloads happen outside path leases; installation and removal
use the shared path coordinator. Eviction preserves unfinished per-destination edits before
removing local bytes. Disconnect materializes offloaded files and verifies retained evidence.
The local consent identity survives an acknowledged hydration, while an unrelated replacement
at the same path receives no inherited permission.

`plugin:token-asset-outbox` in each device-only ledger retains immutable approved attachment
content, path, original mtime, source identity and request key. Streaming entries store an
owned staging-file locator and size instead of a numeric byte array; older entries remain
readable. Unknown responses retry the same
request; known rejected items remain held while unrelated files and receiving continue.
Sync now retries a known refusal with a new key and its retained bytes. A matching receipt,
baseline adoption and queue removal commit together; a newer received baseline is never
downgraded by a late receipt. Settled/rejected receipt metadata remains device-only too.
Accepted publication also retains the stable local file identity and server file identity in
that ledger. Group attachment renames follow this recorded identity; replacements at the same
path do not acquire consent, and scope departures remove the rename eligibility.

The device-local `abele-sync-writes` journal also owns resumable chunk stages in the plugin's
`sync-staging` directory under the vault configuration directory. Temporary publication files,
swap backups, external incoming files and capability probes use this private directory rather
than user content folders. It is excluded from sync inventory; folder cleanup still checks all
entries in user folders, including hidden files. A streaming entry records mtime, the expected previous content identity (or
absence), and the sealed replacement identity. Partial stages survive recovery without
publication; append resumes from the actual disk length, and seal verifies the full digest.
Publication still uses the write journal and the local-save fence or backup swap. A stage
with an unresolved backup remains an installation blocker. Sealed retained sources are
separate from unfinished publication, and are verified again before use.

Each token ledger persists the server restore generation, content reconciliation phase and
reason, missing-file evidence, and the rolling content-sweep cursor. Normal sweeps rehash up
to 16 tracked files and 16 MiB per cycle (one oversized file can advance alone); metadata-only
inspection does not advance that cursor. Reconciliation performs a full selected rehash once
and routes outgoing deletes to the existing held-deletes review, including single deletes.
Filesystem fingerprints and content revalidation bypass process-local write receipts.
Generation retirement clears the adapter's live receipts, including those shared by another
filesystem instance. Ordinary pull verification
can still use a live incremental receipt on append-only hosts. Fresh non-upload reads retain the
50 MiB whole-file fallback ceiling; larger files require bounded readers. Uploads alone may use
the explicit 200 MiB whole-file ceiling. A persisted digest
never substitutes for current bytes.

Before startup recovery or publication, the host handshakes the server generation. A changed
generation archives old publication authority under `retired-host-generation:` in the ledger,
alongside the core's `retired-generation:` evidence. Local write intents are archived before
being marked with `retiredGeneration`; their temporary files and backups remain protected and
are never replayed or swept. Possible local restores likewise retain write evidence under
`reconciliation-host-writes:`. External-file documents from a retired generation remain intact
and archived; those connections stop with the existing recovery status pending reconciliation
of their retained external records. Neither restore path discards local files or resets the
ledger on an ordinary plugin upgrade.

Streaming pulls of at most one transfer chunk retain verified bytes in memory before acquiring
placement paths, without an extra private source stage. New one-chunk placements use the ordinary
atomic writer: one bounded write to a journal-owned temporary file, rename publication, then
retirement of the write intent. They do not create, append and seal a streaming target stage;
existing streaming recovery intents still follow their original stage recovery. Larger pulls retain a verified private
source stage when the host can read it; target publication reads that local source instead of
downloading the file again. The source stage is discarded after placement or a handled failure;
interrupted processes leave it under the same journal recovery rules as other private stages.
Hosts without bounded reads of large local files stream those versions directly from the server
to the durable target stage under the placement lease. Whole-file fallback limits are unchanged.

The iOS Capacitor adapter exposes whole-file `readBinary` (no offset), `appendBinary`,
`write`/`writeBinary`, `rename`, metadata and `getResourcePath`. Large incoming versions use
server HTTP Range requests of at most 1 MiB, sequentially appended to the target stage; there
is no whole-file receive fallback and no second download for local placement. SHA-256 is
updated incrementally after each acknowledged append. A process-local receipt binds that hash
to the stage's size and timestamps; sealing compares its digest with the version's expected
SHA-256 before publication. The sealed identity is journalled, but is not trusted as proof of
unchanged bytes after restart. Publication uses the live receipt, then transfers it across the
rename. Transfer memory stays proportional to a chunk, including native encoding overhead.

Local range readers are optional, independently probed capabilities: `getResourcePath` URLs
are tested with small WebView Range requests (exact 206 and Content-Range required); Capacitor
Filesystem `readFile` offset/length and `readFileInChunks` are also probed against small inputs.
When these readers are unavailable, upload reads alone use one adapter `readBinary` buffer with
an explicit 200 MiB hard ceiling (`MOBILE_WHOLE_READ_MAX`). Files above that ceiling are
refused before reading, with the requested size and limit in the error. This is a whole-file
read, not a bounded local stream. Outgoing multipart parts are independent copies of at most
1 MiB, so the bridge never receives the full backing buffer for a part. Closing the source
releases its buffer on success or failure. A resumed upload reads once again and skips parts
the server has acknowledged.

For large whole-read uploads, the scan hashes and publishes the content-addressed blob while
the same buffer is open. The ordinary engine still owns commits and path changes, and its
later blob check uses acknowledged uploads and a matching process-local size/mtime receipt
to avoid reopening the file, including revalidation scans and later cycles. A fully verified
received version may stand in for a reread the same way, but never for an upload: a scoped server
admits a new sha only against this principal's own upload and spends it on commit, so the blob
check skips the upload only for an own upload no commit has used yet (a rejected op keeps it; an
applied, merged or lost commit spends it). Server generation changes invalidate those upload
acknowledgements. Concurrent fingerprints of one path share
the same in-flight operation; no full buffer remains after it settles. This avoids retaining every scanned file in
memory until the upload phase. A server hit closes the buffer immediately. Scope and placement
proxies validate the path before this capability runs. Native/ranged hosts keep the ordinary
scan/upload flow. The default mobile selective size cap uses the same 200 MiB constant.
Non-upload readers, including book readers and unknown external-file verification, retain the
50 MiB whole-read guard. Successful uploads retain only their incremental hash and unchanged
file stamp for later offload verification; the upload buffer is released. A shared mobile large-file gate holds other large uploads and
hydration until that buffer has been dropped; closing or cancelling a queued hydration removes
its waiter. Offload preservation uses the same unchanged receipt when comparing destination
bases, without authorizing a whole read for edited or unknown files.

The exchange snapshot's `localReads` counters expose reads, delivered chunks, consumed bytes,
active sources, current/peak source-held buffers and maximum incoming backing-buffer size.
Ordinary files up to 50 MiB use the adapter directly and appear in the normal adapter-call
diagnostics; they do not increment the large-upload `wholeReads` counter.
For a whole-file read, one delivered chunk is the complete file. These counters measure
JavaScript-owned buffers; native/browser resident memory requires platform sampling.
The append-only large pull needs none of these local readers. If its process-local receipt is
lost, the matching pull intent restarts only its private stage from offset zero and downloads
one bounded stream anew. Recovery of an interrupted backup swap retains the backup without
hashing the installed target. Unknown large staging bytes still require bounded recovery;
the whole-read upload allowance does not authorize replay after an uncertain append.
External mobile fingerprints retain the hash with size/mtime; unchanged files reuse it,
including after reconciliation changes ctime. Changed large receipts refuse eviction and keep
the file local. A lost receipt requires a fresh authenticated read before eviction.
Custom providers without a streaming version API
also cannot receive large versions through their legacy whole-file API.

The bounded exchange diagnostics retain local adapter-call, journal-save, hash, atomic-write
and streaming-stage timings alongside network requests. These device-local timings expose the
work between range requests; they are not sync inventory and do not travel to the server.
Successful local-call debug output is grouped in batches of up to 64 events, with per-operation
counts, summed duration and maximum duration. Network and failed-operation logs remain
immediate. The exact last 64 events and first-sync operation counts remain synchronously
available in snapshots. Snapshots and first-sync completion flush partial batches; there is
no logging timer. This keeps console bridge round trips out of the per-read/stat/close loop
during initial local comparison, before any content request or download count can advance.

A pull intent can outlive the rename that published its stage. If the private stage is missing,
the matching intent downloads and verifies a new bounded stream. Uncertain installed bytes
are never acknowledged from metadata or a persisted digest: publication retains them as a
recoverable backup before installing the verified version. A local edit made after the previous
publication therefore survives too. Streaming journal entries mark this retention explicitly;
an interrupted recovery download can itself restart without reading those uncertain bytes.
The same recovery covers moves, case-only renames and older atomic-write intents without a
stage ID. Recreated source paths still obey the pending move's occupancy guards. An existing
private target stage can also resume by retaining an unverifiable installed destination;
recovery does not require hashing that destination first. Ordinary renames transfer live
incremental receipts to the new spelling; a case-folded alias resolves through the actual
directory entry, with an exact spelling taking precedence over an alias.

### Pull crash recovery matrix

`tests/integration/pullCrashLifecycle.test.ts` executes every cell below through both
`applyStaged()` → `pullRun.take()` and `recoverPendingPullWrites()`. Before an intent exists,
startup recovery does nothing and the next ordinary pull supplies the change. The fixtures
use multi-chunk versions, a case-insensitive disk, fresh adapter identities after each crash,
and independently saved destination edits, including rewrites with unchanged size and mtime.
An additional matrix runs every published-window cell with a one-chunk, stage-less intent
and an edit that grows beyond one chunk. No recovery calls `place()` without prior adoption.

Outcomes:

- **N**: ordinary pull; no earlier intent authorizes overwriting an independent destination.
- **H**: hold, preserving files and any pending intent/stage. Startup reports recovery required
  when a pending move has both a distinct source and an independently occupied destination.
- **P**: ordinary pull holds; startup preserves the occupied distinct source as an independent
  local file when the destination is absent. In one ledger transaction it relocates only the
  old association to the absent destination and rewrites the intent's base with no move source.
  It then verifies and installs the immutable version there. The ordinary scan uploads the
  independent source under a new file identity. No source bytes are moved, read or overwritten
  by recovery. The ledger retains the original file ID throughout, so another interruption
  discovers and finishes the rewritten intent instead of losing it.
- **R**: finish the exact intent's immutable version, then commit the ledger. Bounded readers
  authenticate and resume the private stage; an append-only host resets only that stage and
  downloads one bounded stream. Before publishing, recovery performs the pending move,
  including the exact case-only spelling. Any displaced destination or moved source is kept
  as a recoverable backup on either host; the intent never authenticates those local bytes.
- **A**: adopt only after authenticating installed bytes and checking source absence/occupancy.
  No publication is needed. If the intent still owns a private stage, use **R** instead so
  adoption cannot orphan that stage. A case-only move cannot rely on source absence through a folded
  alias, so it takes **R** and verifies the requested spelling instead.
- **S**: the ledger already contains this version. Retire its stale intent, if any, without
  downloading or writing; a subsequent local edit remains available to the ordinary scan.

“Complete, before move” is after sealing but before the before-publication callback.
“Complete, after move” is after that callback but before stage publication; for creates and
replacements those two windows coincide. “Published” is after stage publication and before
the ledger transaction. “Edited” means independently saved bytes at the destination, not a
change to the private download stage. Corrupt stage and network bytes are tested separately:
bounded readers reject a corrupted retained stage; append-only recovery discards only its
private bytes and verifies a fresh stream. Neither publishes bytes that fail the version hash.

| Crash window                                                      | Operation      | Bounded, unchanged | Bounded, edited | Append-only, unchanged | Append-only, edited |
| ----------------------------------------------------------------- | -------------- | ------------------ | --------------- | ---------------------- | ------------------- |
| Before stage/intent                                               | New            | N                  | H               | N                      | H                   |
| Before stage/intent                                               | Replace        | N                  | H               | H¹                     | H                   |
| Before stage/intent                                               | Move           | N                  | H               | H¹                     | H                   |
| Before stage/intent                                               | Case-only move | N                  | H               | H¹                     | H                   |
| Partial stage                                                     | New            | R                  | R               | R                      | R                   |
| Partial stage                                                     | Replace        | R                  | R               | R                      | R                   |
| Partial stage                                                     | Move           | P                  | H               | P                      | H                   |
| Partial stage                                                     | Case-only move | R                  | R               | R                      | R                   |
| Complete, before move                                             | New            | R                  | R               | R                      | R                   |
| Complete, before move                                             | Replace        | R                  | R               | R                      | R                   |
| Complete, before move                                             | Move           | P                  | H               | P                      | H                   |
| Complete, before move                                             | Case-only move | R                  | R               | R                      | R                   |
| Complete, after move                                              | New            | R                  | R               | R                      | R                   |
| Complete, after move                                              | Replace        | R                  | R               | R                      | R                   |
| Complete, after move                                              | Move           | R                  | R               | R                      | R                   |
| Complete, after move                                              | Case-only move | R                  | R               | R                      | R                   |
| Published, before ledger                                          | New            | A                  | R               | R²                     | R                   |
| Published, before ledger                                          | Replace        | A                  | R               | R²                     | R                   |
| Published, before ledger                                          | Move           | A                  | R               | R²                     | R                   |
| Published move, destination deleted and distinct source recreated | Move           | P                  | P               | P                      | P                   |
| Published, before ledger                                          | Case-only move | R                  | R               | R                      | R                   |
| Ledger committed                                                  | New            | S                  | S               | S                      | S                   |
| Ledger committed                                                  | Replace        | S                  | S               | S                      | S                   |
| Ledger committed                                                  | Move           | S                  | S               | S                      | S                   |
| Ledger committed                                                  | Case-only move | S                  | S               | S                      | S                   |

¹ With no durable intent and no bounded local reader, a multi-chunk existing file cannot be
authenticated. Preserve it. One-chunk files can use the same **N** path as a bounded host.
² A one-chunk installed version can instead be authenticated within the chunk budget and
take **A**, including older intents without stage IDs. An adoption mismatch preserves that
intent on a streaming-capable host; startup then runs **R** rather than silently clearing it.
Without a streaming recovery client, unresolved intent recovery stops without mutation.

If a pending distinct move's source path exists after interruption, that path may have been
recreated. A private stage or matching bytes cannot prove it is still the original source.
The ordinary pull holds it even when the destination is absent; its log explains that the
source may have been recreated. Startup takes **P** only for an absent destination and an
exact matching intent/base. This includes partial and sealed stages before the move. An
occupied destination still holds; it cannot authorize source relocation or replacement.
The engine-level server test runs startup recovery followed by real pull/scan/push exchanges:
the local source keeps its path and bytes, the server version arrives at the destination,
unrelated files exchange in both directions, and the intent retires without a retry loop.
It also interrupts after the metadata separation and proves the next startup completes it.
The recreated-source row is tested separately through both entry points on both host shapes;
it applies regardless of the recreated file's bytes or the presence of its private stage.
Case-only source aliases and moves whose distinct source is already absent continue through
the corresponding earlier rows.

These outcomes require an exact version and unchanged pre-write ledger base. An unrelated
intent, another tracked occupant, or a recreated distinct move source never grants overwrite
authority. Path occupancy is rechecked immediately before the recovery move/publication;
failure retains recovery evidence and clears only the failed write's echo-suppression entry.

The one-chunk atomic fast path is limited by the old ledger size as well as the incoming size.
Large previous entries use streaming replacement; the ordinary atomic writer also refuses
to whole-read a multi-chunk old file if it appears after the decision. Pull verification and
stage publication use bounded local readers or live incremental receipts. When neither can
authenticate existing local content, the pull holds it rather than allocating a whole-file
buffer or guessing its identity.

Private placement source caches are journalled as disposable network sources. Recovery removes
their unfinished temp files and journal records, including older cache records identified by
the reserved placement-inbox target. A process-local reservation starts before the source's
journal entry is published and spans creation, reopening, download and consumption. Creation
failure releases it so a later recovery can reclaim an incomplete source. Retirement releases
it after normal use. Active sources are also excluded from generic temp-file sweeps;
ordinary target stages and retained local-edit copies are not disposable caches.

Local edit preservation records may likewise retain a sealed source locator and size, shared
by the destinations that still need that immutable edit. These source files and their journal
records are device-local recovery evidence, never ordinary sync inventory or server content
identities. Failed or cancelled transfers retain their stages until explicit discard or
successful publication; matching bytes alone do not retire an uncertain external operation.

Private sync staging files without an owning connection or publication journal are
moved into `sync-recovery` under the plugin configuration directory, never deleted as
disposable work. Reset preserves owned private copies there before deleting its ledgers.
Disconnect keeps unresolved operations and their quarantine at the original paths until
recovery settles them. It moves completed private copies there before releasing ownership;
the move keeps the inode, so late saves through open descriptors survive. A crash before the ledger update can
recognize the deterministic recovery destination and finish preparation without replaying
the old bytes. Reused names preserve the earlier copy under a unique suffix.

These recoverable copies are kept indefinitely, outside sync and projection inspection;
a persistent notice gives their directory, and every batch of newly preserved copies
notifies again, including partial batches interrupted by a failed move. Active stages and
pending publication backups remain protected by their existing journals. No cleanup removes uncertain user bytes.

Explicitly following a moved connection root updates the target labels of that connection’s settled preserved-copy records after the destination file set is verified. Recovery copies stay in its private area, other connections’ records stay unchanged, and no files are moved or restored by this metadata update. Unfinished installs or copies outside the owned private area keep Follow stopped. Following a server rename keeps these local target labels unchanged.

Follow matches absolute desktop backup paths against the adapter’s exact owned private recovery directory. Only settled evidence target labels change; archive paths and bytes remain unchanged. Foreign archives, sibling prefixes and traversal aliases remain refused.

Bounded local edit history captures use owned private outbox stage targets, while their history records retain the original file path and immutable source handle. They are retained sources rather than pending installs into that file, so following a moved root leaves those stages and bytes intact. Unfinished ordinary target installs still stop Follow.

Deleting a connection's server scope stores a device-local request UUID and, after confirmation,
the server receipt in that connection's state before disconnecting. An uncertain attempt stays
stopped across restart and retries the same request; it never removes local files. A server
`scope_deleted` refusal likewise persists a stopped marker until explicit disconnect.

## Node chat drafts and preferences

The node chat agent picker remembers the last successfully started agent per node in device
local storage. It also uses the latest session or a configured provider when there is no saved
choice. Chosen text attachments are quoted into the node chat draft; sending includes their
content in the ordinary message, without creating a vault attachment or uploading a device path.

Node chat folder placement is device-local, stored with open and closed chat references;
moving a node chat does not move files or sessions on the node.

Node chat checkpoints and their file snapshots remain on the node. Rewind, branch, edit and
retry change conversation context without restoring files. Only the rewind dialog's explicit
file switch and confirmation send the exact preview identity and ordered file hashes to the
node. A failed or uncertain restore is never automatically replayed. Restored transcripts
project immutable journal prefixes, retaining the original events as evidence rather than
deleting history from device storage. Branches keep the source conversation intact.

## Zen preferences

Plugin settings store `zen.width` (the shared page width, default 700 pixels) and
`zen.windows` (on/off by workspace window id; `main` for the main window). The Other settings
transfer section carries these preferences. Zen mode does not change note or canvas files.

## Saved HTTP request script assignments

Saved requests live on the node under `.abele/requests/`, in `.http` files. Above the method
line, `# @before Sign sample` and `# @after Read sample token` name plugin scripts by their
declared `// @name`; removing a comment clears that assignment. The script must opt in with
`// @request`. The request tab's Scripts picker writes the same fields. Creating a script there
writes a JavaScript file with `// @name`, `// @description` and `// @request` in the configured
scripts folder, opens it and assigns its name; it does not execute it. Removing an assignment
keeps the script file.

Script-returned variables are written as ordinary environment values unless the environment
explicitly marks the variable secret; declared secrets stay in memory and are redacted from
answers and history. Request tabs remember their answer timeout per node, project and request
in device-local storage (`abele-requests:…:timeout:…`), defaulting to 300 seconds. These timeout
preferences do not change the project's request files.

Image requests store `ai.imageGenerationTimeLimitMinutes` (0 by default for no fixed limit;
2, 5, 10 or 30 minutes). AI general settings transfer carries it between devices.

Manager command and integration operations also stay in the installation-local node
client store. They retain the parent chat identity, exact request and operation ID,
and bounded current status for reconnect recovery. The session journal carries output
and owner prompts; delegation cards project the child's pending prompts from that same
journal. Answers from parent and child cards share one durable prompt identity.
These records are never vault notes and do not travel with transferred settings.

Delegation follow-ups retain their accepted child sequence locally. Receipt recovery
re-arms the existing child after a lost response, without sending the input again or
reviving a later cancellation or an already delivered result.

An unconfirmed cancellation and the parent's Stop remain durable fences during
follow-up receipt recovery. A fresh input never silently discards an outstanding Stop.
