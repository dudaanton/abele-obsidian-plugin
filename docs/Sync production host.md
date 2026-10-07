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
sentinel, descriptor, identity or audience record requires recovery instead of a fresh baseline.
Audience IDs come from authenticated grant creation/preparation; each exposure still obtains
fresh server visibility and intrinsic-sponsor proofs. Connection changes invalidate the token
getter and the host's writer ownership.

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

The settings dialogs receive live production flows. Existing-private consent remains in the
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
fixture. This is offline native-host/HTTP coverage, not physical phone or live Obsidian coverage.

## Settings ordering

The file keeper serializes apply/write effects, not slow native reload reads. Every reload keeps
its merge base from the moment its read starts, and acknowledged field patches survive until all
possibly stale reads finish. A completed save cannot be replaced by an older read. Unrelated
incoming fields still arrive, pending debounced edits still keep their debounce, malformed files
remain protected, and concurrent catch-up/save/reload effects remain serialized.

The settings-ordering and calendar-completion regressions run as ordinary passing tests. The
obsolete interceptor transfer section is removed: legacy interceptor definitions already migrate
into the whole agent definitions that transfer carries. No new expected failure hides these cases.
