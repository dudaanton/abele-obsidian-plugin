# Disabled scoped new-file and paste choices

Task 53 adds a portable `ScopedCreationFlow` and a disabled Obsidian modal. The connect card
provides a read-only preview; it does not install an active new-note/paste interceptor or start
a second engine. No received file is relocated or rewritten to fit a scope.

A new note must use an allowed exact path. Folder notes stay under the exact current prefix.
Group notes require an approved stable root ID/version from the current scoped view; only that
root's `groups` field is generated. Incoming spelling/anchor-like names are not approvals.
Preexisting frontmatter needs an explicit root-only metadata review instead of silently adding
unreviewed group relations. Reader/preparing/changed-root scopes and occupied destinations hold
before placement. No private occupant metadata is queried.

A pasted image keeps its chosen root/attachment path but needs an independently current
intrinsic sponsor and own principal/grant/SHA upload entitlement. A fixed media-folder rule is
not authority. The native adapter must capture exact bytes and sponsor evidence before upload;
missing native paste evidence remains a visible hold. That adapter and the forthcoming native
HTTP API are not fabricated by the UI.

The exact review/handle/bytes/scope/root/sponsor are durably recorded before exclusive local
placement. An interrupted ambiguous placement is recovery, never replacement. Upload/create
uses that same handle and immutable request across a lost response; only a verified novel
identity receipt permits linking. Scope/root and sponsor are rechecked after upload/before
create and before linking. Imported/occupied/adopted targets cannot become editable native
copies. User edits to path/root/body invalidate the displayed confirmation. Missing/corrupt
intent state holds rather than constructing a replacement request.

The creation host must hold the current physical writer claim and provide protected scoped
metadata, exclusive non-replacing placement, current authoritative scope/sponsor reads and
actual scoped upload/native-create/known-receipt/link adapters. No such mutating production
call site is installed while the fence is false. The group management API reviewed at
`689779f` supplies invitation/membership authority for task 52, not a fabricated task-53 native
endpoint. Portable/controller/component evidence is distinct from native paste/API acceptance.
