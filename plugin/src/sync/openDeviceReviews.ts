import { IndexedDbStateStore } from './IndexedDbStateStore'
import { ExecutableReview } from './executableReview'
import { AttachmentConsent } from './attachmentConsent'
import { reviewId } from './reviewState'
import type { ExecutablePaths } from './stagedPluginCode'

/** deviceVaultId is host-local, never a server space ID or a transferred setting. */
export async function openDeviceReviews(
  factory: IDBFactory,
  deviceVaultId: string,
  paths: ExecutablePaths = {},
  assertHeld: () => void = () => {}
) {
  reviewId.parse(deviceVaultId)
  const store = await IndexedDbStateStore.open(factory, 'abele-sync-reviews-' + deviceVaultId, {
    identity: { key: 'device-review-identity-v1', value: deviceVaultId },
    effectGuard: assertHeld,
  })
  return {
    executables: new ExecutableReview(store, paths),
    attachments: new AttachmentConsent(store, paths),
    close: () => store.close(),
  }
}
