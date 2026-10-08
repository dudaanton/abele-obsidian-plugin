import {
  CreateFolderGrantRequestSchema,
  UpdateFolderGrantRequestSchema,
  IssueFolderKeyRequestSchema,
  LoginResponseSchema,
  ManifestResponseSchema,
  VaultStateSchema,
} from '@abele/sync-protocol'
import { sha256 } from '@abele/sync-core'
import { SharingHttp, type SharingHttpOptions } from './sharingHttp'
import { z } from 'zod'
import type { GroupShareHint } from './sharingCatalogue'
import { preparationOf } from './grantPreparation'
import type { GroupGrant, GroupRelation, GroupApprovalReceipt } from './groupSharing'
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
export interface OwnerSharedGrant {
  id: string
  label: string
  kind: 'folder' | 'group'
  prefix: string | null
  rootId: string | null
  role: 'reader' | 'editor'
  revision: number
  state: string
  /** Remembered group revisions remain CAS hints, not a complete server inventory. */
  verified?: boolean
  remembered?: boolean
  revokedAt?: string | null
  expiresAt?: string | null
}
const SharedGrantSchema = z
  .object({
    id: z.string().min(1),
    vault_id: z.string().min(1),
    label: z.string().min(1),
    selector_kind: z.enum(['folder', 'group']),
    folder_prefix: z.string().nullable().optional(),
    root_file_id: z.string().nullable().optional(),
    role: z.enum(['reader', 'editor']),
    acl_revision: z.number().int().nonnegative(),
    state: z.string().min(1),
    revoked_at: z.string().datetime({ offset: true }).nullable().optional(),
    expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .passthrough()
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
      for (const item of page.items) {
        if (!item.path.startsWith(scope)) continue
        // A personal manifest omits immutable security/provenance restrictions. It is
        // an inventory, not the server's scoped eligibility verdict, even for ordinary names.
        files.push({
          path: item.path,
          fileId: item.file_id,
          versionId: item.version_id,
          eligible: false,
          eligibility: 'unknown',
        })
      }
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
  async list(
    session: OwnerSession,
    _remembered: GroupShareHint[] = []
  ): Promise<OwnerSharedGrant[]> {
    const result: OwnerSharedGrant[] = []
    for (const kind of ['folder', 'group'] as const) {
      const rows = z
        .array(SharedGrantSchema)
        .max(64)
        .parse(
          await this.http.json(
            'GET',
            '/v1/vaults/' +
              segment(this.options.vaultId) +
              '/grants' +
              (kind === 'group' ? '/groups' : ''),
            this.ownerToken(session)
          )
        )
      if (
        rows.some(
          (row) =>
            row.vault_id !== this.options.vaultId ||
            row.selector_kind !== kind ||
            (kind === 'folder' ? !row.folder_prefix : !row.root_file_id)
        )
      )
        throw new Error('Sharing list differs from the bound vault and selector')
      result.push(
        ...rows.map<OwnerSharedGrant>((row) => ({
          id: row.id,
          label: row.label,
          kind,
          prefix: row.folder_prefix ?? null,
          rootId: row.root_file_id ?? null,
          role: row.role,
          revision: row.acl_revision,
          state: row.state,
          revokedAt: row.revoked_at ?? null,
          expiresAt: row.expires_at ?? null,
          verified: true,
          remembered: false,
        }))
      )
    }
    // A partial fetch, duplicate identity or unsupported group route is not an inventory.
    if (new Set(result.map((row) => row.id)).size !== result.length)
      throw new Error('Sharing inventory contains duplicate identities')
    return result
  }
  async revoke(session: OwnerSession, share: OwnerSharedGrant): Promise<void> {
    if (share.verified === false) throw new Error('Review this sharing before stopping it')
    const request = z
      .object({ expected_revision: z.number().int().nonnegative().safe(), revoke: z.literal(true) })
      .parse({ expected_revision: share.revision, revoke: true })
    const value = SharedGrantSchema.parse(
      await this.http.json(
        'PATCH',
        '/v1/vaults/' +
          segment(this.options.vaultId) +
          '/grants/' +
          (share.kind === 'group' ? 'groups/' : '') +
          segment(share.id),
        this.ownerToken(session),
        request
      )
    )
    if (
      value.id !== share.id ||
      value.vault_id !== this.options.vaultId ||
      value.selector_kind !== share.kind ||
      value.acl_revision !== share.revision + 1 ||
      value.state !== 'unavailable' ||
      !value.revoked_at ||
      (share.kind === 'folder' ? value.folder_prefix !== share.prefix : !value.root_file_id)
    )
      throw new Error('Sharing was not stopped with the reviewed identity and revision')
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
    return {
      id: value.id,
      prefix: body.prefix,
      role: body.role,
      revision: value.acl_revision,
      ...(typeof value.state === 'string' ? { state: value.state } : {}),
      preparation: preparationOf(value.preparation),
    }
  }
  async prepare(session: OwnerSession, grant: FolderGrant): Promise<FolderGrant> {
    const value = z
      .object({ state: z.enum(['active', 'preparing']), processed: z.number().int().nonnegative() })
      .parse(
        await this.http.json(
          'POST',
          '/v1/vaults/' +
            segment(this.options.vaultId) +
            '/grants/' +
            segment(grant.id) +
            '/prepare',
          this.ownerToken(session)
        )
      )
    return { ...grant, state: value.state, preparation: { ok: true, state: value.state } }
  }
  async updateFolder(
    session: OwnerSession,
    grant: FolderGrant,
    input: z.infer<typeof UpdateFolderGrantRequestSchema>
  ): Promise<FolderGrant> {
    const body = UpdateFolderGrantRequestSchema.parse(input)
    const value = (await this.http.json(
      'PATCH',
      '/v1/vaults/' + segment(this.options.vaultId) + '/grants/' + segment(grant.id),
      this.ownerToken(session),
      body
    )) as Record<string, unknown>
    const expectedPrefix = body.prefix ?? grant.prefix,
      expectedRole = body.role ?? grant.role
    if (
      value.id !== grant.id ||
      value.vault_id !== this.options.vaultId ||
      value.selector_kind !== 'folder' ||
      value.folder_prefix !== expectedPrefix ||
      value.role !== expectedRole ||
      !Number.isSafeInteger(value.acl_revision) ||
      Number(value.acl_revision) < body.expected_revision ||
      typeof value.state !== 'string'
    )
      throw new Error('Updated folder grant differs from its bound mutation')
    return {
      id: grant.id,
      prefix: expectedPrefix,
      role: expectedRole,
      revision: Number(value.acl_revision),
      state: value.state,
      preparation: preparationOf(value.preparation),
    }
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
  async createGroup(
    session: OwnerSession,
    input: { label: string; rootId: string; rootVersion: string; role: 'reader' | 'editor' }
  ): Promise<GroupGrant> {
    const token = this.ownerToken(session),
      id = z.string().min(1).max(200),
      body = z
        .object({
          label: id,
          root_file_id: id,
          expected_root_version: id,
          role: z.enum(['reader', 'editor']),
        })
        .strict()
        .parse({
          label: input.label,
          root_file_id: input.rootId,
          expected_root_version: input.rootVersion,
          role: input.role,
        })
    const r = (await this.http.json(
      'POST',
      '/v1/vaults/' + segment(this.options.vaultId) + '/grants/groups',
      token,
      body
    )) as Record<string, unknown>
    if (
      typeof r.id !== 'string' ||
      r.vault_id !== this.options.vaultId ||
      r.selector_kind !== 'group' ||
      r.root_file_id !== body.root_file_id ||
      r.role !== body.role ||
      !Number.isSafeInteger(r.acl_revision) ||
      Number(r.acl_revision) < 0 ||
      typeof r.state !== 'string'
    )
      throw new Error('Group grant response differs from reviewed root/role')
    return {
      id: r.id,
      rootId: body.root_file_id,
      rootVersion: body.expected_root_version,
      role: body.role,
      revision: Number(r.acl_revision),
      state: r.state,
      label: body.label,
      preparation: preparationOf(r.preparation),
    }
  }
  async prepareGroup(session: OwnerSession, grant: GroupGrant): Promise<GroupGrant> {
    const value = z
      .object({ ready: z.boolean() })
      .parse(
        await this.http.json(
          'POST',
          '/v1/vaults/' + segment(this.options.vaultId) + '/grants/groups/prepare',
          this.ownerToken(session)
        )
      )
    const state = value.ready ? 'active' : 'preparing'
    return { ...grant, state, preparation: { ok: true, state } }
  }
  async updateGroup(
    session: OwnerSession,
    grant: GroupGrant,
    input: {
      expected_revision: number
      label?: string
      role?: 'reader' | 'editor'
      expires_at?: string | null
      revoke?: boolean
    }
  ): Promise<GroupGrant> {
    const body = z
      .object({
        expected_revision: z.number().int().nonnegative(),
        label: z.string().min(1).max(200).optional(),
        role: z.enum(['reader', 'editor']).optional(),
        expires_at: z.string().datetime().nullable().optional(),
        revoke: z.boolean().optional(),
      })
      .strict()
      .parse(input)
    const value = (await this.http.json(
      'PATCH',
      '/v1/vaults/' + segment(this.options.vaultId) + '/grants/groups/' + segment(grant.id),
      this.ownerToken(session),
      body
    )) as Record<string, unknown>
    if (
      value.id !== grant.id ||
      value.vault_id !== this.options.vaultId ||
      value.selector_kind !== 'group' ||
      value.root_file_id !== grant.rootId ||
      value.role !== (body.role ?? grant.role) ||
      !Number.isSafeInteger(value.acl_revision) ||
      Number(value.acl_revision) < body.expected_revision ||
      typeof value.state !== 'string'
    )
      throw new Error('Updated group grant differs from its bound mutation')
    return {
      ...grant,
      role: body.role ?? grant.role,
      revision: Number(value.acl_revision),
      state: value.state,
      preparation: preparationOf(value.preparation),
    }
  }
  async approveGroup(
    session: OwnerSession,
    grant: GroupGrant,
    relation: GroupRelation
  ): Promise<GroupApprovalReceipt> {
    const token = this.ownerToken(session),
      device = this.options.deviceToken(),
      id = z.string().min(1).max(200)
    if (!device || !/^absd_[A-Za-z0-9_-]{43}$/.test(device))
      throw new Error('Actual owner-personal device proof required')
    const body = z
      .object({
        device_token: z.string(),
        expected_revision: z.number().int().nonnegative(),
        source_file_id: id,
        source_version_id: id,
        target_file_id: id,
        target_version_id: id,
        token_key: z.string().min(1).max(1024),
        anchor: z.boolean(),
      })
      .strict()
      .parse({
        device_token: device,
        expected_revision: grant.revision,
        source_file_id: relation.sourceId,
        source_version_id: relation.sourceVersion,
        target_file_id: relation.targetId,
        target_version_id: relation.targetVersion,
        token_key: relation.tokenKey,
        anchor: relation.anchor,
      })
    const receipt = z
      .object({ approval_id: id })
      .strict()
      .parse(
        await this.http.json(
          'POST',
          '/v1/vaults/' +
            segment(this.options.vaultId) +
            '/grants/groups/' +
            segment(grant.id) +
            '/approve',
          token,
          body
        )
      )
    // Reviewed approval transaction CAS-checks N then advances ACL exactly once to N+1.
    // Its strict successful approval_id acknowledges that transition, not a mutable read.
    return {
      approvalId: receipt.approval_id,
      grantId: grant.id,
      expectedRevision: body.expected_revision,
      revision: body.expected_revision + 1,
    }
  }
  async invitation(
    session: OwnerSession,
    grant: GroupGrant,
    role: 'reader' | 'editor'
  ): Promise<string> {
    const body = z
      .object({ role: z.enum(['reader', 'editor']), expires_at: z.string().datetime() })
      .strict()
      .parse({ role, expires_at: new Date(this.now() + 3600000).toISOString() })
    const response = z
      .object({ invitation_token: z.string().regex(/^absinv_[A-Za-z0-9_-]{43}$/) })
      .passthrough()
      .parse(
        await this.http.json(
          'POST',
          '/v1/vaults/' +
            segment(this.options.vaultId) +
            '/grants/groups/' +
            segment(grant.id) +
            '/invitations',
          this.ownerToken(session),
          body
        )
      )
    return response.invitation_token
  }
  close() {
    this.sessions = new WeakMap()
  }
}
