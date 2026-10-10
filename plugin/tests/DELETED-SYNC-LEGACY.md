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
shared placement, file/version journal or recovery guarantee is removed. Group-only
integration expectations remain explicitly dependent on the group implementation.

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
