# P21 deleted-test ledger

Base: `e27d850d8`. Includes branch deletions and P21 working-tree deletions; restored files are explicitly recorded. Paths are relative to `plugin/`. Covering files preserve surviving token guarantees, not retired v1 schemas.

The requested external destination cannot be written from this workspace. Copy this file to the requested `plans/abele-sync/2026-10-10-deleted-tests-ledger.md` destination after review.

| File | Reason or covering test on HEAD |
|---|---|
| `src/testing/FencedScreenFixture.vue` | module removed: testing/FencedScreenFixture.vue |
| `src/testing/fencedScreens.ts` | module removed: testing/fencedScreens.ts (tokenUiFixture.ts replaces it) |
| `src/testing/fixtureContext.ts` | tests/unit/resetSyncTokenState.test.ts; tests/unit/resetTokenPool.test.ts |
| `src/testing/joinFixtureTransfer.ts` | module removed: testing/joinFixtureTransfer.ts |
| `src/testing/ownerPublicationFixture.ts` | module removed: testing/ownerPublicationFixture.ts |
| `src/testing/phoneReplay.ts` | module removed: phoneReplay.ts / replay evidence probe |
| `tests/component/deviceList.test.ts` | tests/component/tokenSyncUi.test.ts |
| `tests/component/folderSharingModal.test.ts` | module removed: components/sync/OwnerFolderSharingModal.vue |
| `tests/component/groupSharing.test.ts` | module removed: components/sync/GroupSharingModal.vue |
| `tests/component/initialBatchRecipients.test.ts` | tests/component/sharingPlainLanguage.test.ts |
| `tests/component/joinVaultModal.test.ts` | module removed: components/settings/sync/JoinVaultModal.vue |
| `tests/component/pluginCode.test.ts` | tests/component/tokenSyncUi.test.ts; tests/unit/tokenExecutableReview.test.ts |
| `tests/component/productionSharingPorts.test.ts` | tests/integration/productionSharingBuild.test.ts |
| `tests/component/publicationPrompt.test.ts` | module removed: publicationPrompt.ts |
| `tests/component/publicationSettings.test.ts` | module removed: components/settings/sync/OwnerPublicationSettings.vue |
| `tests/component/scopedCreation.test.ts` | module removed: components/sync/ScopedCreationModal.vue |
| `tests/component/scopedInvitation.test.ts` | module removed: components/sync/ScopedInvitationModal.vue |
| `tests/component/sharingForeground.test.ts` | module removed: publicationPrompt.ts |
| `tests/component/sharingManagementLifetime.test.ts` | tests/component/tokenSyncUi.test.ts |
| `tests/component/syncLog.test.ts` | module removed: components/sync/SyncLogModal.vue |
| `tests/component/transferConnection.test.ts` | tests/e2e/syncTransfer.e2e.test.ts; tests/integration/syncService.test.ts |
| `tests/e2e/agentStand.e2e.test.ts` | module removed: sharing owner/sponsored v1 stand |
| `tests/e2e/collaborationStand.e2e.test.ts` | module removed: scoped/groupJoinHttp.ts / v1 stand |
| `tests/helpers/nativeOwnerAdmissionFixture.ts` | module removed: publication/nativeOwnerPublication.ts |
| `tests/helpers/publicationFixture.ts` | module removed: publication/publicationIntents.ts |
| `tests/helpers/scopedApiServer.ts` | module removed: sharing/ownerHttp.ts; sponsoredHttp.ts; scoped/groupJoinHttp.ts |
| `tests/helpers/scopedPushFixture.ts` | module removed: v1 scoped publication fixture |
| `tests/integration/existingPrivateConfirmation.test.ts` | module removed: sync/publication/existingPrivateConfirmation.ts |
| `tests/integration/fixtureContext.test.ts` | tests/unit/resetSyncTokenState.test.ts; tests/unit/resetTokenPool.test.ts |
| `tests/integration/fixtureRecovery.test.ts` | tests/unit/resetTokenPool.test.ts |
| `tests/integration/groupJoinHttp.test.ts` | module removed: scoped/groupJoinHttp.ts |
| `tests/integration/groupOwnerHttp.test.ts` | module removed: sharing/ownerHttp.ts |
| `tests/integration/linkSnapshotRecovery.test.ts` | module removed: publication/LinkSnapshotStore.ts |
| `tests/integration/nativeOwnerAdmission.test.ts` | tests/unit/tokenAssetOutbox.test.ts |
| `tests/integration/ownerBindingGrowth.test.ts` | module removed: publication/publicationIntents.ts; ownerUnitStorage.ts |
| `tests/integration/ownerHttpApi.test.ts` | module removed: sharing/ownerHttp.ts |
| `tests/integration/ownerLedgerBudget.test.ts` | tests/unit/tokenAssetOutbox.test.ts |
| `tests/integration/ownerSharingContracts.test.ts` | module removed: sharing/ownerHttp.ts; sponsoredHttp.ts |
| `tests/integration/replayProbeHttp.test.ts` | module removed: phoneReplay.ts / replay evidence probe |
| `tests/integration/sponsoredApiAvailability.test.ts` | module removed: sharing/sponsoredHttp.ts |
| `tests/integration/sponsoredHttpApi.test.ts` | module removed: sharing/sponsoredHttp.ts |
| `tests/integration/syncDevices.test.ts` | tests/unit/v2Client.test.ts; tests/component/tokenSyncUi.test.ts |
| `tests/integration/syncHandover.test.ts` | tests/unit/tokenConnectionRegistry.test.ts; tests/integration/syncService.test.ts |
| `tests/integration/syncJoinQuestion.test.ts` | module removed: sync/join.ts |
| `tests/unit/abortableTransport.test.ts` | module removed: scoped/abortableTransport.ts |
| `tests/unit/confirmationReview.test.ts` | tests/unit/tokenEngineRuntime.test.ts (shadowed short link); tests/unit/tokenAttachmentConsent.test.ts |
| `tests/unit/discoveryLifecycle.test.ts` | module removed: sync/pluginSharing.ts |
| `tests/unit/fencedScreenFixture.test.ts` | module removed: FencedScreenFixture.vue / fencedScreens.ts |
| `tests/unit/folderSharing.test.ts` | module removed: sync/sharing/folderSharing.ts |
| `tests/unit/groupSharing.test.ts` | module removed: sync/sharing/groupSharing.ts |
| `tests/unit/joinFixtureTransfer.test.ts` | module removed: testing/joinFixtureTransfer.ts |
| `tests/unit/legacyScriptConnection.test.ts` | tests/unit/legacyScriptConnection.test.ts (restored) |
| `tests/unit/linkSnapshots.test.ts` | module removed: publication/LinkSnapshotStore.ts |
| `tests/unit/nativeOwnerPartialBatch.test.ts` | tests/unit/tokenAssetOutbox.test.ts |
| `tests/unit/nativeOwnerPullBaseline.test.ts` | tests/unit/tokenAttachmentConsent.test.ts; tests/unit/tokenAttachmentHost.test.ts |
| `tests/unit/ownerBindingIntentGrowth.test.ts` | module removed: sync/publication/publicationIntents.ts; ownerUnitStorage.ts |
| `tests/unit/ownerGroupRootLifetime.test.ts` | module removed: sync/sharing/ownerGroupRoot.ts |
| `tests/unit/ownerHttp.test.ts` | module removed: sync/sharing/ownerHttp.ts |
| `tests/unit/ownerLegacyBudget.test.ts` | module removed: sync/publication/ownerUnitStorage.ts |
| `tests/unit/ownerNativePublication.test.ts` | tests/unit/tokenAttachmentConsent.test.ts; tests/unit/tokenAssetOutbox.test.ts |
| `tests/unit/ownerUnitStorage.test.ts` | module removed: sync/publication/ownerUnitStorage.ts |
| `tests/unit/phoneReplay.test.ts` | module removed: phoneReplay.ts / replay evidence probe |
| `tests/unit/phoneReplayFailure.test.ts` | module removed: phoneReplay.ts / replay evidence probe |
| `tests/unit/pluginSharingCatalogue.test.ts` | module removed: sync/pluginSharing.ts |
| `tests/unit/publicationConnectionIdentity.test.ts` | module removed: publication/publicationRetirement.ts; LinkSnapshotStore.ts; publicationDecision.ts |
| `tests/unit/publicationDecision.test.ts` | module removed: sync/publication/publicationDecision.ts |
| `tests/unit/publicationEditorExit.test.ts` | module removed: sync/publicationPrompt.ts |
| `tests/unit/publicationIntents.test.ts` | module removed: sync/publication/publicationIntents.ts |
| `tests/unit/publicationSettings.test.ts` | module removed: sync/sharing/publicationSettings.ts |
| `tests/unit/scopedContextGuards.test.ts` | tests/unit/scopedContextGuards.test.ts (restored script guard) |
| `tests/unit/scopedCreation.test.ts` | module removed: sync/scoped/scopedCreation.ts |
| `tests/unit/scopedDeparture.test.ts` | tests/unit/tokenEngines.test.ts (revoked/503/network across reload) |
| `tests/unit/scopedDialogLayout.test.ts` | tests/unit/designConformance.test.ts |
| `tests/unit/scopedJoin.test.ts` | module removed: scoped/scopedJoin.ts (join workflow; recovery descriptor retained) |
| `tests/unit/scopedKeychainSlots.test.ts` | module removed: scoped/scopedSecretSlots.ts |
| `tests/unit/sharingCatalogue.test.ts` | module removed: sync/sharing/sharingCatalogue.ts |
| `tests/unit/sponsoredAssets.test.ts` | module removed: sync/sharing/sponsoredAssets.ts |
| `tests/unit/sponsoredHttpWire.test.ts` | module removed: sync/sharing/sponsoredHttp.ts |
| `tests/unit/syncJoinEnd.test.ts` | module removed: sync/engineBuild.ts / join choice |
| `tests/unit/syncRevoke.test.ts` | module removed: sync/revoke.ts |
| `tests/unit/syncSharingTeardown.test.ts` | tests/integration/syncBundleReload.test.ts; tests/unit/tokenConnectionApp.test.ts |
| `tests/unit/testSharingIssuer.test.ts` | module removed: ownerPublicationFixture.ts; fixtureSharingIssuerAllowed |
| `tests/unit/scopedReceiveContinuity.test.ts` | module removed: sync/scoped/receiveContinuity.ts |
