# Removed sync screen tests

The account/password, personal/scoped, invitation and reader-role screens were removed
from the product. Their 138 expected-failing assertions described those retired screens,
not unfinished token features. They are removed rather than recorded as bugs. Surviving
guarantees remain in the token UI, registry, transport, review, placement and engine tests.

| File | Removed coverage and reason |
|---|---|
| `component/deviceList.test.ts` | Account-enrolled devices and self/other-device revoke controls; token connections use issued-token management. |
| `component/joinVaultModal.test.ts` | Account vault selection, device names and personal-join preference dialog; no such connection flow exists. |
| `component/folderSharingModal.test.ts` | Legacy owner/grant folder-sharing certification and reader roles; sharing now issues contained tokens. |
| `component/groupSharing.test.ts` | Legacy group root/version certification, grants and reader/editor roles; replaced by token issuance. |
| `component/initialBatchRecipients.test.ts` | Initial owner-publication asset batches and sponsor/grant recipients; private-file decisions are individual file/connection consent. |
| `component/scopedCreation.test.ts` | Legacy scoped invitation creation and access-mode setup; there is one token connection kind. |
| `component/scopedInvitation.test.ts` | Invitation preview, legacy enrollment and reader/editor setup; connection uses the pasted/scanned token. |
| `component/publicationSettings.test.ts` | Owner extras, sponsorship, unsharing and initial image-batch controls; this screen and its product flow were deleted. |
| `component/productionSharingPorts.test.ts` | Injection into the deleted owner/scoped screens and invitation factory; replaced by native token-controller bindings. |
| `component/sharingManagementLifetime.test.ts` | Lifetime checks for the deleted owner/group management screens; token dialog/engine ownership is tested at the replacement ports. |
| `component/sharingPlainLanguage.test.ts` | Deleted screen labels for grants, sponsorship, invitations, creation and personal joins; retained private-file confirmation assertions. Token plain errors and displayed scope/server names have separate coverage. |
| `component/syncSettings.test.ts` | Account login, password handling, vault picker, enrollment/leave notifications, single selected personal connection, obsolete policy/usage and staging-screen wiring. Retained the independent selective-control tests. Independent connection actions, device-only state, pause/disconnect, failures and exact-version review are tested through the token ports. |
| `unit/designConformance.test.ts` | Layout checks that read the deleted JoinVaultModal source. Shared modal and retained held-delete action/safe-area assertions remain passing tests. |
| `unit/fencedScreenFixture.test.ts` | Static inspection of names/flags specific to the removed access-screen fixture. Native token fixtures use isolated synthetic state and token UI component tests. |

No registry, secret isolation, transport security, immutable review, attachment consent,
shared placement, file/version journal or recovery guarantee is removed. Group exchange and explicit attachment publication are exercised by the production token bundle tests.

Further retired-product coverage:

| File | Removed coverage and reason |
|---|---|
| `unit/scopedDialogLayout.test.ts` | Five layout assertions for deleted invitation, creation, owner folder/group and initial asset batch dialogs; native token dialogs use the shared modal kit. |
| `unit/scopedDeparture.test.ts` | Departure through the deleted scoped host, server self-revoke, invitation transports and old scoped key/binding formats. Token Disconnect is local, preserves files and other connections, and does not revoke an issued token. |
| `unit/publicationConnectionIdentity.test.ts` | Only the legacy singleton publication-sentinel variant: no old-client compatibility or descriptor migration exists. Current and retained identity/recovery assertions remain. |

`unit/reviewedScopedInput.test.ts` remains, ported to the exact v2 input and its
reviewed v2 client checksum; reproducibility and payload integrity are retained.

Retired access and transfer fixtures after the core v2 update:

