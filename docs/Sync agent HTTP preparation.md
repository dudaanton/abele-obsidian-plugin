# Agent gate HTTP preparation

The initial HTTP preparation used plugin dependencies `eb4844854b0a240c074fdae509ebce083ae03727`.
They are now re-pinned to reviewed `fc1e82dc36050ddc1b12f3005ff32899cca24c73`; disabled scoped
push hooks and owner intent contracts are described in `Sync publication intent integration.md`. A separate disposable **server-only** archive built from
`9b1136a0554287def69afb79b56eaaffcb09ca00` supplies the HTTP integration target.

## Concrete owner preview and management

`OwnerFolderHttpPort` is wired into the connected owner settings flow behind its unchanged
activation fence. It uses only a bound personal device token for paged folder preview. Personal
state progress must remain unchanged before/after the complete inventory, with advancing
cursors; otherwise the preview is a hold. Manifest kind alone does not attest sticky security,
so eligibility without an authority proof is shown as unknown—not invented as an approval.

Password login obtains a transient account session; the real owner grant-list service must
confirm fresh owner authority before creation. Account tokens live in a WeakMap, are never
returned to settings or replaced by device/scoped credentials. Grant responses are checked for
exact vault/folder/role/revision (initial revision zero is valid). Key issuance uses the reviewed
attempt contract, verifies `absk_` and checks real returned key metadata on that exact grant.
Lost successful issue responses recover one key, not another grant/key. Email/password are not
persisted as plugin settings; the password is cleared after confirmation.

Integration tests exercise the exported server's **unchanged registered handlers and services**
in an injected, disposable management-only HTTP app. Only that test assembly omits the early
activation hook. The original server `buildApp` remains closed and returns 503 even for a fresh
owner. No server source, worktree, deployed stand or real grant is changed. The test fixture has
its own explicit revision/checksum preflight; it does not alias the newer core into plugin code.

## Sponsored/native HTTP blocker at the requested revision

The `9b1136a` route inventory registers folder grants/keys, scoped state/snapshot/feed,
content/history, uploads and commits. It registers **no sponsored-extra list/add/unshare
handlers**. The scoped create schema also has **no `sponsors` or `native_asset` wire fields**;
outside-prefix sponsored create cannot be represented by dropping those fields into a personal
or ordinary create operation.

The actual early hook returns 503 for that management namespace. In the disposable app with
only the early hook absent, the attempted extras path is 404; this is a missing handler, not an
activation issue alone. Database sponsor/publication tables and capability *contract* names do
not constitute an implemented API.

`SponsoredAssetsHttpPort` therefore provides a concrete validated capability boundary for the
38/42 UI/service bindings and returns typed `sponsored_api_unavailable`. It **never** invents an
endpoint, empty private list, personal-token fallback, list replacement, or sponsor-less native
create. Those mutation HTTP bindings remain blocked pending the server's reviewed routes and
schemas. Task 43's root-folder attachment/native asset part cannot pass at this revision.

## Replay probe corrections

A failed probe cancels its interceptor, restores the exact original method and prior pause
state, and ignores late successful responses after evidence was cleared. File creation belongs
inside the protected try/finally. Successful probes intentionally keep only the owned-response
loss until native reload; explicit clear cancels that too.

Development builds install a key-bound transport observer **before** sync initialization.
Verification requires the exact saved idempotency key/request SHA and owned file/version plus
an actual successful `idempotent-replayed: true` response, and the key-specific replay log.
Generic logs emitted before sending no longer qualify. Production graph guard removes this
observer and all testing modules.

## Reproducible API integration invocation

Prepare the committed archive with `vendor-sync.mjs <repo> <exact-server-commit> fixture`.
The API tier requires `ABELE_SCOPED_API_FIXTURE=<that archive>`; the full ordinary integration
suite separately requires `ABELE_SYNC_DIR=<fixture matching the pinned plugin inputs>`. Both
are explicit immutable artifacts, not paths to a live sibling build. Missing inputs fail
preflight rather than silently selecting or rebuilding a worktree.

No activation is enabled. The reviewed core push high fixes are pinned and its scoped hooks
are integrated behind the fence. Personal owner hooks/novel-create receipts, native attestation
and exact sponsored CAS/upload contracts remain required as described in the disabled intent
integration document.
