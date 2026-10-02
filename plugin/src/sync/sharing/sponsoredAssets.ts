import { OWNER_SHARING_ENABLED } from './folderSharing'
export interface Sponsor {
  fileId: string
  versionId: string
  admissionGeneration: number
  inScope: boolean
  intrinsic: boolean
}
export interface Target {
  fileId: string
  versionId: string
  sha: string
  path: string
  eligible: boolean
}
export interface PublishedAsset {
  target: Target
  sponsors: Sponsor[]
  reason: string
  kind: 'owner-extra' | 'native-asset'
}
export interface AssetView {
  grantId: string
  revision: number
  withdrawalGeneration: number
  active: boolean
  role: 'reader' | 'editor'
  entries: PublishedAsset[]
}
export interface OwnerDevice {
  facet: 'device' | 'scoped' | 'account'
  principalId: string
  localDeviceId: string
  owner: boolean
}
export interface OwnerAdd {
  grantId: string
  expectedRevision: number
  withdrawalGeneration: number
  intentId: string
  decisionDeviceId: string
  target: Target
  sponsors: Sponsor[]
  reason: 'initial-batch' | 'new-local' | 'confirmed-existing'
}
export interface ScopedEditor {
  facet: 'scoped'
  principalId: string
  grantId: string
  role: 'reader' | 'editor'
}
export interface NativeCreate {
  grantId: string
  path: string
  localCreateHandle: string
  sha: string
  eligible: boolean
  sponsor: Sponsor
  upload: { principalId: string; grantId: string; sha: string; entitlementId: string }
}
export type AssetDelta =
  | { kind: 'add'; entry: PublishedAsset }
  | { kind: 'remove-sponsor'; sponsorId: string; withdrawWhenEmpty: true }
  | { kind: 'withdraw'; fileId: string; expectedGeneration: number }
export interface SponsoredAssetPort {
  read(grantId: string): Promise<AssetView>
  mutate(
    grantId: string,
    delta: AssetDelta,
    expectedRevision: number,
    intentId: string
  ): Promise<AssetView>
  nativeCreate(
    grantId: string,
    request: NativeCreate
  ): Promise<{ fileId: string; versionId: string }>
}
const digest = (s: string) => /^[a-f0-9]{64}$/.test(s)
const sponsorValid = (s: Sponsor) =>
  !!s.fileId &&
  !!s.versionId &&
  s.inScope &&
  s.intrinsic &&
  Number.isSafeInteger(s.admissionGeneration) &&
  s.admissionGeneration > 0
/** No body-link parser, grant expansion, whole-list replacement or personal-token fallback. */
export class SponsoredAssetService {
  constructor(
    private readonly port: SponsoredAssetPort,
    private readonly enabled: () => boolean = () => OWNER_SHARING_ENABLED,
    private readonly configurationRoots: string[] = []
  ) {}
  private fence() {
    if (!this.enabled())
      throw new Error('Sponsored publication is disabled pending activation gates')
  }
  private owner(owner: OwnerDevice) {
    this.fence()
    if (owner.facet !== 'device' || !owner.owner || owner.principalId !== owner.localDeviceId)
      throw new Error('Current personal owner device is required')
  }
  private eligible(path: string, known: boolean) {
    if (
      !known ||
      !path ||
      path.startsWith('/') ||
      path.split('/').some((p) => !p || p === '.' || p === '..' || p.startsWith('.')) ||
      this.configurationRoots.some((root) => path === root || path.startsWith(root + '/')) ||
      /\.(?:js|mjs|cjs|ts|py|sh|wasm)$/i.test(path)
    )
      throw new Error('Target is code/settings or eligibility is unknown')
  }
  private async view(grantId: string): Promise<AssetView> {
    const view = await this.port.read(grantId)
    if (view.grantId !== grantId || !view.active) throw new Error('Grant admission is unavailable')
    return view
  }
  async add(owner: OwnerDevice, input: OwnerAdd): Promise<AssetView> {
    this.owner(owner)
    const r = JSON.parse(JSON.stringify(input)) as OwnerAdd
    if (r.decisionDeviceId !== owner.localDeviceId)
      throw new Error('Foreign device publication decision refused')
    if (!r.intentId || !r.target.fileId || !r.target.versionId || !digest(r.target.sha))
      throw new Error('Exact target identity/version and durable intent are required')
    this.eligible(r.target.path, r.target.eligible)
    if (
      !r.sponsors.length ||
      r.sponsors.some((s) => !sponsorValid(s)) ||
      new Set(r.sponsors.map((s) => s.fileId)).size !== r.sponsors.length
    )
      throw new Error('Independent intrinsic note sponsors are required')
    const view = await this.view(r.grantId)
    if (view.revision !== r.expectedRevision)
      throw new Error('Publication revision changed; refresh the delta')
    if (view.withdrawalGeneration !== r.withdrawalGeneration)
      throw new Error('Publication withdrawal changed; old approval cannot re-add')
    this.owner(owner)
    return this.port.mutate(
      r.grantId,
      {
        kind: 'add',
        entry: { target: r.target, sponsors: r.sponsors, reason: r.reason, kind: 'owner-extra' },
      },
      r.expectedRevision,
      r.intentId
    )
  }
  async departure(
    owner: OwnerDevice,
    grantId: string,
    sponsorId: string,
    revision: number,
    complete: boolean,
    intentId: string
  ): Promise<AssetView> {
    this.owner(owner)
    if (!complete) throw new Error('A complete explicit admission transition is required')
    const view = await this.view(grantId)
    if (view.revision !== revision) throw new Error('Publication revision changed')
    this.owner(owner)
    return this.port.mutate(
      grantId,
      { kind: 'remove-sponsor', sponsorId, withdrawWhenEmpty: true },
      revision,
      intentId
    )
  }
  async unshare(
    owner: OwnerDevice,
    grantId: string,
    fileId: string,
    revision: number,
    generation: number,
    intentId: string
  ): Promise<AssetView> {
    this.owner(owner)
    const view = await this.view(grantId)
    if (view.revision !== revision || view.withdrawalGeneration !== generation)
      throw new Error('Publication withdrawal/revision changed')
    this.owner(owner)
    return this.port.mutate(
      grantId,
      { kind: 'withdraw', fileId, expectedGeneration: generation },
      revision,
      intentId
    )
  }
  async createNative(
    principal: ScopedEditor,
    input: NativeCreate
  ): Promise<{ fileId: string; versionId: string }> {
    this.fence()
    const r = JSON.parse(JSON.stringify(input)) as NativeCreate
    if (
      principal.facet !== 'scoped' ||
      principal.grantId !== r.grantId ||
      principal.role !== 'editor'
    )
      throw new Error('Current scoped editor is required')
    this.eligible(r.path, r.eligible)
    if (!sponsorValid(r.sponsor) || !r.localCreateHandle)
      throw new Error('Authorized intrinsic note sponsor and fresh create handle required')
    if (
      !digest(r.sha) ||
      r.upload.sha !== r.sha ||
      r.upload.principalId !== principal.principalId ||
      r.upload.grantId !== r.grantId ||
      !r.upload.entitlementId
    )
      throw new Error('Own principal-specific upload proof is required')
    const view = await this.view(r.grantId)
    if (view.role !== 'editor') throw new Error('Grant editor ceiling changed')
    this.fence()
    // The server checks occupancy without disclosure and consumption under its authority fence.
    try {
      return await this.port.nativeCreate(r.grantId, r)
    } catch {
      throw new Error('Destination unavailable; local work retained')
    }
  }
}