| File | Reason |
|---|---|
| `integration/syncDevices.test.ts` | Account-enrolled device lists, device naming and account-device revocation were replaced by issued-token management; token UI and v2 client tests cover issue/list/revoke. |
| `integration/syncHandover.test.ts` | Personal enrollment, transferred sibling devices and deferred self-revocation are removed. Token registry and UI tests retain origin, credential association and independent disconnect guarantees. |
| `integration/syncJoinQuestion.test.ts` | The removed choose-a-winning-vault enrollment dialog; token first contact follows the fixed identical/conflict rules instead. |
| `unit/syncJoinEnd.test.ts` | Finishing the removed enrollment/join-choice workflow. |
| `unit/syncRevoke.test.ts` | Deferred revocation of an account-enrolled device on local disconnect; disconnect now closes only the local token connection. |
| `unit/testSharingIssuer.test.ts` | Issuer fixtures for removed grants/invitations; v2 token issuance has separate tests. |
| `unit/pluginSharingCatalogue.test.ts` | Singleton personal/scoped grant catalog for deleted sharing screens. |
| `unit/syncSharingTeardown.test.ts` | Lifetime of the removed singleton grant-sharing service; connection engine and token UI ownership tests remain. |
| `component/transferConnection.test.ts` | Settings-transfer enrollment and adoption of live sibling credentials are explicitly removed. Token connections, credentials and ledger identities cannot be transferred. |
| `unit/joinFixtureTransfer.test.ts` | Test-only account enrollment and device transfer fixture removed with the product workflow. |
| `unit/phoneReplay.test.ts` | Retired account/join device fixture, not the live token evidence runner. |
| `unit/phoneReplayFailure.test.ts` | Failure handling of the retired account/join device fixture. |
| `integration/fixtureContext.test.ts` | Test-only singleton account enrollment context, replaced by token runtime fixtures. |
| `integration/fixtureRecovery.test.ts` | Recovery of the retired account enrollment fixture; durable token registry/review storage and ledger tests remain. |

| File | Removed API-specific assertions and retained coverage |
|---|---|
| `integration/externalRepresentation.test.ts` | Six assertions of scoped receipt hooks, separate scoped metadata writes, anchored scoped snapshots and scoped-known paging. The removed scoped client/state has no equivalent separate table or commit. Unified ledger metadata, durable jobs before feed advancement, exact byte guards, restart recovery and authority-loss byte retention remain in this file; atomic ledger/document abort and replay remain in externalState. |
| `integration/externalState.test.ts` | Separate scoped head/checkpoint table identity: one token ledger now stores heads and checkpoints atomically; all transaction-abort and ownership assertions remain. |
| `integration/placementNetworkLease.test.ts` | Removed personal-note delivery callback download. The missing-baseline pull and bounded push-run lease assertions remain. |

| `integration/settingsToolsSync.test.ts` | Removed only the warning for manually changing a legacy vault/device/keychain identity. Token identity is fixed by the access token. Public address, pause, file filters, caps, origin restrictions, secret isolation and settings-write descriptions are ported to individual token connections. |
| `integration/settingsToolsSyncChecks.test.ts` | Removed address-emptying-as-disconnect and manual vault-ID replacement; neither can retarget a token connection. Normalization, all filter/cap validation, actual stored-value reporting and startup-failure reporting remain. |

| `unit/scopedContextGuards.test.ts` | The removed rule that a scoped receiver blocks personal enrollment entirely. Token root/folder/group connections coexist; executable approval and source identity tests retain execution restrictions. |

`unit/scopedStoreIdentity.test.ts`, `unit/scopedAutomaticRecovery.test.ts` and
`unit/scopedCreationBarrier.test.ts` are retained and ported to token ledger/review
identity, production engine watchers and teardown/opening barriers. Their old
scoped raw/native database split and invitation creation API no longer exist.

- `unit/ownerNativePublication.test.ts`: Removed owner paste-range proof and automatic sponsor publication; token attachment consent is per stable file identity and explicit note opening.

- `unit/nativeOwnerPullBaseline.test.ts`: Removed personal pull callbacks and owner sponsor-baseline protocol; the token adapter records received attachment provenance.

- `unit/nativeOwnerPartialBatch.test.ts`: Removed owner admitted-unit/sponsor proof schema; v2 explicit attachment publication owns an independent durable request.

