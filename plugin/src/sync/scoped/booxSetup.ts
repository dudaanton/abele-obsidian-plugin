import { normalizeServerUrl } from '@abele/sync-protocol'
import type { LocalStorage } from '../ledgerId'
import { SCOPED_CONNECTION_KEY, SCOPED_JOIN_KEY, type ScopedSecretPort } from './scopedJoin'
export const BOOX_BOOKS_ENABLED = false
export interface BooksInput {
  issuer: string
  vaultId: string
  grantId: string
  principalId: string
  token: string
  rootFileId: string
  rootVersionId: string
}
export interface BooksAuthority {
  issuer: string
  vaultId: string
  grantId: string
  principalId: string
  selector: string
  rootFileId: string
  rootVersionId: string
  role: string
  state: string
  transportVerified: boolean
}
export interface BooksDescriptor {
  version: 4
  facet: 'scoped'
  purpose: 'books-untrusted'
  issuer: string
  vaultId: string
  grantId: string
  principalId: string
  principalKind: 'key' | 'installation'
  rootFileId: string
  rootVersionId: string
  role: 'editor'
  tokenId: string
  ledgerId: string
  scriptPolicy: 'refuse'
}
export interface BooksStatus {
  status: 'ready' | 'preparing' | 'offline' | 'revoked' | 'unsupported-transport' | 'recovery'
  role: 'reader' | 'editor'
  known: number
  materialized: number
  omitted: number
}
export interface BooksSetupPort {
  localPaths(): Promise<string[]>
  negotiate(input: BooksInput): Promise<BooksAuthority>
  ledger(connection: BooksDescriptor, initialize: boolean): Promise<boolean>
  pullManifest(
    connection: BooksDescriptor
  ): Promise<{ known: number; materialized: number; omitted: number }>
  revoke(connection: BooksDescriptor): Promise<void>
}
export type BooksAction =
  | 'read-local'
  | 'read-network'
  | 'edit-note'
  | 'create-native'
  | 'edit-own-native'
  | 'edit-imported-asset'
  | 'publish-extra'
  | 'execute-script'
  | 'personal-setup'
  | 'change-groups'
