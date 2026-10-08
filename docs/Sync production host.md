# Production sharing host

The plugin installs `PluginSharing` from `AbelePlugin.initSync` at layout-ready in both production
and development. Development inspection hooks are not required for any sharing effect.

## Former test-only wiring

Before the production host integration:

- `src/main.ts` passed no owner-publication factory. `src/sync/engineBuild.ts` installed owner
  hooks only if `deps.ownerPublication` had been supplied.
- `src/testing/ownerPublicationFixture.ts` opened an independent bound metadata store,
  constructed and started `NativeOwnerPublication`, attached its `ExistingPrivateConfirmation`
  coordinator to `publicationPrompt`, refreshed retained work after settlement, and detached it
  on teardown. `src/testing/exposeTestApi.ts` exposed that installation to the stand.
- The collaboration stand constructed `OwnerFolderHttpPort` outside the plugin to create and
  prepare group grants, and `GroupJoinHttp` to accept and enrol scoped installations.
- `tests/e2e/helpers/collaborationPeers.ts` constructed the checked core scoped client/state and
  serialized pull/push around a CLI filesystem and SQLite store. No plugin port did that work.
- The stand directly used scoped commit and sponsored-native HTTP for scoped notes/images.
  `ScopedCreationFlow` had no production filesystem, upload, receipt or link adapter.

The visibility and intrinsic-sponsor checks already belonged to the checked HTTP/publication
classes. The missing work was composition and lifecycle, not another authorization policy.

## Installed composition

`src/sync/pluginSharing.ts` supplies the owner factory to the personal engine. It reuses
`NativeOwnerPublication`, `openLinkSnapshots`, the foreground prompt, and the existing owner
HTTP classes. Its metadata lives independently of personal settlement transactions. A missing
sentinel, descriptor or publication evidence requires recovery instead of a fresh baseline.
Discovery is optional: unreadable hints, an oversized union or a settings-save failure pauses new
automatic image sharing with a visible warning, but never stops personal sync startup or management.
The existing publication-unit budget remains 16; larger discovery inventories are retained without
silently selecting a subset or deleting imported/local choices. Every discovered ID is persisted,
even when publication is paused. A durable `settingsPending` marker survives failed settings writes
and forces a later successful write even if the in-memory object is already equal. Invalid group
entries stay intact and produce a visible warning instead of becoming an empty inventory.
The pause also gates settled intent replay and the final asset transport; exact receipt metadata
remains retained for resumption, not silently acknowledged or discarded.
Audience IDs originate in authenticated grant creation/preparation or an owner grant-list read.
A server/vault-bound discovery catalogue in shared `sync.sharing` settings carries them to other
personal devices; it is included by the existing whole Sync transfer block. Devices with plugin
settings sync disabled can refresh the catalogue by signing in under Sharing. IDs are hints,
never consent or authority: each exposure still obtains fresh server visibility and intrinsic
sponsor proofs. Connection changes invalidate the token getter and the host's writer ownership.
Native cache completion schedules coalesced revalidation behind the service's sync queue and the
public ledger transaction boundary (including automatic engine runs), never from inside settlement.
Receipt metadata still settles normally; only publication effects/questions wait. Exact local source/base evidence survives a delayed image identity or cache callback;
no latest-path cache or body parser substitutes for the callback.

The deployed group-management path is an exact root/version review using
`OwnerFolderHttpPort.createGroup` and `prepareGroup`, as in the stand. It is deliberately not a
fabricated certified graph preview. It does not approve anchors or assets. The original
`GroupSharingFlow` contract for certified graph/relation previews remains unchanged.