- `unit/confirmationReview.test.ts`: Removed own-paste certification and sponsor discovery model; attachment questions now originate from explicit note opening and per-connection provenance.

- `unit/discoveryLifecycle.test.ts`: Removed personal owner grant catalogue written to synced settings; token scopes are server-authorized and live credentials remain device-local.

- `unit/publicationConnectionIdentity.test.ts`: Removed publication stores and legacy principal/sentinel retirement model; token records and device review source binding cover the current identities.

- `integration/nativeOwnerAdmission.test.ts`: Removed owner admitted publication units and sponsor receipts, not part of v2 explicit publication.

- `integration/ownerBindingGrowth.test.ts`: Removed legacy owner prepared/submitted ledger schema and its upgrade paths; the addendum forbids legacy migration.

- `integration/ownerLedgerBudget.test.ts`: Removed legacy owner prepared-row budgets and migration; v2 publication storage must enforce its own durable capacity.

- `component/pluginCode.test.ts`: Retired whole-plugin installation catalogue and batch reload screen; immutable per-file code review is tested by tokenSyncUi and executableReview (approval, rejection and deferred candidates).

- `component/publicationPrompt.test.ts`: Retired sponsor and paste-evidence automatic foreground prompt; token attachment questions originate only from the real note-open port, with durable per-connection consent.

- `component/syncLog.test.ts`: Retired singleton sync-log screen and clipboard buffer; token connections expose independent progress, refusal and conflict state instead.

- `integration/syncStagedSettings.test.ts` (partial): removed whole-plugin catalogue batches, device display-name lookup, and latest-only approval semantics. Token tests retain ordinary settings review/reload, exact immutable executable approval, later candidates, rejection and restart.
- `integration/syncOwnSettings.test.ts` (partial): removed the personal join-choice case (`this device wins`), which has no token-model counterpart. First contact follows the fixed server-plus-local-conflict rule. Other reload, secret, concurrency and convergence guarantees remain.

### Token-host test ports

- `integration/syncService.test.ts` (partial retirement): account sign-in/password flow, account-token disposal, device enrolment and replacement, the personal vault picker, singleton replacement/forget and preferences, v1 connection migration/upgrade compatibility, legacy forgotten-ledger garbage collection and singleton engine/log observations describe the removed access model. Retained exchange, device-only credentials and ledger isolation, pause races, settings review/reload, selective and ignore inputs, hidden paths, offline/revoked states, lookup, log limits, startup callbacks and phone polling/foreground run through the native token host. Missing-ledger, reconnect, late receipt and bundle-reload guarantees also remain in `missingLedger`, `idbReopenIdentity`, `externalRecoveryBarrier`, `externalScopedOwnership`, `syncBundleReload`, `tokenConnectionRegistry` and `tokenUi`.
- `integration/syncJoin.test.ts` (partial retirement): removed the initial side-choice dialog, enrolment counters, transferred personal bindings and persisted `mine`/`theirs`/`merge` answers. First contact now follows the fixed model: one identical file, or server bytes plus one local conflict copy. Native tests retain paths, original mtimes, restart without deletes, edits during download and reconnect identity.
- `integration/externalLifecycle.test.ts` (partial retirement): removed account re-enrolment, personal vault replacement and settings-transfer lifecycle verbs, scoped reader-role departure and revocation-on-leave. Token disconnect is local and retains its ledger. Token tests retain external availability states, orphan projections, retained installation bytes, read failure/retry and pre-mutation credential protection. Durable preparation/materialization tests remain in `externalAttachmentApi`.
- `integration/externalRecoveryBarrier.test.ts` (partial retirement): removed creation of the retired script-trust sentinel and owner-publication constructor hook. Their ordering guarantee is preserved by testing current external inspection before any native engine activation, script provenance or replay. All recovery, filesystem, retained-client, multipart, descriptor and successor fences are ported.
- `integration/externalScopedOwnership.test.ts`: all seven ownership/recovery guarantees are ported to token hosts; only scoped installation credentials, self-revocation and the old Leave queue are retired.
- `integration/scopedPublicationPush.test.ts` (partial retirement): removed sponsor link snapshots and admitted-unit cleanup/schema. Token tests retain consent before enqueue, immutable bytes and request key across response loss, committed-versus-follow-up-failure distinction and interrupted cleanup retry.
- `unit/scopedItemHolds.test.ts` (partial retirement): removed `ScopedState` and the two-slot scoped journal schema. Durable immutable source retention and abort-before-send are ported to token publication. Rejected-item retention now passes against the durable token outbox, alongside independent receiving and later uploads.

