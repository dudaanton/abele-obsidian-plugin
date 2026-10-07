// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryStateStore, SyncClient, sha256 } from '@abele/sync-core'
import { scopedApiServer } from '../helpers/scopedApiServer'
import { OwnerFolderHttpPort, type OwnerSharedGrant } from '@/sync/sharing/ownerHttp'
import { FolderSharingFlow } from '@/sync/sharing/folderSharing'
import { SponsoredAssetsHttpPort } from '@/sync/sharing/sponsoredHttp'
import { PluginSharing } from '@/sync/pluginSharing'
import { PublicationPrompt } from '@/sync/publicationPrompt'
import { emptyConnection } from '@/sync/connection'
import { AbeleConfig } from '@/services/AbeleConfig'
import { bindDeviceToken } from '@/secrets/deviceSecret'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { useVault } from '../helpers/testEnv'
import { IDBFactory } from 'fake-indexeddb'
import { shallowRef } from 'vue'

const versions = [
  {
    name: 'pinned API',
    variable: 'ABELE_SCOPED_API_FIXTURE',
    commit: '80bc7c666ac54cc186696ebdaaccd2d9e7a735ba',
  },
  {
    name: 'released API',
    variable: 'ABELE_OWNER_RELEASE_FIXTURE',
    commit: '019830418a035ba213d737048ba2499c8453da6e',
  },
]
describe.each(versions)('owner sharing against the $name', ({ variable, commit }) => {
  let server: Awaited<ReturnType<typeof scopedApiServer>>
  let client: ReturnType<SyncClient['forVault']>
  let port: OwnerFolderHttpPort
  let vaultId: string, deviceToken: string, accountToken: string, deviceId: string
  beforeEach(async () => {
    const root = process.env[variable]
    if (!root) throw new Error('Explicit owner contract archive required')
    server = await scopedApiServer({ root, commit, group: true, assets: true })
    const owner = await server.account('contract-owner@example.com')
    accountToken = owner.accountToken
    ;({ vaultId } = await server.vault(owner.accountToken, 'Sample contract vault'))
    ;({ deviceToken, deviceId } = await server.device(
      owner.accountToken,
      vaultId,
      'Sample contract device'
    ))
    client = new SyncClient({
      baseUrl: 'http://127.0.0.1',
      fetch: server.fetch,
      token: deviceToken,
    }).forVault(vaultId)
    port = new OwnerFolderHttpPort({
      baseUrl: 'http://127.0.0.1',
      vaultId,
      deviceToken: () => deviceToken,
      fetch: server.fetch,
      email: 'contract-owner@example.com',
    })
  })
  afterEach(async () => {
    port?.close()
    await server?.close()
  })
  async function seed(path: string, text = 'Sample note') {
    const bytes = new TextEncoder().encode(text),
      sha = await sha256(bytes)
    await client.putBlob(sha, bytes)
    const reply = await client.commit(
      [{ op: 'create', path, sha, size: bytes.length, mtime: 1 }],
      crypto.randomUUID()
    )
    return reply.results[0] as { file_id: string; version_id: string }
  }
  async function group() {
    const note = await seed('Notes/sample-root.md')
    const session = await port.authorize('pw')
    const grant = await port.createGroup(session, {
      label: 'Sample group',
      rootId: note.file_id,
      rootVersion: note.version_id,
      role: 'editor',
    })
    const ready = await port.prepareGroup(session, grant)
    expect(ready.state).toBe('active')
    return {
      session,
      grant: ready,
      hint: {
        id: ready.id,
        label: 'Sample group',
        rootId: ready.rootId,
        role: ready.role,
        revision: ready.revision,
        state: ready.state,
      },
    }
  }
  it('the folder-only list preserves client-remembered groups without inventing a group-list route', async () => {
    const { session, grant, hint } = await group()
    const folder = await port.create(session, {
      label: 'Sample folder',
      prefix: 'Shared/',
      role: 'reader',
    })
    const raw = await (
      await server.fetch(`http://127.0.0.1/v1/vaults/${vaultId}/grants`, {
        headers: { authorization: 'Bearer ' + accountToken },
      })
    ).json()
    expect(raw.map((row: any) => row.selector_kind)).toEqual(['folder'])
    const rows = await port.list(session, [hint])
    expect(rows.map((row) => row.id).sort()).toEqual([folder.id, grant.id].sort())
    expect(rows.find((row) => row.id === grant.id)).toMatchObject({
      kind: 'group',
      label: 'Sample group',
    })
  })
  it.each(['folder', 'group'] as const)(
    'acknowledges the real %s revoke timestamp and revision',
    async (kind) => {
      const { session, grant, hint } = await group()
      let share: OwnerSharedGrant
      if (kind === 'folder') {
        const folder = await port.create(session, {
          label: 'Sample folder',
          prefix: 'Shared/',
          role: 'editor',
        })
        share = (await port.list(session)).find((row) => row.id === folder.id)!
      } else share = { ...hint, kind: 'group', prefix: null }
      await port.revoke(session, share)
      const row = await server.db
        .selectFrom('scope_grants')
        .selectAll()
        .where('id', '=', share.id)
        .executeTakeFirstOrThrow()
      expect(row.state).toBe('unavailable')
      expect(row.revoked_at).toEqual(expect.any(String))
      expect(Number.isFinite(Date.parse(row.revoked_at!))).toBe(true)
      expect(row.acl_revision).toBe(share.revision + 1)
      await expect(port.revoke(session, share)).rejects.toMatchObject({ code: 'conflict' })
    }
  )
  it('checks remembered names but never substitutes publication revisions for a changed group ACL', async () => {
    const { session, grant, hint } = await group()
    await port.updateGroup(session, grant, {
      expected_revision: grant.revision,
      label: 'Changed sample group',
    })
    const [review] = await port.list(session, [hint])
    expect(review.label).toBe('Changed sample group')
    expect(review.revision).toBe(hint.revision) // No registered route returns the current group ACL.
    await expect(port.revoke(session, review)).rejects.toMatchObject({ code: 'conflict' })
    const row = await server.db
      .selectFrom('scope_grants')
      .selectAll()
      .where('id', '=', grant.id)
      .executeTakeFirstOrThrow()
    expect(row.revoked_at).toBeNull()
    expect(row.acl_revision).toBe(grant.revision + 1)
    const absent = await server.fetch(`http://127.0.0.1/v1/vaults/${vaultId}/grants/groups`, {
      headers: { authorization: 'Bearer ' + accountToken },
    })
    expect(absent.status).toBe(404)
  })
  it('keeps acknowledged group reviews across owner restarts and the real folder-only list', async () => {
    const note = await seed('Notes/remembered-root.md')
    const app = useVault([]),
      config = AbeleConfig.getInstance(),
      old = config.sync,
      oldAi = config.ai
    config.sync = { keySignature: null, sharing: [] }
    config.ai = { scriptsFolder: 'Scripts' } as never
    const save = vi.spyOn(config, 'saveSettings').mockResolvedValue()
    const oldDocument = globalThis.document
    if (typeof document === 'undefined')
      vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} })
    setSecrets(null)
    const c = {
      ...emptyConnection(),
      serverUrl: 'http://127.0.0.1',
      vaultId,
      deviceId,
      deviceTokenId: 'abele-sync-device-contract',
    }
    bindDeviceToken(secrets().device, c.deviceTokenId, deviceToken, c.serverUrl)
    app.saveLocalStorage('abele-sync-ledger', { stateId: 'sample-contract-ledger', vaultId })
    const sync = {
      connection: shallowRef(c),
      publicationPrompt: new PublicationPrompt(() => false),
      refreshSharing: vi.fn(async () => {}),
      scopedStatus: vi.fn(),
    }
    const host = new PluginSharing(app as any, sync as any, {
      indexedDB: new IDBFactory(),
      fetch: server.fetch,
    })
    sync.refreshSharing.mockImplementation(async () => host.refreshPublication())
    const context = {
      app: app as any,
      state: new MemoryStateStore(),
      client,
      connection: c,
      token: deviceToken,
      fetch: server.fetch,
      held: () => true,
    }
    let owner: Awaited<ReturnType<typeof host.ownerPublication>> | undefined
    try {
      owner = await host.ownerPublication(context)
      let management = host.ownerManagement(),
        session = await management.authorize('pw', 'contract-owner@example.com')
      const grant = await management.createGroup(session, {
        label: 'Remembered sample group',
        rootId: note.file_id,
        rootVersion: note.version_id,
        role: 'editor',
      })
      expect(grant.state).toBe('active')
      expect(host.audiences.value).toContain(grant.id)
      let rows = await management.list(session)
      expect(rows.map((row) => row.id)).toContain(grant.id)
      expect(host.audiences.value).toContain(grant.id)
      expect(config.sync.sharing[0].grants).toContain(grant.id)
      owner.close()
      owner = await host.ownerPublication(context)
      management = host.ownerManagement()
      session = await management.authorize('pw', 'contract-owner@example.com')
      rows = await management.list(session)
      const remembered = rows.find((row) => row.id === grant.id)!
      expect(remembered).toMatchObject({
        label: 'Remembered sample group',
        kind: 'group',
        remembered: true,
        verified: true,
      })
      await management.revoke(session, remembered)
      expect(host.audiences.value).not.toContain(grant.id)
      expect(config.sync.sharing[0].grants).not.toContain(grant.id)
      expect(config.sync.sharing[0].groups).toEqual([])
    } finally {
      owner?.close()
      await host.close()
      config.sync = old
      config.ai = oldAi
      save.mockRestore()
      if (oldDocument === undefined) vi.unstubAllGlobals()
    }
  })
  it('uses actual preparation, scoped-key issuance and key listing after a stable manifest review', async () => {
    await seed('Shared/sample-note.md')
    const flow = new FolderSharingFlow(vaultId, port)
    const shown = await flow.review('Shared/', 'editor', 'Sample folder')
    const code = await flow.confirm('pw', undefined, shown)
    expect(code.token).toMatch(/^absk_[A-Za-z0-9_-]{43}$/)
    expect(
      await server.db
        .selectFrom('scope_keys')
        .select('id')
        .where('grant_id', '=', code.grantId)
        .execute()
    ).toHaveLength(1)
    flow.clear()
  })
  it('reports server-decided eligibility for executable and inherited restrictions in an ordinary manifest', async () => {
    const note = await seed('Shared/sample-note.md')
    const executable = await seed('Shared/sample-tool.exe', 'Sample binary')
    const renamed = await seed('Original/sample-tool.exe', 'Other sample binary')
    await client.commit(
      [
        {
          op: 'move',
          file_id: renamed.file_id,
          base_version_id: renamed.version_id,
          to_path: 'Shared/renamed-image.png',
        },
      ],
      crypto.randomUUID()
    )
    const preview = await port.preview('Shared/')
    expect(preview.files).toHaveLength(3)
    expect(preview.files.every((file) => !file.eligible && file.eligibility === 'unknown')).toBe(
      true
    )
    const flow = new FolderSharingFlow(vaultId, port)
    const shown = await flow.review('Shared/', 'reader', 'Sample policy folder')
    const code = await flow.confirm('pw', undefined, shown)
    const assets = new SponsoredAssetsHttpPort({
      baseUrl: 'http://127.0.0.1',
      fetch: server.fetch,
      context: {
        facet: 'personal',
        vaultId,
        principalId: 'unused-by-read',
        token: () => deviceToken,
      },
    })
    expect((await assets.visibility(code.grantId, note.file_id)).visible).toBe(true)
    expect((await assets.visibility(code.grantId, executable.file_id)).visible).toBe(false)
    expect((await assets.visibility(code.grantId, renamed.file_id)).visible).toBe(false)
    const manifest = await client.manifest()
    expect(manifest.items.find((file) => file.file_id === executable.file_id)?.kind).toBe(
      'attachment'
    )
    expect(manifest.items.find((file) => file.file_id === renamed.file_id)?.kind).toBe('attachment')
    flow.clear()
  })
  it('prepares a real group and issues an invitation without confusing publication and ACL revisions', async () => {
    const { session, grant } = await group()
    expect(await port.invitation(session, grant, 'reader')).toMatch(/^absinv_[A-Za-z0-9_-]{43}$/)
    const updated = await port.updateGroup(session, grant, {
      expected_revision: grant.revision,
      label: 'Renamed sample group',
    })
    expect(updated.revision).toBe(grant.revision + 1)
  })
})