export function booxPermission(role: 'reader' | 'editor', state: string, action: BooksAction) {
  if (action === 'read-local') return true
  if (state !== 'active') return false
  if (action === 'read-network') return true
  return role === 'editor' && ['edit-note', 'create-native', 'edit-own-native'].includes(action)
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
/** A cold dedicated Books group installation. Never account login, personal device or owner APIs. */
export class BooxBooksSetup {
  private generation = 0
  private busy = false
  constructor(
    private readonly storage: LocalStorage,
    private readonly secrets: ScopedSecretPort,
    private readonly port: BooksSetupPort,
    private readonly enabled: () => boolean = () => BOOX_BOOKS_ENABLED
  ) {}
  private fence(g?: number) {
    if (!this.enabled()) throw new Error('Books scoped setup is disabled')
    if (g !== undefined && g !== this.generation)
      throw new Error('Books setup closed or superseded')
  }
  private personal() {
    const c = this.storage.loadLocalStorage('abele-sync-connection') as {
      vaultId?: string
      deviceTokenId?: string
      pendingRevoke?: unknown[]
    } | null
    if (
      c?.vaultId ||
      c?.deviceTokenId ||
      c?.pendingRevoke?.length ||
      [
        'abele-sync-ledger',
        'abele-sync-ledger-proof',
        'abele-sync-ledger-bootstrap',
        'abele-sync-ledger-cleanup',
        'abele-script-provenance',
      ].some((k) => this.storage.loadLocalStorage(k) != null)
    )
      throw new Error('Existing personal/retained context left untouched')
  }
  private save(d: BooksDescriptor) {
    this.storage.saveLocalStorage(SCOPED_CONNECTION_KEY, copy(d))
    if (JSON.stringify(this.storage.loadLocalStorage(SCOPED_CONNECTION_KEY)) !== JSON.stringify(d))
      throw new Error('Books descriptor was not persisted; recovery required')
  }
  private read(): BooksDescriptor {
    const d = this.storage.loadLocalStorage(SCOPED_CONNECTION_KEY) as BooksDescriptor | null
    if (
      !d ||
      d.version !== 4 ||
      d.facet !== 'scoped' ||
      d.purpose !== 'books-untrusted' ||
      d.role !== 'editor' ||
      d.scriptPolicy !== 'refuse' ||
      !d.tokenId ||
      !d.ledgerId
    )
      throw new Error('Books descriptor missing/unreadable; recovery required')
    const token = this.secrets.get(d.tokenId)
    if (
      !/^(?:absk_|absi_)[A-Za-z0-9_-]{43}$/.test(token) ||
      this.secrets.get(d.tokenId + ':binding') !== JSON.stringify({ descriptor: d, token })
    )
      throw new Error('Books credential binding changed; recovery required')
    return copy(d)
  }
  private validate(i: BooksInput, a: BooksAuthority) {
    if (!a.transportVerified) throw new Error('Unverified native Books transport remains blocked')
    if (
      a.issuer !== i.issuer ||
      a.vaultId !== i.vaultId ||
      a.grantId !== i.grantId ||
      a.principalId !== i.principalId ||
      a.selector !== 'group' ||
      a.rootFileId !== i.rootFileId ||
      a.rootVersionId !== i.rootVersionId
    )
      throw new Error('Books group/root/issuer binding differs')
    if (a.role !== 'editor')
      throw new Error(
        'Books requires current editor ceiling; request owner renewal, never upgrade locally'
      )
    if (!['active', 'preparing'].includes(a.state))
      throw new Error('Books scoped authority is revoked/unavailable')
  }
  async setup(input: BooksInput): Promise<BooksStatus> {
    this.fence()
    if (this.busy) throw new Error('Books setup is already running')
    this.busy = true
    const generation = this.generation
    try {
      this.personal()
      if (
        this.storage.loadLocalStorage(SCOPED_CONNECTION_KEY) != null ||
        this.storage.loadLocalStorage(SCOPED_JOIN_KEY) != null
      )
        throw new Error('Existing scoped context requires resume/recovery')
      const i = copy(input),
        issuer = normalizeServerUrl(i.issuer)
      if (
        !issuer ||
        !i.vaultId ||
        !i.grantId ||
        !i.principalId ||
        !i.rootFileId ||
        !i.rootVersionId ||
        !/^(?:absk_|absi_)[A-Za-z0-9_-]{43}$/.test(i.token)
      )
        throw new Error('Only an exact scoped Books secret is allowed')
      i.issuer = issuer
      if ((await this.port.localPaths()).length)
        throw new Error('Books setup requires an empty dedicated local vault')
      this.fence(generation)
      const authority = await this.port.negotiate(copy(i))
      this.fence(generation)
      this.validate(i, authority)
      // Negotiation awaited: cold ownership may have changed in another window/flow.
      this.personal()
      if (
        this.storage.loadLocalStorage(SCOPED_CONNECTION_KEY) != null ||
        this.storage.loadLocalStorage(SCOPED_JOIN_KEY) != null
      )
        throw new Error('Scoped ownership changed during Books negotiation')
      if ((await this.port.localPaths()).length)
        throw new Error('Books local vault is no longer empty')
      this.fence(generation)
      // The final local inventory also awaited: another setup/personal flow may have
      // claimed this physical vault. Check cold ownership with no await before claim.
      this.personal()
      if (
        this.storage.loadLocalStorage(SCOPED_CONNECTION_KEY) != null ||
        this.storage.loadLocalStorage(SCOPED_JOIN_KEY) != null
      )
        throw new Error('Books ownership changed during final local check')
      const d: BooksDescriptor = {
        version: 4,
        facet: 'scoped',
        purpose: 'books-untrusted',
        issuer: i.issuer,
        vaultId: i.vaultId,
        grantId: i.grantId,
        principalId: i.principalId,
        principalKind: i.token.startsWith('absk_') ? 'key' : 'installation',
        rootFileId: i.rootFileId,
        rootVersionId: i.rootVersionId,
        role: 'editor',
        tokenId: 'abele-books-scoped-' + crypto.randomUUID(),
        ledgerId: crypto.randomUUID(),
        scriptPolicy: 'refuse',
      }
      this.secrets.set(d.tokenId, i.token)
      this.secrets.set(d.tokenId + ':binding', JSON.stringify({ descriptor: d, token: i.token }))
      if (
        this.secrets.get(d.tokenId) !== i.token ||
        this.secrets.get(d.tokenId + ':binding') !==
          JSON.stringify({ descriptor: d, token: i.token })
      )
        throw new Error('Books keychain binding was not kept')
      // Durable ownership precedes allocation: a crash cannot silently make a personal vault.
      this.save(d)
      if (!(await this.port.ledger(copy(d), true)))
        throw new Error('Books ledger allocation requires recovery')
      this.fence(generation)
      if (authority.state === 'preparing')
        return { status: 'preparing', role: 'editor', known: 0, materialized: 0, omitted: 0 }
      return await this.pull(d, generation)
    } finally {
      this.busy = false
    }
  }
  private async pull(d: BooksDescriptor, generation: number): Promise<BooksStatus> {
    if (!(await this.port.ledger(copy(d), false)))
      throw new Error('Books ledger missing; recovery required')
    this.fence(generation)
    const counts = await this.port.pullManifest(copy(d))
    this.fence(generation)
    if (
      Object.values(counts).some((n) => !Number.isSafeInteger(n) || n < 0) ||
      counts.materialized + counts.omitted !== counts.known
    )
      throw new Error('Books manifest counts uncertain; not deletions')
    return { status: 'ready', role: 'editor', ...counts }
  }
  async resume(): Promise<BooksStatus> {
    this.fence()
    this.personal()
    const generation = this.generation,
      d = this.read()
    if (!(await this.port.ledger(copy(d), false)))
      throw new Error('Books ledger missing; recovery required')
    this.fence(generation)
    const a = await this.port.negotiate({
      issuer: d.issuer,
      vaultId: d.vaultId,
      grantId: d.grantId,
      principalId: d.principalId,
      token: this.secrets.get(d.tokenId),
      rootFileId: d.rootFileId,
      rootVersionId: d.rootVersionId,
    })
    this.fence(generation)
    this.validate({ ...d, token: this.secrets.get(d.tokenId) }, a)
    if (a.state === 'preparing')
      return { status: 'preparing', role: 'editor', known: 0, materialized: 0, omitted: 0 }
    return this.pull(d, generation)
  }
  close() {
    this.generation++
  }
}
