# Token review ports

These portable, non-UI ports prepare executable review and attachment consent for
the unified core binding. They do not start another engine or modify screens.
Use `openDeviceReviews` with a stable **device-local vault ID**, never a server
space ID or transferred setting. Its independent IndexedDB writer cannot join
an engine's uncommitted overlay. Both port families serialize metadata writes,
verify committed state, and retain state across close/reopen. A runtime fence can
be supplied to the database adapter.
The runtime must settle its exclusive host jobs and reload barrier before closing
this writer; physical file effects remain fenced by the retained engine host.

## Executable delivery and review

Before acknowledging an incoming change, call `ExecutableReview.stage` with its
source connection snapshot, exact file/version identity, operation, both paths,
kind, directory flag, receipt time and original mtime. For content, supply bytes
downloaded at the **exact version**, plus its expected SHA. Stage after download
and before placement, outside path leases. Deletes/removals have no bytes; the
host supplies original mtime and directory/kind from its baseline. Never replace
original mtime with receipt or server processing time.
Stage executable feed events before collapsing superseded versions. The host
uses a stable local delivery identity for removals, which carry no server version.

The result is `ordinary`, `excluded`, or `staged`. Ordinary files continue through
the retained engine; executable changes are persisted without modifying active
files. Classification includes configured plugin scripts, all plugins' code
(including this plugin), executable kinds, both ends of moves, and directory
operations affecting executable trees. Direct plugin `data.json` remains a
settings file. `allowsPath` is also the outgoing config filter: a non-root
connection cannot carry `.obsidian` or configured configuration roots.

`pending` returns immutable candidate snapshots with bytes, hash, source, receipt
time and original mtime for the designer's review UI. `heldPaths(connectionId)`
exposes both ends while pending or applying. Approval/rejection takes explicit
candidate IDs; a later candidate is a separate record and stays pending. Shared
exact-selection and plugin-path helpers generalize the retained staged-code lane.
The duplicated legacy plugin-path check was removed; its view helpers remain
used by existing screens and retain their tested behavior.

`approve(ids, {apply})` persists `applying` before the host effect. The apply port
receives only the selected immutable snapshot and must use the retained exclusive
engine scheduler and path coordinator, recheck local edits, preserve other
destinations' pending bytes, update the baseline/provenance, and apply with the
original mtime. It must be idempotent by candidate ID. A failed/interrupted apply
remains reviewable as `applying`; retry uses the same candidate. Rejection leaves
active local files unchanged. Applied receipts remain durable so repeat delivery
does not reopen an already answered candidate. Later versions still need review.

## Group attachment consent

`observeNote(source, localNoteId, referencedLocalFileIds)` records canonical host
link resolution. Arrival, background indexing and Canvas processing create no
questions or decisions. Canvas observations must pass kind `canvas`.

Only a real user note-open event calls `noteOpened`. The resolver must return the
same **stable local file identity**, not a server file ID or a path-derived key.
Rename preserves that identity; deletion/recreation at the same path gets a new
identity. Unresolved, replaced, executable and partial-config targets do not
become questions. `pending` only exposes questions already created by note opens.

`decide` revalidates identity and current links, then persists allow/deny by
connection plus local file ID. The decision survives future edits and renames;
another connection needs its own decision. Decisions never upload bytes directly.
Use `mayUpload` as the group asset publication/scan gate. An undecided or declined
asset stays local while ordinary eligible notes continue. Folder assets use the
current folder boundary and root assets require no attachment consent.

Call `recordReceived` only after verified bytes from that connection have actually
been placed/adopted for that local identity. Merely seeing a link or manifest is
not provenance. Received assets are automatic only for the delivering connection;
receiving through another connection gives no publication permission here.

## Verification boundary

Synthetic port tests cover every executable operation, exact-candidate approval,
later deliveries, source isolation, interrupted application, note-open-only
questions, refusals, provenance, file replacement and configuration exclusion.
An IndexedDB test closes and reopens the real plugin store. The core v2 binding
must connect these ports to intake, scan eligibility, stable host identities and
application/provenance updates. UI, live desktop/mobile evidence, full engine
acceptance and retention/cleanup of answered review records are not verified here.
