import {
  CreateFolderGrantRequestSchema,
  IssueFolderKeyRequestSchema,
  LoginResponseSchema,
  ManifestResponseSchema,
  VaultStateSchema,
} from '@abele/sync-protocol'
import { sha256 } from '@abele/sync-core'
import { SharingHttp, type SharingHttpOptions } from './sharingHttp'
import type {
  FolderSharingPort,
  FolderPreview,
  OwnerSession,
  FolderGrant,
  MachineCredential,
} from './folderSharing'
export interface OwnerHttpOptions extends SharingHttpOptions {
  vaultId: string
  email?: string
  deviceToken: () => string | null
  now?: () => number
  configurationRoots?: string[]
}
const segment = (id: string) => encodeURIComponent(id)
/** Concrete registered personal-preview and owner-management HTTP APIs, with disjoint credentials. */
export class OwnerFolderHttpPort implements FolderSharingPort {
  private readonly http: SharingHttp
  private sessions = new WeakMap<OwnerSession, string>()
  constructor(private readonly options: OwnerHttpOptions) {
    this.http = new SharingHttp(options)
  }
  private now() {
    return (this.options.now ?? (() => Date.now()))()
  }
  private ownerToken(session: OwnerSession): string {
    this.http.fence()
    const token = this.sessions.get(session)
    if (
      !token ||
      session.facet !== 'account' ||
      session.ownerVaultId !== this.options.vaultId ||
      session.expiresAt <= this.now() ||
      this.now() - session.authenticatedAt >= 300000
    )
      throw new Error('Bound fresh owner session is required')
    return token
  }
  async preview(prefix: string): Promise<FolderPreview> {
    this.http.fence()
    const scope = CreateFolderGrantRequestSchema.parse({
      prefix,
      label: 'Folder preview',
      role: 'reader',
    }).prefix
    const token = this.options.deviceToken()
    if (!token || !/^absd_[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error('Bound personal preview credential is required')
    const base = '/v1/vaults/' + segment(this.options.vaultId)
    const before = VaultStateSchema.parse(await this.http.json('GET', base + '/state', token))
    const files: FolderPreview['files'] = [],
      cursors = new Set<string>()
    let cursor: string | null = null,
      total = 0
    do {
      const page = ManifestResponseSchema.parse(
        await this.http.json(
          'GET',
          base + '/manifest?limit=1000' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
          token
        )
      )
      total += page.items.length
      if (total > 100000) throw new Error('Folder preview inventory is incomplete')
      for (const item of page.items)
        if (item.path.startsWith(scope))
          files.push({
            path: item.path,
            fileId: item.file_id,
            versionId: item.version_id,
            eligible: false,
            eligibility:
              ['script', 'settings'].includes(item.kind) ||
              (this.options.configurationRoots ?? []).some(
                (root) => item.path === root || item.path.startsWith(root + '/')
              )
                ? 'excluded'
                : 'unknown',
          })
      cursor = page.next ?? null
      if (cursor) {
        if (cursors.has(cursor)) throw new Error('Folder preview cursor did not progress')
        cursors.add(cursor)
      }
    } while (cursor)
    const after = VaultStateSchema.parse(await this.http.json('GET', base + '/state', token))
    if (before.head_seq !== after.head_seq)
      throw new Error('Folder preview changed during collection')
    const generation =
      String(after.head_seq) + ':' + (await sha256(new TextEncoder().encode(JSON.stringify(files))))
    return { prefix: scope, generation, complete: true, files }
  }
  async authorize(password: string, email?: string): Promise<OwnerSession> {
    this.http.fence()
    const identity = email ?? this.options.email
    if (!identity || !password) throw new Error('Owner email and current password are required')
    const started = this.now()
    const login = LoginResponseSchema.parse(
      await this.http.json('POST', '/v1/auth/login', null, { email: identity, password })
    )
    if (!/^abst_[A-Za-z0-9_-]{43}$/.test(login.account_token))
      throw new Error('Owner login returned a wrong credential facet')
    const expiresAt = Date.parse(login.expires_at)
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now())
      throw new Error('Owner session expiry invalid')
    // This real service call proves owner/fresh-password authority. Do not assert owner from JWT shape.
    await this.http.json(
      'GET',
      '/v1/vaults/' + segment(this.options.vaultId) + '/grants',
      login.account_token
    )
    const session: OwnerSession = {
      facet: 'account',
      ownerVaultId: this.options.vaultId,
      authenticatedAt: started,
      expiresAt,
    }
    this.sessions.set(session, login.account_token)
    return session
  }
  async create(
    session: OwnerSession,
    request: { label: string; prefix: string; role: 'reader' | 'editor' }
  ): Promise<FolderGrant> {
    const token = this.ownerToken(session),
      body = CreateFolderGrantRequestSchema.parse(request)
    const value = (await this.http.json(
      'POST',
      '/v1/vaults/' + segment(this.options.vaultId) + '/grants',
      token,
      body
    )) as Record<string, unknown>
    if (
      typeof value.id !== 'string' ||
      value.vault_id !== this.options.vaultId ||
      value.selector_kind !== 'folder' ||
      value.folder_prefix !== body.prefix ||
      value.role !== body.role ||
      typeof value.acl_revision !== 'number' ||
      value.acl_revision < 0
    )
      throw new Error('Owner grant response differs from reviewed scope')
    return { id: value.id, prefix: body.prefix, role: body.role, revision: value.acl_revision }
  }
  async issue(
    session: OwnerSession,
    grant: FolderGrant,
    request: { attempt_id: string; name: string; role: 'reader' | 'editor'; expires_at: string }
  ): Promise<MachineCredential> {
    const token = this.ownerToken(session),
      body = IssueFolderKeyRequestSchema.parse(request)
    if (body.role !== grant.role) throw new Error('Key role differs from grant ceiling')
    const path =
      '/v1/vaults/' + segment(this.options.vaultId) + '/grants/' + segment(grant.id) + '/keys'
    const value = (await this.http.json('POST', path, token, body)) as Record<string, unknown>
    if (
      typeof value.key_id !== 'string' ||
      typeof value.key_token !== 'string' ||
      !/^absk_[A-Za-z0-9_-]{43}$/.test(value.key_token)
    )
      throw new Error('Only a scoped machine key may be returned')
    const keys = (await this.http.json('GET', path, token)) as {
      id: string
      grant_id: string
      role: string
    }[]
    if (
      !Array.isArray(keys) ||
      !keys.some((k) => k.id === value.key_id && k.grant_id === grant.id && k.role === body.role)
    )
      throw new Error('Machine key is not bound to reviewed grant')
    return { grantId: grant.id, facet: 'scoped', role: body.role, token: value.key_token }
  }
  close() {
    this.sessions = new WeakMap()
  }
}