`src/sync/scoped/scopedPluginHost.ts` supplies `ScopedJoinFlow` and `ScopedCreationFlow` with the
same checked core `createScopedClient`, `ScopedState`, `pullScoped`, `pushScoped`, and scan used
by stand peers, behind `ObsidianFileSystem` and separately bound IndexedDB stores. Personal
cursors, tokens and journals never substitute for scoped state. Joining is pull-only and holds
unmanaged collisions, including matching bytes. A partial pull is recognized only by its
retained received identity and exact bytes. Group untracked files require explicit creation;
folder-native creation uses only the server's scope prefix.

Scoped image creation uses the existing principal-owned upload proof and sponsored-native
endpoint. Note creation retains the checked scoped CREATE receipt before final materialization;
the deployed endpoint has no identity-adoption mode. Delayed certification retries retained
work, not a matching-byte acknowledgement or a different create. Script execution stays refused.
Invitation/installation secrets and their proofs use the existing local secret road with
keychain-safe slot spelling, and are reserved against ordinary reads and transfer.

The settings dialogs receive live production flows. Owner readiness is reactive, so a tab opened
before engine initialization becomes usable when the owner lifetime starts. Its management port
is stable for that lifetime; ordinary catalogue saves do not discard a fresh owner session.
Owner sign-in under Sharing reads both `/v1/vaults/:v/grants` and
`/v1/vaults/:v/grants/groups`. Both owner-authenticated requests must succeed before the
inventory replaces local/portable hints. Group names, roots, roles and ACL revisions come from
those server rows, including groups created by other clients. Stop sharing uses that fresh ACL
revision, never publication revisions or guessed counters. Offline discovery remains a cache;
it cannot resurrect absent server groups while the management session is signed in.
Sponsored image views and confirmed Stop sharing use the existing routes. A revoke is acknowledged
only by the exact grant/vault/kind, next ACL revision, `state: unavailable` and a valid `revoked_at`. Image withdrawal does not wait on local indexing.
The publisher's existing 16-audience budget does not prevent listing/revoking larger server lists;
discovery does not silently choose an arbitrary subset as publication policy. Existing-private consent remains in the
normal `Views.vue` confirmation dialog. Scope watchers and metadata teardown join the app's
existing reload barrier, so a successor cannot open a second writer while the old host stops.

## Production artifact gate

`tests/integration/productionSharingBuild.test.ts` builds the normal `src/main.ts` entry with
`vite.config.mts`, `mode: production`, unchanged. It evaluates that bundle against a native-host
stand-in and the real provenance-checked stand server with `ABELE_SCOPED_SHARING=on`. It installs
no test API or publication fixture. It verifies:

- owner folder and prepared group sharing;
- scoped invitation acceptance and a disjoint installation credential;
- reviewed scoped note and image creation;
- no private image before consent, then delivery only after clicking the production **Publish**;
- no exposure of a recipient-planted private link on an ordinary owner resave;
- no `__abeleTest` in the artifact or the running host.

Run it through `npm run test:server`, which prepares/reuses the exact pinned clean-archive server
fixture. `ownerSharingContracts.test.ts` additionally checks owner HTTP against immutable server
archives for both the installed pin and the released server revision, independently of the core pin.
It exercises folder-only listing, remembered group visibility, both revoke routes, stable inventory,
preparation, key issuance/listing, invitations, and executable/inherited security restrictions.
A manifest review is an inventory only: it cannot certify server eligibility from current names.
This is offline native-host/HTTP coverage, not physical phone or live Obsidian coverage.

## Settings ordering

The file keeper serializes apply/write effects, not slow native reload reads. Every reload keeps
its merge base from the moment its read starts, and acknowledged field patches survive until all
possibly stale reads finish. A completed save cannot be replaced by an older read. Unrelated
incoming fields still arrive, pending debounced edits still keep their debounce, malformed files
remain protected, and concurrent catch-up/save/reload effects remain serialized.

The settings-ordering and calendar-completion regressions run as ordinary passing tests. The
obsolete interceptor transfer section is removed: legacy interceptor definitions already migrate
into the whole agent definitions that transfer carries. No new expected failure hides these cases.
