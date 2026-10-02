import { OWNER_SHARING_ENABLED } from './folderSharing'
import type { OwnerDevice, AssetView, PublishedAsset } from './sponsoredAssets'
export interface UnshareReview {
  grantId: string
  fileId: string
  path: string
  versionId: string
  sha: string
  revision: number
  withdrawalGeneration: number
  intentId: string
}
export interface PublicationSettingsPort {
  load(grantId: string): Promise<AssetView>
  unshare(request: {
    grantId: string
    fileId: string
    revision: number
    withdrawalGeneration: number
    intentId: string
  }): Promise<void>
}
export class PublicationSettingsModel {
  view: AssetView | null = null
  constructor(
    private readonly owner: OwnerDevice,
    private readonly port: PublicationSettingsPort,
    private readonly enabled: () => boolean = () => OWNER_SHARING_ENABLED
  ) {}
  private fence() {
    if (!this.enabled()) throw new Error('Owner publication settings are disabled')
    if (
      this.owner.facet !== 'device' ||
      !this.owner.owner ||
      this.owner.principalId !== this.owner.localDeviceId
    )
      throw new Error('Personal owner publication context required')
  }
  async load(grantId: string): Promise<AssetView> {
    this.fence()
    const view = await this.port.load(grantId)
    this.fence()
    if (view.grantId !== grantId) throw new Error('Publication audience binding changed')
    this.view = JSON.parse(JSON.stringify(view)) as AssetView
    return JSON.parse(JSON.stringify(view)) as AssetView
  }
  referenceState(
    fileId: string,
    evidence: { complete: boolean; referencedIds: string[] }
  ): 'referenced' | 'no-longer-referenced' | 'unknown' {
    if (!this.view?.entries.some((e) => e.target.fileId === fileId) || !evidence.complete)
      return 'unknown'
    return evidence.referencedIds.includes(fileId) ? 'referenced' : 'no-longer-referenced'
  }
  reviewUnshare(fileId: string): UnshareReview {
    this.fence()
    const view = this.view,
      entry = view?.entries.find((e) => e.target.fileId === fileId)
    if (!view || !entry) throw new Error('Published identity unavailable')
    return {
      grantId: view.grantId,
      fileId,
      path: entry.target.path,
      versionId: entry.target.versionId,
      sha: entry.target.sha,
      revision: view.revision,
      withdrawalGeneration: view.withdrawalGeneration,
      intentId: crypto.randomUUID(),
    }
  }
  async confirmUnshare(review: UnshareReview): Promise<void> {
    this.fence()
    const current = await this.port.load(review.grantId)
    this.fence()
    const entry = current.entries.find((e) => e.target.fileId === review.fileId)
    if (
      current.grantId !== review.grantId ||
      current.revision !== review.revision ||
      current.withdrawalGeneration !== review.withdrawalGeneration ||
      !entry ||
      entry.target.versionId !== review.versionId ||
      entry.target.sha !== review.sha
    )
      throw new Error('Unshare preview changed; review the current identity again')
    await this.port.unshare({
      grantId: review.grantId,
      fileId: review.fileId,
      revision: review.revision,
      withdrawalGeneration: review.withdrawalGeneration,
      intentId: review.intentId,
    })
  }
  assets(kind: PublishedAsset['kind']): PublishedAsset[] {
    return this.view?.entries.filter((e) => e.kind === kind) ?? []
  }
}
