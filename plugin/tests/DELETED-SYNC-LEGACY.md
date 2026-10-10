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