The historical server fixture gates no longer hide removed-product tests:

- `tests/integration/ownerHttpApi.test.ts`: v1 owner account, vault and grant routes replaced by v2 token issuance.
- `tests/integration/ownerSharingContracts.test.ts`: released and pinned v1 invitations, reader roles and sponsored-grant contracts removed.
- `tests/integration/sponsoredHttpApi.test.ts`: v1 sponsor proofs and admitted-unit publication replaced by explicit v2 attachment publication.
- `tests/integration/groupJoinHttp.test.ts`: v1 recipient account registration and scoped invitations replaced by tokens.
- `tests/integration/groupOwnerHttp.test.ts`: v1 password-authorized owner group previews removed.
- `tests/integration/sponsoredApiAvailability.test.ts`: availability of removed v1 sponsored-asset routes is no longer a product guarantee.
- `tests/integration/replayProbeHttp.test.ts`: removed phone replay observation driver over v1 device commits; immutable request retry remains covered by token publication tests.
- `tests/helpers/scopedApiServer.ts`: unused historical account/vault/invitation fixture after these removals.

- `integration/productionSharingBuild.test.ts` (partial retirement and port): deleted invitations, password enrollment, owner/grant preview controls, intrinsic sponsors and separate scoped creation APIs. Production bundle boot, native controls, actual note-open consent, denial, no automatic private publication, immutable response-loss retry, ordinary exchange beside obsolete markers and twenty binary reconnect/drain cycles remain as token tests. The retired owner-publication database deletion assertion is replaced by native runtime closure; token ledgers retain recovery evidence by design.
- `unit/serverTestFixtures.test.ts` (partial retirement): removed historical owner/group/sponsored gate combinations and names of already deleted singleton handover/device tests. Current fixture absence, explicit selection, provenance checks and a new existing-file assertion remain.

### Live tier token ports (P11)

These files remain, with removed access flows deleted and surviving behavior ported to the
production token host. No live desktop or iPhone pass is implied by the port.

