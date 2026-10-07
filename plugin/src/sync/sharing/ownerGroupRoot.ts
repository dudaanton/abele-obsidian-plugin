import type { GroupGrant } from './groupSharing'
import type { OwnerSession } from './folderSharing'
import type { OwnerFolderHttpPort } from './ownerHttp'

export interface GroupRoot {
  fileId: string
  versionId: string
  sha: string
  path: string
}
export interface GroupRootReview {
  id: string
  root: GroupRoot
  role: 'reader' | 'editor'
  label: string
}
/** The deployed root/version management path. It does not manufacture a certified graph
 * preview, approve anchors, or parse local frontmatter to decide membership. The server's
 * prepared group owns membership, exactly as the stand's createGroup/prepare path does. */
export class OwnerGroupRootFlow {
  private generation = 0
  private shown: GroupRootReview | null = null
  private session: OwnerSession | null = null
  private grant: GroupGrant | null = null
  private busy = false
  constructor(
    private readonly port: OwnerFolderHttpPort,
    private readonly root: (identity: string) => Promise<GroupRoot>,
    private readonly held: () => boolean
  ) {}
  private check(generation = this.generation) {
    if (!this.held() || generation !== this.generation)
      throw new Error('Owner group connection or review changed')
  }
  async review(
    identity: string,
    role: 'reader' | 'editor',
    label: string
  ): Promise<GroupRootReview> {
    this.close()
    this.check()
    const generation = this.generation
    if (!identity || !label.trim() || !['reader', 'editor'].includes(role))
      throw new Error('Choose an exact root, name and role')
    const root = await this.root(identity)
    this.check(generation)
    this.shown = { id: crypto.randomUUID(), root, role, label: label.trim() }
    return structuredClone(this.shown)
  }
  private matching(grant: GroupGrant, shown: GroupRootReview): void {
    if (
      grant.rootId !== shown.root.fileId ||
      grant.rootVersion !== shown.root.versionId ||
      grant.role !== shown.role
    )
      throw new Error('Grant does not match the reviewed root, version and role')
  }
  async confirm(shown: GroupRootReview, password: string, email?: string): Promise<GroupGrant> {
    this.check()
    if (this.busy || JSON.stringify(shown) !== JSON.stringify(this.shown))
      throw new Error('Review this exact group root first')
    this.busy = true
    const generation = this.generation
    try {
      if (!this.session) {
        const session = await this.port.authorize(password, email)
        this.check(generation)
        this.session = session
      }
      this.check(generation)
      if (JSON.stringify(await this.root(shown.root.fileId)) !== JSON.stringify(shown.root))
        throw new Error('Group root version changed')
      this.check(generation)
      if (!this.grant) {
        const grant = await this.port.createGroup(this.session, {
          label: shown.label,
          rootId: shown.root.fileId,
          rootVersion: shown.root.versionId,
          role: shown.role,
        })
        this.check(generation)
        this.matching(grant, shown)
        this.grant = grant
      }
      this.check(generation)
      this.matching(this.grant, shown)
      // Retain only this review's committed grant if preparation fails. A late reply
      // belongs to its closed generation and cannot revive the cleared cache.
      if (this.grant.state !== 'active') {
        const grant = await this.port.prepareGroup(this.session, this.grant)
        this.check(generation)
        this.matching(grant, shown)
        if (grant.id !== this.grant.id) throw new Error('Prepared grant identity changed')
        this.grant = grant
      }
      this.check(generation)
      return structuredClone(this.grant)
    } finally {
      this.busy = false
    }
  }
  async invitation(role: 'reader' | 'editor'): Promise<string> {
    this.check()
    if (!this.grant || this.grant.state !== 'active' || !this.session)
      throw new Error('Prepare the reviewed group before inviting a member')
    if (!this.shown) throw new Error('Review this exact group root first')
    this.matching(this.grant, this.shown)
    const generation = this.generation
    const token = await this.port.invitation(this.session, this.grant, role)
    this.check(generation)
    return token
  }
  close() {
    this.generation++
    this.shown = null
    this.session = null
    this.grant = null
    this.port.close()
  }
}
