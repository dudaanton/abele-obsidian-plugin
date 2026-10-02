import { CreateFolderGrantRequestSchema, IssueFolderKeyRequestSchema } from '@abele/sync-protocol'
import { sha256 } from '@abele/sync-core'
export const OWNER_SHARING_ENABLED = false
export interface FolderPreview {
  prefix: string
  generation: string
  complete: boolean
  files: { path: string; fileId: string | null; versionId: string | null; eligible: boolean }[]
}
export interface OwnerSession {
  facet: 'account'
  ownerVaultId: string
  authenticatedAt: number
  expiresAt: number
}
export interface FolderGrant {
  id: string
  prefix: string
  role: 'reader' | 'editor'
  revision: number
}
export interface MachineCredential {
  grantId: string
  token: string
  facet: 'scoped'
  role: 'reader' | 'editor'
}
export interface FolderSharingPort {
  preview(prefix: string): Promise<FolderPreview>
  authorize(password: string): Promise<OwnerSession>
  create(
    session: OwnerSession,
    request: { label: string; prefix: string; role: 'reader' | 'editor' }
  ): Promise<FolderGrant>
  issue(
    session: OwnerSession,
    grant: FolderGrant,
    request: { attempt_id: string; name: string; role: 'reader' | 'editor'; expires_at: string }
  ): Promise<MachineCredential>
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const fingerprint = (p: FolderPreview) => sha256(new TextEncoder().encode(JSON.stringify(p)))
/** No network implementation/activation yet: owner/session and machine-secret ports are distinct. */
export class FolderSharingFlow {
  preview: FolderPreview | null = null
  secret: MachineCredential | null = null
  private draft: {
    label: string
    prefix: string
    role: 'reader' | 'editor'
    fingerprint: string
    attempt: string
  } | null = null
  private session: OwnerSession | null = null
  private grant: FolderGrant | null = null
  constructor(
    readonly vaultId: string,
    private readonly port: FolderSharingPort,
    private readonly enabled: () => boolean = () => OWNER_SHARING_ENABLED,
    private readonly now: () => number = () => Date.now()
  ) {}
  private fence() {
    if (!this.enabled())
      throw new Error('Owner folder sharing is disabled pending activation gates')
  }
  async review(prefix: string, role: 'reader' | 'editor', label: string): Promise<FolderPreview> {
    this.fence()
    this.clear()
    const request = CreateFolderGrantRequestSchema.parse({ prefix, role, label })
    const p = copy(await this.port.preview(request.prefix))
    if (
      !p.complete ||
      p.prefix !== request.prefix ||
      !p.generation ||
      p.files.some((f) => !f.path.startsWith(request.prefix))
    )
      throw new Error('A complete current folder preview is required')
    this.preview = p
    this.draft = { ...request, fingerprint: await fingerprint(p), attempt: crypto.randomUUID() }
    return copy(p)
  }
  async confirm(password: string): Promise<MachineCredential> {
    this.fence()
    if (!this.draft) throw new Error('Review a folder first')
    this.secret = null
    if (!this.session) {
      if (!password) throw new Error('Current account password is required')
      try {
        this.session = await this.port.authorize(password)
      } catch {
        throw new Error('Owner authentication failed')
      }
    }
    const session = this.session,
      now = this.now()
    if (
      !Number.isFinite(session.authenticatedAt) ||
      !Number.isFinite(session.expiresAt) ||
      session.facet !== 'account' ||
      session.ownerVaultId !== this.vaultId ||
      session.authenticatedAt > now ||
      now - session.authenticatedAt >= 300000 ||
      session.expiresAt <= now
    )
      throw new Error('Fresh vault-owner password authentication is required')
    const current = copy(await this.port.preview(this.draft.prefix))
    if (!current.complete || (await fingerprint(current)) !== this.draft.fingerprint)
      throw new Error('Folder preview changed; review it again')
    this.fence()
    if (!this.grant)
      this.grant = await this.port.create(session, {
        label: this.draft.label,
        prefix: this.draft.prefix,
        role: this.draft.role,
      })
    const grant = this.grant
    if (
      grant.prefix !== this.draft.prefix ||
      grant.role !== this.draft.role ||
      !grant.id ||
      grant.revision < 1
    )
      throw new Error('Folder grant does not match the reviewed scope')
    this.fence()
    const request = IssueFolderKeyRequestSchema.parse({
      attempt_id: this.draft.attempt,
      name: 'Folder receiver',
      role: this.draft.role,
      expires_at: new Date(Math.min(session.expiresAt, now + 3600000)).toISOString(),
    })
    const credential = await this.port.issue(session, grant, request)
    if (
      credential.facet !== 'scoped' ||
      credential.grantId !== grant.id ||
      credential.role !== this.draft.role ||
      !/^absk_[A-Za-z0-9_-]{43}$/.test(credential.token)
    )
      throw new Error('Only the exact scoped machine credential may be displayed')
    this.fence()
    this.secret = copy(credential)
    return copy(credential)
  }
  clear() {
    this.preview = null
    this.secret = null
    this.draft = null
    this.session = null
    this.grant = null
  }
}