- `e2e/sync.e2e.test.ts`: deleted password initialization and account/device pairing via the daemon. Both-way file operations, original timestamps, line merging, exactly one stable conflict copy and native history/trash restore now use two leased token pools.
- `e2e/syncJoin.e2e.test.ts`: deleted vault selection, enrolment and the mine/theirs/merge join-choice dialogs. Identical first-contact files, server plus local conflict bytes, local-only uploads and restart without another token remain.
- `e2e/syncDevices.e2e.test.ts`: deleted account invitations, reader roles, separate personal/scoped connections and singleton device replacement. Folder/group sharing, onward issuance, revocation/disconnect retaining files, overlapping connections, unavailable-server isolation and explicit private attachment consent remain.
- `e2e/syncDeletes.e2e.test.ts`: deleted password/daemon setup only. Bulk-deletion holds, both answers, paused answer replacement, palette pause, directory cleanup, sequential restore queue and bulk restore are ported to token connections.
- `e2e/syncSettings.e2e.test.ts`: deleted personal join decisions and whole-plugin installation catalogue/version-batch approvals. Ordinary settings Later/Keep/Apply, immutable executable new/change/rename/delete review, later candidates, original mtime, restart provenance, own plugin code and partial-scope configuration exclusion remain.
- `e2e/syncDialogs.e2e.test.ts`: deleted login, account creation, vault picker, invitation/reader dialogs, three-way join choices and whole-plugin catalogue screens. Surviving token screens retain overflow, height caps, focus-ring, reachable-action, held-path count, history paging/preview/confirmation, log, trash and date-field checks at desktop and narrow widths. Actual file exchange and foreground phone behavior are in sync and syncPhone.
- `e2e/syncTransfer.e2e.test.ts`: deleted copied personal device-binding/reconnect flow. Settings transfer still must exclude live tokens, local registry identities and ledgers, checked against the real collector and stored settings.
- `e2e/syncPhone.e2e.test.ts`: deleted the password/account paired-versus-unpaired screen model. Geometry is ported to syncDialogs; this file now drives the physical phone tier for scenarios 117–124.
- `e2e/personalBaseline.e2e.test.ts`: deleted v1 account/daemon admission and personal baseline protocol. Committed-response-loss replay and quiet version stability remain through the native token engine; multi-source offload hydration is added through the production coordinator.
- `e2e/helpers/syncServer.ts`: deleted daemon init/config/password/account helpers; the pinned fixture provisions a root token with `user create` and issues scope tokens over v2.
- `e2e/helpers/syncDriver.ts`: deleted sign-in pacing, account/login, vault choice, enrollment and legacy singleton service verbs. Native token actions use the existing bounded CLI transport and private credential-result handling.
- `e2e/helpers/syncScreens.ts`: deleted synthetic retired-screen service fixtures; captures now measure real native token screens in their owner document.

`e2e/syncedScripts.e2e.test.ts` and the independent current component/integration guarantees
for partial settings-write failures, review concurrency and phone foreground polling are retained.

### Surviving transfer and language guarantees

- `component/sharingPlainLanguage.test.ts` (port): removed the deleted `PublicationConfirmModal` import and sponsor/admission question schema. The private-file question remains in `TokenDialogs`: plain language, file and connection names, hidden internal identities, exact Allow/Deny controls, and disabled answers while a decision runs are retained.
- `unit/designConformance.test.ts` (partial retirement and port): the singleton `SyncLogModal` scroll-list target is removed. History/trash lists keep their existing rules; token sharing and executable review are checked against their shared scrolling body and separately pinned footer. Transfer name/note columns and phone metadata rules remain unchanged.

## 2.6.0 release e2e addendum

- `e2e/personalStand.e2e.test.ts`: retired account login, vault selection, sibling-device enrollment and encrypted connection transfer supplement. No current token connection can run those stages. Surviving guarantees: `sync` covers bidirectional edits, renames and exact binary bytes; `syncDeletes` covers the 60-file delete hold and restoration; `personalBaseline` covers committed-response-loss recovery after plugin restart with exactly one version; `syncSettings` covers incoming executable review and plugin-code staging; `syncDevices` covers token issuance, revocation and local disconnect; `syncTransfer` verifies that ordinary settings never carry live credentials or ledger identity. Pool ownership/reset coverage remains in `personalBaselineCleanup`, `syncResetPool` and `syncResetPhone`.
- `e2e/fencedScreens.e2e.test.ts`: retired presentation-only fixture API for account/scoped sharing, initial batches, invitations, publication, unshare and personal join, including obsolete offline/cache/scope states. It cannot open current product screens. `phoneLayout` and `dialogRings` retain all eleven token fixtures, including attachment consent and executable review; `syncDialogs` measures real token connection/share/error, incoming code, history/trash/log surfaces at desktop and phone widths; `syncPhone` covers script provenance and exact content, and `syncSettings` retains executable approval races and plugin-code staging. No live approval or staging test is removed.
- `phoneLayout` and `dialogRings` (partial retirement): removed the owner publication-confirmation injection and its expectations. The replacement attachment question and executable review remain in both dialog inventories as `sync-attachment` and `sync-review`. Canvas publication review/confirmation is unrelated and remains measured. The unused `helpers/publicationQuestion.ts` presentation fixture is removed with its consumers.
