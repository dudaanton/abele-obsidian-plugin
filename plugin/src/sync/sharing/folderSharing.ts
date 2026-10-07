import { CreateFolderGrantRequestSchema, IssueFolderKeyRequestSchema } from '@abele/sync-protocol'
import { sha256 } from '@abele/sync-core'
import type { GrantPreparation } from './grantPreparation'
export const OWNER_SHARING_ENABLED = true
export interface FolderPreview {
  /** Opaque UI review identity; the HTTP preview endpoint cannot supply this authority. */
  reviewId?: string
  prefix: string
  generation: string
  complete: boolean
  files: {
    path: string
    fileId: string | null
    versionId: string | null
    eligible: boolean
    eligibility?: 'eligible' | 'excluded' | 'unknown'
  }[]
}
export interface OwnerSession {
  facet: 'account'
  ownerVaultId: string
  authenticatedAt: number
  expiresAt: number
}
export interface FolderGrant {
  state?: string
  preparation?: GrantPreparation
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
  authorize(password: string, email?: string): Promise<OwnerSession>
  create(
    session: OwnerSession,
    request: { label: string; prefix: string; role: 'reader' | 'editor' }
  ): Promise<FolderGrant>
  prepare?(session: OwnerSession, grant: FolderGrant): Promise<FolderGrant>
  issue(
    session: OwnerSession,
    grant: FolderGrant,
    request: { attempt_id: string; name: string; role: 'reader' | 'editor'; expires_at: string }
  ): Promise<MachineCredential>
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const fingerprint = (p: FolderPreview) => sha256(new TextEncoder().encode(JSON.stringify(p)))
/** Owner/session and machine-secret ports are distinct; activation remains disabled. */
export class FolderSharingFlow {
  preview: FolderPreview | null = null
  secret: MachineCredential | null = null
  private draft: {
    label: string
    prefix: string
    role: 'reader' | 'editor'
    fingerprint: string
    attempt: string
    reviewId: string
  } | null = null
  private generation = 0
  private confirming: object | null = null
  private assertCurrent(generation: number) {
    this.fence()
    if (generation !== this.generation) throw new Error('Folder review was cancelled or superseded')
  }
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
    const generation = this.generation
    const request = CreateFolderGrantRequestSchema.parse({ prefix, role, label })
    const p = copy(await this.port.preview(request.prefix))
    if (
      !p.complete ||
      p.prefix !== request.prefix ||
      !p.generation ||
      p.files.some((f) => !f.path.startsWith(request.prefix))
    )
      throw new Error('A complete current folder preview is required')
    delete p.reviewId
    const proof = await fingerprint(p),
      reviewId = crypto.randomUUID()
    this.assertCurrent(generation)
    this.preview = { ...p, reviewId }
    this.draft = { ...request, fingerprint: proof, attempt: crypto.randomUUID(), reviewId }
    return copy(this.preview)
  }
  async confirm(
    password: string,
    email?: string,
    shown?: FolderPreview
  ): Promise<MachineCredential> {
    this.fence()
    const draft = this.draft,
      generation = this.generation
    if (!draft) throw new Error('Review a folder first')
    if (this.confirming) throw new Error('Folder confirmation is already in progress')
    const operation = {}
    this.confirming = operation
    try {
      if (shown) {
        const display = copy(shown)
        if (display.reviewId !== draft.reviewId) throw new Error('Displayed folder review changed')
        delete display.reviewId
        if ((await fingerprint(display)) !== draft.fingerprint)
          throw new Error('Displayed folder preview differs; review it again')
      }
      this.assertCurrent(generation)
      this.secret = null
      if (!this.session) {
        if (!password) throw new Error('Current account password is required')
        try {
          const authorized = email
            ? await this.port.authorize(password, email)
            : await this.port.authorize(password)
          this.assertCurrent(generation)
          this.session = authorized
        } catch {
          throw new Error('Owner authentication failed')
        }
      }
      this.assertCurrent(generation)
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
      const current = copy(await this.port.preview(draft.prefix))
      delete current.reviewId
      const proof = await fingerprint(current)
      this.assertCurrent(generation)
      if (!current.complete || proof !== draft.fingerprint)
        throw new Error('Folder preview changed; review it again')
      this.assertCurrent(generation)
      if (!this.grant) {
        const created = await this.port.create(session, {
          label: draft.label,
          prefix: draft.prefix,
          role: draft.role,
        })
        this.assertCurrent(generation)
        this.grant = created
      }
      let steps = 0
      while (this.grant.state === 'preparing') {
        if (!this.port.prepare) throw new Error('Grant preparation must be retried')
        if (++steps > 100) throw new Error('Grant preparing; retry preparation, not creation')
        const prepared = await this.port.prepare(session, copy(this.grant))
        this.assertCurrent(generation)
        if (
          prepared.id !== this.grant.id ||
          prepared.revision !== this.grant.revision ||
          prepared.prefix !== this.grant.prefix ||
          prepared.role !== this.grant.role
        )
          throw new Error('Grant preparation identity changed')
        this.grant = prepared
        if (!['active', 'preparing'].includes(prepared.state ?? ''))
          throw new Error('Grant preparation state changed')
      }
      const grant = this.grant
      if (
        grant.prefix !== draft.prefix ||
        grant.role !== draft.role ||
        !grant.id ||
        grant.revision < 0
      )
        throw new Error('Folder grant does not match the reviewed scope')
      this.assertCurrent(generation)
      const request = IssueFolderKeyRequestSchema.parse({
        attempt_id: draft.attempt,
        name: 'Folder receiver',
        role: draft.role,
        expires_at: new Date(Math.min(session.expiresAt, now + 3600000)).toISOString(),
      })
      const credential = await this.port.issue(session, grant, request)
      if (
        credential.facet !== 'scoped' ||
        credential.grantId !== grant.id ||
        credential.role !== draft.role ||
        !/^absk_[A-Za-z0-9_-]{43}$/.test(credential.token)
      )
        throw new Error('Only the exact scoped machine credential may be displayed')
      this.assertCurrent(generation)
      this.secret = copy(credential)
      return copy(credential)
    } finally {
      if (this.confirming === operation) this.confirming = null
    }
  }
  clear() {
    this.generation++
    this.confirming = null
    this.preview = null
    this.secret = null
    this.draft = null
    this.session = null
    this.grant = null
  }
}
