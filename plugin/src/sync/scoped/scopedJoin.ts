import { normalizeServerUrl } from '@abele/sync-protocol'
import type { LocalStorage } from '../ledgerId'
export const SCOPED_JOIN_ENABLED = true
export const SCOPED_JOIN_KEY = 'abele-sync-scoped-join'
export const SCOPED_CONNECTION_KEY = 'abele-sync-scoped-connection'
export class ScopedJoinError extends Error {
  constructor(readonly code: 'personal_connected' | 'invalid_invitation') {
    super(
      code === 'personal_connected'
        ? 'This vault is already connected to personal sync or has retained connection records.'
        : 'The invitation code is invalid or expired.'
    )
  }
}
export interface ScopedInvitation {
  issuer: string
  token: string
  email: string
  name: string
  role: 'reader' | 'editor'
  platform: 'desktop' | 'mobile'
}
export interface ScopedMember {
  grantId: string
  memberId: string
  vaultId: string
  role: 'reader' | 'editor'
  rootFileId: string
  state: string
}
export interface ScopedInstallation {
  installationId: string
  token: string
  memberId: string
}
export interface ScopedLocalConnection {
  version: 4
  facet: 'scoped'
  issuer: string
  vaultId: string
  grantId: string
  memberId: string
  principalId: string
  principalKind: 'installation'
  role: 'reader' | 'editor'
  rootFileId: string
  tokenId: string
  ledgerId: string
  scriptPolicy: 'refuse'
}
export interface ScopedSecretPort {
  get(id: string): string
  set(id: string, value: string): void
}
export interface ScopedJoinPort {
  login(issuer: string, email: string, password: string): Promise<string>
  accept(
    issuer: string,
    account: string,
    invitation: string
  ): Promise<{ grantId: string; memberId: string; role: 'reader' | 'editor' }>
  discover(issuer: string, account: string): Promise<ScopedMember[]>
  enrol(
    issuer: string,
    account: string,
    request: {
      grantId: string
      attemptId: string
      name: string
      platform: 'desktop' | 'mobile'
      role: 'reader' | 'editor'
    }
  ): Promise<ScopedInstallation>
  ledger(connection: ScopedLocalConnection, initialize: boolean): Promise<boolean>
  viewState(connection: ScopedLocalConnection): Promise<'active' | 'preparing'>
  manifest(
    connection: ScopedLocalConnection
  ): Promise<{ path: string; fileId: string; versionId: string; sha: string }[]>
  localPaths(): Promise<string[]>
  pullOnly(
    connection: ScopedLocalConnection,
    policy: { publishLocal: false; holdLocalCollisions: true }
  ): Promise<void>
}
interface Pending {
  version: 4
  phase: 'accepting' | 'enrolling' | 'pulling' | 'collision-hold' | 'waiting-view' | 'joined'
  issuer: string
  email: string
  name: string
  platform: 'desktop' | 'mobile'
  role: 'reader' | 'editor'
  startedAt: number
  attemptId: string
  invitationId: string
  member?: ScopedMember
  connection?: ScopedLocalConnection
  collisions?: string[]
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
export function assertPersonalContext(storage: LocalStorage | null) {
  if (
    storage &&
    (storage.loadLocalStorage(SCOPED_JOIN_KEY) != null ||
      storage.loadLocalStorage(SCOPED_CONNECTION_KEY) != null)
  )
    throw new Error(
      'Scoped installation/join requires scoped recovery; a second personal connection is refused'
    )
}
/** This device's own local state + keychain only. No personal login/enrol/upload fallback. */
export class ScopedJoinFlow {
  private generation = 0
  private busy = false
  constructor(
    private readonly storage: LocalStorage,
    private readonly secrets: ScopedSecretPort,
    private readonly port: ScopedJoinPort,
    private readonly enabled: () => boolean = () => SCOPED_JOIN_ENABLED,
    private readonly now: () => number = () => Date.now()
  ) {}
  private fence(g?: number) {
    if (!this.enabled()) throw new Error('Scoped invitation join is disabled')
    if (g !== undefined && g !== this.generation)
      throw new Error('Scoped join was closed or superseded')
  }
  private write(p: Pending) {
    this.fence()
    this.storage.saveLocalStorage(SCOPED_JOIN_KEY, copy(p))
    if (JSON.stringify(this.storage.loadLocalStorage(SCOPED_JOIN_KEY)) !== JSON.stringify(p))
      throw new Error('Scoped join was not persisted; recovery required')
  }
  private header(p: Pending) {
    return JSON.stringify([
      p.issuer,
      p.email,
      p.name,
      p.platform,
      p.startedAt,
      p.attemptId,
      p.invitationId,
    ])
  }
  private read(): Pending {
    const p = this.storage.loadLocalStorage(SCOPED_JOIN_KEY) as Pending | null
    if (
      !p ||
      p.version !== 4 ||
      !['accepting', 'enrolling', 'pulling', 'collision-hold', 'waiting-view', 'joined'].includes(
        p.phase
      ) ||
      normalizeServerUrl(p.issuer) !== p.issuer ||
      !p.attemptId ||
      !p.invitationId ||
      !Number.isFinite(p.startedAt)
    )
      throw new Error('Scoped join state missing/unreadable; recovery required')
    if (this.secrets.get(p.invitationId + ':binding') !== this.header(p))
      throw new Error('Scoped invitation identity binding changed')
    return copy(p)
  }
  private noPersonal() {
    const c = this.storage.loadLocalStorage('abele-sync-connection') as {
      vaultId?: string
      deviceTokenId?: string
      pendingRevoke?: unknown[]
    } | null
    const ledger = this.storage.loadLocalStorage('abele-sync-ledger')
    const forgotten =
      ledger !== null &&
      typeof ledger === 'object' &&
      JSON.stringify(Object.keys(ledger).sort()) === JSON.stringify(['stateId', 'vaultId']) &&
      (ledger as { stateId?: unknown }).stateId === '' &&
      (ledger as { vaultId?: unknown }).vaultId === ''
    if (
      c?.vaultId ||
      c?.deviceTokenId ||
      c?.pendingRevoke?.length ||
      (ledger != null && !forgotten) ||
      [
        'abele-sync-ledger-proof',
        'abele-sync-ledger-bootstrap',
        'abele-sync-ledger-cleanup',
        'abele-script-provenance',
      ].some((k) => this.storage.loadLocalStorage(k) != null)
    )
      throw new ScopedJoinError('personal_connected')
  }
  async begin(invitation: ScopedInvitation): Promise<void> {
    this.fence()
    this.noPersonal()
    if (
      this.storage.loadLocalStorage(SCOPED_JOIN_KEY) != null ||
      this.storage.loadLocalStorage(SCOPED_CONNECTION_KEY) != null
    )
      throw new Error('Existing scoped context requires resume/recovery')
    const i = copy(invitation),
      issuer = normalizeServerUrl(i.issuer)
    if (
      !issuer ||
      !/^absinv_[A-Za-z0-9_-]{43}$/.test(i.token) ||
      !i.email.trim() ||
      !i.name.trim() ||
      !['reader', 'editor'].includes(i.role)
    )
      throw new ScopedJoinError('invalid_invitation')
    const invitationId = 'abele-scoped-invitation-' + crypto.randomUUID()
    this.secrets.set(invitationId, i.token)
    if (this.secrets.get(invitationId) !== i.token)
      throw new Error('Invitation secret was not kept')
    const pending: Pending = {
      version: 4,
      phase: 'accepting',
      issuer,
      email: i.email.trim().toLowerCase(),
      name: i.name.trim(),
      platform: i.platform,
      role: i.role,
      startedAt: this.now(),
      attemptId: crypto.randomUUID(),
      invitationId,
    }
    this.secrets.set(invitationId + ':binding', this.header(pending))
    if (this.secrets.get(invitationId + ':binding') !== this.header(pending))
      throw new Error('Invitation binding was not kept')
    this.write(pending)
  }
  async resume(password: string): Promise<{ phase: Pending['phase']; collisions?: string[] }> {
    this.fence()
    if (this.busy) throw new Error('Scoped join is already running')
    this.busy = true
    const generation = this.generation
    try {
      this.noPersonal()
      const p = this.read()
      const current = this.storage.loadLocalStorage(SCOPED_CONNECTION_KEY)
      if (current != null && JSON.stringify(current) !== JSON.stringify(p.connection))
        throw new Error('Another scoped connection exists; recovery required')
      if (!p.connection) {
        if (this.now() - p.startedAt >= 600000)
          throw new Error('Scoped acceptance/enrolment recovery expired')
        const account = await this.port.login(p.issuer, p.email, password)
        this.fence(generation)
        if (!/^abst_[A-Za-z0-9_-]{43}$/.test(account))
          throw new Error('Account authentication facet invalid')
        if (!p.member) {
          const invitation = this.secrets.get(p.invitationId)
          if (!/^absinv_[A-Za-z0-9_-]{43}$/.test(invitation))
            throw new Error('Invitation secret lost; recovery required')
          const accepted = await this.port.accept(p.issuer, account, invitation)
          this.fence(generation)
          const found = (await this.port.discover(p.issuer, account)).find(
            (m) => m.grantId === accepted.grantId && m.memberId === accepted.memberId
          )
          this.fence(generation)
          if (!found || found.role !== accepted.role || !found.vaultId || !found.rootFileId)
            throw new Error('Accepted scoped membership unavailable')
          p.member = copy(found)
          if (p.role === 'editor' && found.role !== 'editor') p.role = 'reader'
          p.phase = 'enrolling'
          const acceptedProof = JSON.stringify({ member: p.member, role: p.role })
          this.secrets.set(p.invitationId + ':accepted', acceptedProof)
          if (this.secrets.get(p.invitationId + ':accepted') !== acceptedProof)
            throw new Error('Accepted membership binding was not kept')
          this.write(p)
        }
        if (
          this.secrets.get(p.invitationId + ':accepted') !==
          JSON.stringify({ member: p.member, role: p.role })
        )
          throw new Error('Accepted membership identity changed')
        const install = await this.port.enrol(p.issuer, account, {
          grantId: p.member.grantId,
          attemptId: p.attemptId,
          name: p.name,
          platform: p.platform,
          role: p.role,
        })
        this.fence(generation)
        if (
          install.memberId !== p.member.memberId ||
          !install.installationId ||
          !/^absi_[A-Za-z0-9_-]{43}$/.test(install.token)
        )
          throw new Error('Only the exact scoped installation credential is allowed')
        const tokenId = 'abele-scoped-installation-' + p.attemptId
        this.secrets.set(tokenId, install.token)
        if (this.secrets.get(tokenId) !== install.token)
          throw new Error('Scoped installation secret was not kept')
        p.connection = {
          version: 4,
          facet: 'scoped',
          issuer: p.issuer,
          vaultId: p.member.vaultId,
          grantId: p.member.grantId,
          memberId: p.member.memberId,
          principalId: install.installationId,
          principalKind: 'installation',
          role: p.role,
          rootFileId: p.member.rootFileId,
          tokenId,
          ledgerId: crypto.randomUUID(),
          scriptPolicy: 'refuse',
        }
        const proof = JSON.stringify({ connection: p.connection, token: install.token })
        this.secrets.set(tokenId + ':binding', proof)
        if (this.secrets.get(tokenId + ':binding') !== proof)
          throw new Error('Installation binding was not kept')
        // Persist the identity BEFORE allocation: an interrupted allocation never silently remints.
        p.phase = 'pulling'
        this.write(p)
        if (!(await this.port.ledger(copy(p.connection), true)))
          throw new Error('Scoped ledger allocation requires recovery')
        this.fence(generation)
      }
      const connection = p.connection
      const token = this.secrets.get(connection.tokenId)
      if (
        !/^absi_[A-Za-z0-9_-]{43}$/.test(token) ||
        this.secrets.get(connection.tokenId + ':binding') !== JSON.stringify({ connection, token })
      )
        throw new Error('Scoped installation identity binding changed')
      if (!(await this.port.ledger(copy(connection), false)))
        throw new Error('Scoped ledger missing; recovery required')
      this.fence(generation)
      if (p.phase === 'joined') return { phase: 'joined' }
      const view = await this.port.viewState(copy(connection))
      this.fence(generation)
      if (view !== 'active') {
        p.phase = 'waiting-view'
        this.write(p)
        return { phase: p.phase }
      }
      const manifest = await this.port.manifest(copy(connection))
      this.fence(generation)
      const local = new Set(await this.port.localPaths())
      this.fence(generation)
      const collisions = manifest.filter((f) => local.has(f.path)).map((f) => f.path)
      if (collisions.length) {
        p.phase = 'collision-hold'
        p.collisions = [...new Set(collisions)].sort()
        this.write(p)
        return { phase: p.phase, collisions: p.collisions }
      }
      // Installation and ledger are durable before received writes. Interrupted pull reopens them.
      this.storage.saveLocalStorage(SCOPED_CONNECTION_KEY, copy(connection))
      if (
        JSON.stringify(this.storage.loadLocalStorage(SCOPED_CONNECTION_KEY)) !==
        JSON.stringify(connection)
      )
        throw new Error('Scoped connection was not persisted')
      await this.port.pullOnly(copy(connection), { publishLocal: false, holdLocalCollisions: true })
      this.fence(generation)
      p.phase = 'joined'
      delete p.collisions
      this.write(p)
      this.secrets.set(p.invitationId, '')
      return { phase: p.phase }
    } finally {
      this.busy = false
    }
  }
  close() {
    this.generation++
  }
}
