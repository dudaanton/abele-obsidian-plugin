import { describe, expect, it, vi } from 'vitest'
import { ConnectionSets, SETS_KEY, type SetItem } from '@/sync/connectionSets'
import { ItemSetEngines } from '@/sync/itemSetEngines'
import { removeDetachedCopies } from '@/sync/removeDetachedCopies'
import { MemoryFileSystem, MemoryStateStore } from '@abele/sync-sdk/core'
import { sha256 } from '@/sync/external/hash'
import { TokenConnectionRegistry, TOKEN_REGISTRY_KEY } from '@/sync/tokenConnectionRegistry'
import { TokenUi } from '@/sync/tokenUi'
import { encodeAccessToken, decodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { reviewSourceSchema } from '@/sync/reviewState'
import { RetainedShareCopies } from '@/sync/retainedShareCopies'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { computed } from 'vue'
import { retainedCopyCovered } from '@/sync/retainedCopyCoverage'

const folder = (id: string, path: string): SetItem => ({ id, kind: 'folder', scopeId: id, path })
function setup() {
  const data = new Map<string, unknown>([['abele-sync-connections-v2', 'legacy registry']])
  const storage = {
    loadLocalStorage: (key: string) => data.get(key),
    saveLocalStorage: (key: string, value: unknown) => {
      data.set(key, value)
    },
  }
  return { data, storage, sets: new ConnectionSets(storage) }
}

describe('connection item sets', () => {
  it('reconciles a pause persisted before its runtime registry write failed', async () => {
    const { storage, data } = setup()
    data.delete(TOKEN_REGISTRY_KEY)
    const registry = TokenConnectionRegistry.open(storage),
      id = registry.add()
    const keys = { get: () => null, set: () => {}, remove: () => {} }
    const transport = async () => {
      throw new Error('No network')
    }
    const ui = new TokenUi(registry, keys, transport)
    ui.itemSets.store.create(id, 'Sample share', [folder('folder-a', 'Sample')], { 'folder-a': id })
    const pause = vi.spyOn(registry, 'setPaused').mockImplementation(() => {
      throw new Error('interrupted registry')
    })
    await expect(ui.itemSets.pauseItem(id, 'folder-a', true)).rejects.toThrow(
      'interrupted registry'
    )
    pause.mockRestore()
    expect(registry.records()[0].paused).toBe(false)
    const restarted = new TokenUi(TokenConnectionRegistry.open(storage), keys, transport)
    expect(restarted.registry.records()[0].paused).toBe(true)
    expect(restarted.itemSets.store.get(id)?.items[0].paused).toBe(true)
  })
  it('refreshes a detached preview after a later local edit instead of reusing detachment counts', async () => {
    const { storage, data } = setup()
    data.delete(TOKEN_REGISTRY_KEY)
    const registry = TokenConnectionRegistry.open(storage),
      id = registry.add()
    const ui = new TokenUi(
      registry,
      { get: () => null, set: () => {}, remove: () => {} },
      async () => {
        throw new Error('No network')
      }
    )
    ui.itemSets.store.create(id, 'Sample share', [folder('folder-a', 'Sample')], { 'folder-a': id })
    ui.itemSets.store.reconcile(id, [])
    let edited = 0
    ui.itemSets.copyCounts = vi.fn(async () => ({ files: 2, edited, kept: 0 }))
    ui.itemSets.removeLocal = async () => {}
    await ui.itemSets.removeCopy(id, 'folder-a')
    expect(ui.itemSets.items(id)?.[0].edited).toBe(0)
    edited = 1
    expect(await ui.itemSets.previewCopy(id, 'folder-a')).toMatchObject({ files: 2, edited: 1 })
    expect(ui.itemSets.copyCounts).toHaveBeenCalledTimes(2)
  })
  it('keeps a detached copy when another persisted group cannot open after restart', () => {
    const records = [
      { id: 'detached', scope: { kind: 'group' as const, path: 'Groups/Old.md' } },
      { id: 'offline', scope: { kind: 'group' as const, path: 'Groups/Other.md' } },
    ]
    expect(retainedCopyCovered(records, new Map(), 'detached', 'Notes/Shared.md')).toBe(true)
    expect(
      retainedCopyCovered(
        records,
        new Map([['offline', { covers: () => false, coverageAvailable: false }]]),
        'detached',
        'Notes/Shared.md'
      )
    ).toBe(true)
    expect(
      retainedCopyCovered(
        records,
        new Map([['offline', { covers: () => false }]]),
        'detached',
        'Notes/Shared.md'
      )
    ).toBe(false)
  })
  it('updates an already mounted choice consumer after the server inventory arrives', async () => {
    const { storage, data } = setup()
    data.delete(TOKEN_REGISTRY_KEY)
    const registry = TokenConnectionRegistry.open(storage)
    const ui = new TokenUi(
      registry,
      { get: () => null, set: () => {}, remove: () => {} },
      async () => {
        throw new Error('Use the inventory port')
      }
    )
    vi.spyOn(ui, 'choices').mockResolvedValue([
      { kind: 'folder', id: 'flowers', path: 'Garden/Flowers' },
    ])
    vi.spyOn(ui.itemSets, 'client').mockReturnValue({
      tokens: async () => ({ items: [] }),
    } as unknown as ReturnType<TokenUi['client']>)
    const choices = computed(() => ui.itemSets.choices('sample'))
    expect(choices.value).toEqual([])
    await ui.itemSets.shares('sample')
    expect(choices.value).toEqual([{ kind: 'folder', id: 'flowers', path: 'Garden/Flowers' }])
  })
  it('deduplicates source paths within a sharing kind while keeping group and file scopes distinct', async () => {
    const { storage, data } = setup()
    data.delete(TOKEN_REGISTRY_KEY)
    const ui = new TokenUi(
      TokenConnectionRegistry.open(storage),
      { get: () => null, set: () => {}, remove: () => {} },
      async () => {
        throw new Error('Use the inventory port')
      }
    )
    vi.spyOn(ui, 'choices').mockResolvedValue([
      { kind: 'folder', id: 'folder-a', path: 'Garden' },
      { kind: 'folder', id: 'folder-b', path: 'Garden' },
      { kind: 'file', id: 'note-a', path: 'Garden/Flowers.md' },
      { kind: 'file', id: 'note-b', path: 'Garden/Flowers.md' },
      { kind: 'group', id: 'note-a', path: 'Garden/Flowers.md' },
    ])
    vi.spyOn(ui.itemSets, 'client').mockReturnValue({
      tokens: async () => ({ items: [] }),
    } as unknown as ReturnType<TokenUi['client']>)
    await ui.itemSets.shares('sample')
    expect(ui.itemSets.choices('sample')).toEqual([
      { kind: 'folder', id: 'folder-a', path: 'Garden' },
      { kind: 'file', id: 'note-a', path: 'Garden/Flowers.md' },
      { kind: 'group', id: 'note-a', path: 'Garden/Flowers.md' },
    ])
  })
  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])(
    'resumes the issuer with durable kept paths after deletion (whole=%s, uncertain=%s)',
    async (whole, uncertain) => {
      const { storage, data } = setup()
      data.delete(TOKEN_REGISTRY_KEY)
      const registry = TokenConnectionRegistry.open(storage),
        key = 'a'.repeat(43)
      const secrets = { get: () => key, set: () => {}, remove: () => {} }
      const scope = { kind: 'folder' as const, id: 'root-a', path: '/' },
        id = registry.add()
      registry.attach(
        id,
        { v: 1, address: 'https://sync.example', key, scope },
        { protocol: 2, token_id: 'owner-a', space_id: 'space-a', scope, status: 'active' },
        secrets
      )
      const ui = new TokenUi(registry, secrets, async () => {
        throw new Error('Use the item port')
      })
      const item = {
        id: 'item-a',
        scope_id: 'scope-a',
        scope: { kind: 'file', id: 'file-a', path: 'Sample.md' },
        removed_at: null,
      }
      const stopped = vi.fn(async () => {})
      ui.stopRuntime = stopped
      ui.disconnectRuntime = vi.fn(async () => {})
      ui.connectionsChanged = vi.fn(async () => {})
      let deleted = false
      const remove = vi.fn(async () => {
        deleted = true
        expect(
          registry.storage(id).loadLocalStorage('abele-sync-token-state:local-only-pending')
        ).toEqual(['Sample.md'])
        expect(stopped).toHaveBeenCalledWith(id)
        if (uncertain && remove.mock.calls.length === 1) throw new Error('Response lost')
      })
      vi.spyOn(ui.itemSets, 'client').mockReturnValue({
        tokens: async () => ({
          items: [
            {
              id: 'share-a',
              scope: item.scope,
              label: 'Sample share',
              read_only: false,
              created_at: '2025-01-01T00:00:00Z',
              revoked_at: null,
            },
          ],
        }),
        ownedItems: async () => ({ items: [item] }),
        revoke: async () => {},
        manifest: async () => ({
          items: deleted ? [] : [{ kind: 'note', file_id: 'file-a', path: 'Sample.md', size: 10 }],
          next: null,
        }),
        connection: async () => ({ read_only: false }),
        previewToken: async () => ({
          items: [{ ...item, status: 'active', file_count: 1, total_bytes: 10, files: [] }],
        }),
        previewTokenItem: async () => ({
          ...item,
          status: 'active',
          file_count: 1,
          total_bytes: 10,
          files: [],
        }),
        itemClient: () => ({ deleteItem: remove }),
      } as unknown as ReturnType<TokenUi['client']>)
      vi.spyOn(ui, 'client').mockImplementation(() => ui.itemSets.client(id))
      await ui.itemSets.shares(id)
      const mountedPreview = computed(() => ui.itemSets.deleteFacts('share-a', 'item-a'))
      expect(mountedPreview.value).toBe(null)
      await vi.waitFor(() => expect(ui.itemSets.deleteFacts('share-a', 'item-a')?.files).toBe(1))
      expect(mountedPreview.value?.files).toBe(1)
      const facts = ui.itemSets.deleteFacts('share-a', 'item-a')
      if (whole) {
        ui.itemSets.deleteFacts('share-a', null)
        await vi.waitFor(() => expect(ui.itemSets.deleteFacts('share-a', null)).not.toBe(null))
      }
      if (uncertain) {
        await expect(ui.itemSets.deleteFromServer('share-a', 'item-a')).rejects.toThrow(
          'Response lost'
        )
        const reopened = TokenConnectionRegistry.open(storage).storage(id)
        expect(reopened.loadLocalStorage('abele-sync-token-state:server-delete')).toBe(null)
        expect(reopened.loadLocalStorage('abele-sync-token-state:local-only-pending')).toEqual([
          'Sample.md',
        ])
        expect(ui.connectionsChanged).toHaveBeenCalled()
      }
      await ui.itemSets.deleteFromServer('share-a', whole ? null : 'item-a')
      expect(remove).toHaveBeenCalledTimes(uncertain ? 2 : 1)
      expect(registry.storage(id).loadLocalStorage('abele-sync-token-state:server-delete')).toBe(
        null
      )
      expect(ui.connectionsChanged).toHaveBeenCalled()
      expect(
        TokenConnectionRegistry.open(storage)
          .storage(id)
          .loadLocalStorage('abele-sync-token-state:local-only')
      ).toEqual(['Sample.md'])
      expect(ui.itemSets.deleteFacts('share-a', 'item-a')).toBe(facts)
      ui.itemSets.closeDeletePreview('share-a')
      expect(ui.itemSets.deleteFacts('share-a', 'item-a')).toBe(null)
      await vi.waitFor(() => expect(ui.itemSets.deleteFacts('share-a', 'item-a')).not.toBe(null))
    }
  )
  it('keeps the selected item on direct rename confirmation requests', async () => {
    const scope = { kind: 'folder' as const, id: 'folder-a', path: 'Shared' }
    const state = new MemoryStateStore(),
      metadata = new MemoryStateStore()
    const fetcher: typeof fetch = async (input, init) => {
      expect(new Headers(init?.headers).get('abele-scope-item')).toBe('item-a')
      const path = new URL(String(input)).pathname
      if (path === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'token-a',
          space_id: 'space-a',
          scope: { ...scope, path: 'Renamed' },
          status: 'active',
          limits: { max_file_bytes: 1000, quota_bytes: null },
        })
      if (path === '/v2/manifest' || path === '/v2/changes')
        return Response.json({ items: [], cursor: 1, next: null })
      throw new Error('Unexpected route: ' + path)
    }
    const runtime = new TokenEngineRuntime({
      id: 'record-a',
      encoded: encodeAccessToken({
        v: 2,
        address: 'https://sync.example',
        key: 'a'.repeat(43),
        items: [{ id: 'item-a', kind: 'folder', scope_id: 'server-scope-a', path: scope.path }],
      }),
      item: 'item-a',
      scope,
      rootIssue: { kind: 'server-renamed', from: 'Shared', to: 'Renamed' },
      fetch: fetcher,
      fs: new MemoryFileSystem(),
      state,
      reviews: {
        executables: new ExecutableReview(metadata),
        attachments: new AttachmentConsent(metadata),
        close: () => {},
      },
      changed: () => {},
      failed: () => {},
      covers: async () => false,
    })
    try {
      await runtime.followServerRoot()
    } finally {
      await runtime.close()
    }
  })
  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [false, false, true],
  ])(
    'uses authoritative group counts and overlap disclosure (whole=%s, hidden=%s, denied=%s)',
    async (whole, hidden, denied) => {
      const { storage, data } = setup()
      data.delete(TOKEN_REGISTRY_KEY)
      const registry = TokenConnectionRegistry.open(storage),
        key = 'a'.repeat(43)
      const secrets = { get: () => key, set: () => {}, remove: () => {} }
      const scope = { kind: 'folder' as const, id: 'root', path: '/' }
      const id = registry.add()
      registry.attach(
        id,
        { v: 1, address: 'https://sync.example', key, scope },
        { protocol: 2, token_id: 'owner', space_id: 'space-a', scope, status: 'active' },
        secrets
      )
      const group = { kind: 'group', id: 'group-a', path: 'Sample group.md' }
      const fetcher: typeof fetch = async (input) => {
        const path = new URL(String(input)).pathname
        if (path.endsWith('/connection'))
          return Response.json({
            protocol: 2,
            token_id: 'owner',
            space_id: 'space-a',
            scope,
            status: 'active',
            read_only: false,
            limits: { max_file_bytes: 1000, quota_bytes: null },
          })
        if (path.endsWith('/preview')) {
          if (denied)
            return Response.json(
              { error: { code: 'forbidden', message: 'untrusted response detail' } },
              { status: 403 }
            )
          const preview = {
            id: 'group-item',
            scope_id: 'scope-group',
            scope: group,
            added_at: '2025-01-01T00:00:00Z',
            removed_at: null,
            status: 'active',
            file_count: 501,
            total_bytes: 12345,
            files: [
              {
                file_id: 'shared-note',
                path: 'Notes/Shared.md',
                bytes: 25,
                overlap_count: hidden ? 2 : 3,
                overlaps: hidden
                  ? []
                  : [
                      {
                        token_id: 'same-scope-token',
                        item_id: 'same-scope-item',
                        scope_id: 'scope-group',
                        scope: group,
                      },
                      {
                        token_id: 'another-token',
                        item_id: 'other-item',
                        scope_id: 'other-scope',
                        scope: { kind: 'group', id: 'group-b', path: 'Groups/Other group.md' },
                      },
                    ],
              },
            ],
          }
          return Response.json(
            whole
              ? {
                  token_id: 'issued',
                  file_count: 601,
                  total_bytes: 23456,
                  items: [
                    preview,
                    { ...preview, id: 'group-item-2', scope_id: 'scope-group-2' },
                    {
                      ...preview,
                      id: 'detached-item',
                      status: 'removed',
                      removed_at: '2025-01-02T00:00:00Z',
                      file_count: 0,
                      total_bytes: 0,
                      files: [],
                    },
                  ],
                }
              : preview
          )
        }
        if (path.endsWith('/manifest')) return Response.json({ items: [], cursor: 0, next: null })
        if (path.endsWith('/tokens/root-token/items'))
          return Response.json({
            items: [
              {
                id: 'root-item',
                scope_id: 'root-scope',
                scope,
                added_at: '2025-01-01T00:00:00Z',
                removed_at: null,
              },
            ],
          })
        if (path.endsWith('/tokens'))
          return Response.json({
            items: [
              {
                id: 'issued',
                scope: group,
                label: 'Sample group share',
                issued_by_token_id: 'owner',
                created_at: '2025-01-01T00:00:00Z',
                revoked_at: null,
              },
              {
                id: 'root-token',
                scope,
                label: 'Whole space',
                issued_by_token_id: 'owner',
                created_at: '2025-01-01T00:00:00Z',
                revoked_at: null,
              },
            ],
          })
        return Response.json({
          items: [
            {
              id: 'group-item',
              scope_id: 'scope-group',
              scope: group,
              added_at: '2025-01-01T00:00:00Z',
              removed_at: null,
            },
          ],
        })
      }
      const ui = new TokenUi(registry, secrets, fetcher)
      await ui.itemSets.shares(id)
      const itemId = whole ? null : 'group-item'
      await vi.waitFor(() => expect(ui.itemSets.deleteFacts('issued', itemId)).not.toBe(null))
      if (denied) {
        expect(ui.itemSets.deleteFacts('issued', itemId)).toMatchObject({
          canWrite: false,
          unavailableReason: 'This connection does not allow that action.',
        })
        return
      }
      expect(ui.itemSets.deleteFacts('issued', itemId)).toMatchObject({
        canWrite: true,
        files: whole ? 601 : 501,
        bytes: whole ? 23456 : 12345,
        also: hidden
          ? [{ path: 'Notes/Shared.md', overlapCount: 2 }]
          : [
              { path: 'Notes/Shared.md', group: 'Other group' },
              { path: 'Notes/Shared.md', overlapCount: 1 },
            ],
        access: [{ label: 'Sample group share', scope: 'Loses Group: Sample group' }],
        alsoMore: true,
      })
    }
  )
  it('retains the baseline of a departed file after its active ledger entry is dropped', async () => {
    const state = new MemoryStateStore(),
      retained = new RetainedShareCopies(state)
    const entry = {
      path: 'Sample.md',
      wirePath: 'Sample.md',
      fileId: 'file-a',
      versionId: 'version-a',
      sha: 'a'.repeat(64),
      size: 3,
      mtime: 1,
    }
    await state.put(entry)
    await retained.remember(entry)
    await state.delete(entry.path)
    expect(await new RetainedShareCopies(state).read()).toEqual([entry])
    await retained.forget(entry.fileId)
    expect(await retained.read()).toEqual([])
  })
  it('accepts file-item sources for the same executable review path as other connections', () => {
    expect(
      reviewSourceSchema.safeParse({
        id: 'local-a',
        address: 'https://sync.example',
        spaceId: 'space-a',
        tokenId: 'token-a',
        scope: { kind: 'file', id: 'script-a', path: 'Scripts/sample.js' },
      }).success
    ).toBe(true)
  })
  it('cleans provisional records and key copies when enrollment cannot finish saving', async () => {
    const { storage, data } = setup()
    data.delete(TOKEN_REGISTRY_KEY)
    const registry = TokenConnectionRegistry.open(storage),
      keys = new Map<string, string>()
    let writes = 0
    const scope = { kind: 'folder' as const, id: 'scope-a', path: 'Garden' }
    const second = { ...scope, id: 'scope-b', path: 'Library' }
    const secrets = {
      get: (id: string) => keys.get(id) ?? null,
      set: (id: string, value: string) => {
        if (++writes === 2) throw new Error('keychain unavailable')
        keys.set(id, value)
      },
      remove: (id: string) => {
        keys.delete(id)
      },
    }
    const fetcher: typeof fetch = async (input, init) => {
      const selected =
        new Headers(init?.headers).get('abele-scope-item') === 'item-b' ? second : scope
      return Response.json(
        String(input).endsWith('/items')
          ? {
              items: [scope, second].map((scope, index) => ({
                id: index ? 'item-b' : 'item-a',
                scope_id: scope.id,
                scope,
                added_at: '2025-01-01T00:00:00Z',
                removed_at: null,
              })),
            }
          : {
              protocol: 2,
              token_id: 'token-a',
              space_id: 'space-a',
              scope: selected,
              status: 'active',
              limits: { max_file_bytes: 1000, quota_bytes: null },
            }
      )
    }
    const ui = new TokenUi(registry, secrets, fetcher)
    await expect(
      ui.connect(
        encodeAccessToken({
          v: 2,
          address: 'https://sync.example',
          key: 'a'.repeat(43),
          items: [{ id: 'item-a', kind: 'folder', scope_id: scope.id, path: scope.path }],
        })
      )
    ).rejects.toThrow('keychain unavailable')
    expect(registry.records()).toHaveLength(0)
    expect(keys.size).toBe(0)
  })
  it('a non-uploader still receives the item feed without publishing an edit or a deletion', async () => {
    const path = 'Sample.md',
      original = new TextEncoder().encode('baseline')
    const hash = await sha256(original),
      state = new MemoryStateStore(),
      fs = new MemoryFileSystem()
    await state.put({
      path,
      wirePath: path,
      fileId: 'file-a',
      versionId: 'version-a',
      sha: hash,
      size: original.length,
      mtime: 1,
    })
    await state.setCursor(1)
    await fs.writeAtomic(path, new TextEncoder().encode('local edit'), 2)
    const scope = { kind: 'file' as const, id: 'file-a', path }
    const requests: string[] = []
    let departed = false
    const fetcher: typeof fetch = async (input, init) => {
      const route = new URL(String(input)).pathname
      expect(new Headers(init?.headers).get('abele-scope-item')).toBe('item-a')
      requests.push(route)
      if (route === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'token-a',
          space_id: 'space-a',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000, quota_bytes: null },
        })
      if (route === '/v2/manifest')
        return Response.json({
          items: [
            {
              file_id: 'file-a',
              version_id: 'version-a',
              path,
              sha: hash,
              size: original.length,
              mtime: 1,
              kind: 'note',
            },
          ],
          cursor: 1,
          next: null,
        })
      if (route === '/v2/changes')
        return Response.json({
          items:
            departed && Number(new URL(String(input)).searchParams.get('since')) < 2
              ? [
                  {
                    cursor: 2,
                    at: '2025-01-01T00:00:00Z',
                    type: 'removal',
                    file_id: 'file-a',
                    path,
                  },
                ]
              : [],
          cursor: departed ? 2 : 1,
          next: null,
        })
      if (route.includes('/content')) return new Response(original)
      throw new Error('Unexpected publication: ' + route)
    }
    const meta = new MemoryStateStore()
    const runtime = new TokenEngineRuntime({
      id: 'record-a',
      encoded: encodeAccessToken({
        v: 2,
        address: 'https://sync.example',
        key: 'a'.repeat(43),
        items: [{ id: 'item-a', kind: 'file', scope_id: scope.id, path }],
      }),
      item: 'item-a',
      fs,
      state,
      fetch: fetcher,
      uploadAllowed: () => false,
      reviews: {
        executables: new ExecutableReview(meta),
        attachments: new AttachmentConsent(meta),
        close: () => {},
      },
      changed: () => {},
      failed: () => {},
      covers: async () => false,
    })
    try {
      await runtime.sync()
      expect(requests).toContain('/v2/changes')
      expect(requests).not.toContain('/v2/commit')
      expect(await fs.read(path)).toEqual(new TextEncoder().encode('local edit'))
      departed = true
      await runtime.sync()
      expect(await fs.read(path)).toEqual(new TextEncoder().encode('local edit'))
      expect(await state.get(path)).toBe(null)
      expect((await new RetainedShareCopies(state).read())[0]?.sha).toBe(hash)
    } finally {
      await runtime.close()
    }
  })
  it('keeps an edited local-only copy through deletion, sync and runtime restart', async () => {
    const path = 'Sample.md',
      original = new TextEncoder().encode('baseline')
    const hash = await sha256(original),
      state = new MemoryStateStore(),
      fs = new MemoryFileSystem()
    await state.put({
      path,
      wirePath: path,
      fileId: 'file-a',
      versionId: 'version-a',
      sha: hash,
      size: original.length,
      mtime: 1,
    })
    await state.setJournal({
      batchId: 'pending-batch',
      idempotencyKey: 'pending-create',
      startedAt: new Date().toISOString(),
      ops: [{ op: 'create', path, sha: hash, size: original.length, mtime: 1 }],
    })
    await state.setCursor(1)
    await fs.writeAtomic(path, new TextEncoder().encode('local edit'), 2)
    const scope = { kind: 'file' as const, id: 'file-a', path }
    const requests: string[] = []
    let departed = false
    const fetcher: typeof fetch = async (input, init) => {
      const route = new URL(String(input)).pathname
      expect(new Headers(init?.headers).get('abele-scope-item')).toBe('item-a')
      requests.push(route)
      if (route === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'token-a',
          space_id: 'space-a',
          scope,
          status: 'active',
          limits: { max_file_bytes: 1000, quota_bytes: null },
        })
      if (route === '/v2/manifest')
        return Response.json({
          items: [
            {
              file_id: 'file-a',
              version_id: 'version-a',
              path,
              sha: hash,
              size: original.length,
              mtime: 1,
              kind: 'note',
            },
          ],
          cursor: 1,
          next: null,
        })
      if (route === '/v2/changes')
        return Response.json({
          items:
            departed && Number(new URL(String(input)).searchParams.get('since')) < 2
              ? [
                  {
                    cursor: 2,
                    at: '2025-01-01T00:00:00Z',
                    type: 'delete',
                    version_id: 'version-b',
                    file_id: 'file-a',
                    path,
                  },
                ]
              : [],
          cursor: departed ? 2 : 1,
          next: null,
        })
      if (route.includes('/content')) return new Response(original)
      throw new Error('Unexpected publication: ' + route)
    }
    const meta = new MemoryStateStore()
    const open = () =>
      new TokenEngineRuntime({
        id: 'record-a',
        encoded: encodeAccessToken({
          v: 2,
          address: 'https://sync.example',
          key: 'a'.repeat(43),
          items: [{ id: 'item-a', kind: 'file', scope_id: scope.id, path }],
        }),
        item: 'item-a',
        fs,
        state,
        fetch: fetcher,
        localOnly: (candidate) => candidate === path,
        reviews: {
          executables: new ExecutableReview(meta),
          attachments: new AttachmentConsent(meta),
          close: () => {},
        },
        changed: () => {},
        failed: () => {},
        covers: async () => false,
      })
    let runtime = open()
    try {
      await runtime.sync()
      expect(requests).toContain('/v2/changes')
      expect(requests).not.toContain('/v2/commit')
      expect(await state.getJournal()).toBe(null)
      expect(await state.getMeta('local-only-publication-journal:pending-create')).not.toBe(null)
      expect(await fs.read(path)).toEqual(new TextEncoder().encode('local edit'))
      departed = true
      await runtime.sync()
      expect(await fs.read(path)).toEqual(new TextEncoder().encode('local edit'))
      await runtime.close()
      runtime = open()
      await runtime.sync()
      expect(await fs.read(path)).toEqual(new TextEncoder().encode('local edit'))
      expect(requests).not.toContain('/v2/commit')
    } finally {
      await runtime.close()
    }
  })
  it('enrolls the current server set instead of the original QR preview and presents one row', async () => {
    const { storage, data } = setup()
    data.delete(TOKEN_REGISTRY_KEY)
    const keys = new Map<string, string>()
    const secrets = {
      get: (id: string) => keys.get(id) ?? null,
      set: (id: string, key: string) => {
        keys.set(id, key)
      },
      remove: (id: string) => {
        keys.delete(id)
      },
    }
    const scope = { kind: 'folder' as const, id: 'scope-new', path: 'Current' }
    let currentScope = scope,
      currentItem = 'current-item'
    const requests: string[] = []
    const fetcher: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname
      requests.push(path + ':' + (new Headers(init?.headers).get('abele-scope-item') ?? ''))
      return Response.json(
        path.endsWith('/items')
          ? {
              items: [
                {
                  id: currentItem,
                  scope_id: 'server-scope-' + currentItem,
                  scope: currentScope,
                  added_at: '2025-01-01T00:00:00Z',
                  removed_at: null,
                },
              ],
            }
          : {
              protocol: 2,
              token_id: 'sample-token',
              space_id: 'sample-space',
              scope: currentScope,
              status: 'active',
              limits: { max_file_bytes: 1000, quota_bytes: null },
            }
      )
    }
    const registry = TokenConnectionRegistry.open(storage)
    const before = structuredClone(data.get(TOKEN_REGISTRY_KEY))
    const ui = new TokenUi(registry, secrets, fetcher)
    await ui.connect(
      encodeAccessToken({
        v: 2,
        address: 'https://sync.example',
        key: 'a'.repeat(43),
        items: [{ id: 'old-item', kind: 'folder', scope_id: 'scope-old', path: 'Old' }],
      })
    )
    expect(ui.rows.value).toHaveLength(1)
    expect(ui.rows.value[0].scope?.path).toBe('Current')
    const encoded = decodeAccessToken(ui.itemSets.encoded(registry.records()[0]))
    expect(encoded.v === 2 && encoded.items[0].scope_id).toBe('server-scope-current-item')
    expect(requests).toContain('/v2/connection:current-item')
    expect(data.get(TOKEN_REGISTRY_KEY)).toEqual(before)
    const reads = vi.spyOn(storage, 'loadLocalStorage')
    for (let index = 0; index < 10; index++)
      expect(ui.itemSets.mayUpload(ui.rows.value[0].id, 'Current/sample.md', () => true)).toBe(true)
    expect(reads).not.toHaveBeenCalled()
    reads.mockRestore()
    currentScope = { kind: 'folder', id: 'scope-added', path: 'Added' }
    currentItem = 'added-item'
    const saveSecret = secrets.set
    secrets.set = () => {
      throw new Error('keychain unavailable during refresh')
    }
    await expect(ui.itemSets.refresh(ui.rows.value[0].id)).rejects.toThrow(
      'keychain unavailable during refresh'
    )
    expect(registry.records()).toHaveLength(1)
    expect(keys.size).toBe(1)
    secrets.set = saveSecret
    ui.setTrusted(ui.rows.value[0].id, true)
    await ui.updateConnection(ui.rows.value[0].id, {
      selective: { ...registry.records()[0].selective, images: false },
    })
    expect(await ui.itemSets.refresh(ui.rows.value[0].id)).toBe(true)
    expect(ui.itemSets.items(ui.rows.value[0].id)?.map((item) => item.state.kind)).toEqual([
      'detached',
      'synced',
    ])
    expect(ui.rows.value).toHaveLength(1)
    expect(registry.records()).toHaveLength(2)
    expect(keys.size).toBe(2)
    expect(registry.records().every((record) => record.trusted)).toBe(true)
    expect(registry.records().every((record) => !record.selective.images)).toBe(true)
    await ui.updateConnection(ui.rows.value[0].id, {
      selective: { ...registry.records()[0].selective, images: true },
    })
    expect(registry.records().every((record) => record.selective.images)).toBe(true)
    ui.setTrusted(ui.rows.value[0].id, false)
    expect(registry.records().every((record) => !record.trusted)).toBe(true)
    registry.beginForget(ui.rows.value[0].id)
    registry.finishForgotten(secrets)
    ui.refresh()
    expect(ui.rows.value).toHaveLength(1)
    expect(ui.rows.value[0].paused).toBe(true)
    await ui.disconnect(ui.rows.value[0].id)
    expect(registry.records()).toHaveLength(0)
    expect(keys.size).toBe(0)
    expect(data.get(TOKEN_REGISTRY_KEY)).toEqual(before)
  })
  it('keeps file item engine records out of the legacy registry and cleans their key copies', () => {
    const { storage, data } = setup()
    data.delete(TOKEN_REGISTRY_KEY)
    const registry = TokenConnectionRegistry.open(storage)
    const legacy = structuredClone(data.get(TOKEN_REGISTRY_KEY))
    const id = registry.add(true)
    const keys = new Map<string, string>()
    const secrets = {
      get: (id: string) => keys.get(id) ?? null,
      set: (id: string, key: string) => {
        keys.set(id, key)
      },
      remove: (id: string) => {
        keys.delete(id)
      },
    }
    const scope = { kind: 'file' as const, id: 'sample-file', path: 'Sample.md' }
    registry.attach(
      id,
      { v: 1, address: 'https://sync.example', key: 'a'.repeat(43), scope },
      { protocol: 2, token_id: 'sample-token', space_id: 'sample-space', scope, status: 'active' },
      secrets
    )
    expect(data.get(TOKEN_REGISTRY_KEY)).toEqual(legacy)
    expect(TokenConnectionRegistry.open(storage).records()[0].scope?.kind).toBe('file')
    registry.beginForget(id)
    registry.finishForgotten(secrets)
    expect(keys.size).toBe(0)
    expect(data.get(TOKEN_REGISTRY_KEY)).toEqual(legacy)
  })
  it('selects an item record without changing the legacy registry selection', () => {
    const { storage, data } = setup()
    data.delete(TOKEN_REGISTRY_KEY)
    const registry = TokenConnectionRegistry.open(storage),
      legacy = registry.add(),
      item = registry.add(true)
    registry.select(item)
    expect(TokenConnectionRegistry.open(storage).selectedId).toBe(item)
    expect((data.get(TOKEN_REGISTRY_KEY) as { selectedId: string }).selectedId).toBe(legacy)
    registry.select(legacy)
    expect(TokenConnectionRegistry.open(storage).selectedId).toBe(legacy)
  })
  it('keeps other items syncing when one item fails', async () => {
    const { sets } = setup()
    const items = [folder('a', 'Garden'), folder('b', 'Library')]
    sets.create('c', '', items)
    const synced = vi.fn(async () => {})
    const host = new ItemSetEngines(sets, {
      read: async () => items,
      open: async (_connection, item) => ({
        sync:
          item.id === 'a'
            ? async () => {
                throw new Error('item unavailable')
              }
            : synced,
        close: async () => {},
      }),
    })
    try {
      await expect(host.sync('c')).rejects.toThrow()
      expect(synced).toHaveBeenCalledOnce()
    } finally {
      await host.close()
    }
  })
  it('coalesces membership requests without allowing a stale result to overwrite newer membership', async () => {
    const { sets } = setup()
    sets.create('c', '', [folder('a', 'Garden')])
    const read = vi.fn(async () => [folder('b', 'Library')])
    await Promise.all([sets.refresh('c', read), sets.refresh('c', read)])
    expect(read).toHaveBeenCalledOnce()
    expect(sets.get('c')?.items.find((one) => one.id === 'a')?.detached).toBe(true)
  })
  it('drains an engine opened during shutdown and does not start its sync', async () => {
    const { sets } = setup()
    sets.create('c', '', [folder('a', 'Garden')])
    let opened!: () => void
    const opening = new Promise<void>((resolve) => {
      opened = resolve
    })
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    const sync = vi.fn(async () => {}),
      close = vi.fn(async () => {})
    const host = new ItemSetEngines(sets, {
      read: async () => [folder('a', 'Garden')],
      open: async () => {
        opened()
        await wait
        return { sync, close }
      },
    })
    const work = host.sync('c')
    await opening
    const closed = host.close()
    release()
    await Promise.all([work, closed])
    expect(sync).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })
  it('starts added item engines and drains detached engines without touching local bytes', async () => {
    const { sets } = setup()
    sets.create('c', '', [folder('a', 'Garden')])
    const events: string[] = []
    let current = [folder('a', 'Garden')]
    const host = new ItemSetEngines(sets, {
      read: async () => current,
      open: async (_connection, item) => ({
        sync: async () => {
          events.push('sync:' + item.id)
        },
        close: async () => {
          events.push('close:' + item.id)
        },
      }),
    })
    await host.sync('c')
    current = [folder('b', 'Library')]
    await host.foreground('c')
    expect(events).toEqual(['sync:a', 'close:a', 'sync:b'])
    expect(sets.get('c')?.items[0].detached).toBe(true)
    await host.close()
    expect(events.at(-1)).toBe('close:b')
  })
  it('removes only unchanged detached bytes, retaining edited and otherwise covered files', async () => {
    const fs = new MemoryFileSystem(),
      state = new MemoryStateStore()
    const original = new TextEncoder().encode('original')
    for (const path of ['Garden/unchanged.md', 'Garden/edited.md', 'Garden/covered.md']) {
      await fs.writeAtomic(path, original, 1)
      await state.put({
        path,
        wirePath: path,
        fileId: path,
        versionId: 'v1',
        sha: await sha256(original),
        size: original.length,
        mtime: 1,
      })
    }
    await fs.writeAtomic('Garden/edited.md', new TextEncoder().encode('edited'), 2)
    const result = await removeDetachedCopies({
      fs,
      state,
      detached: () => true,
      covered: (path) => path.endsWith('covered.md'),
      lease: async (_path, work) => work(),
    })
    expect(result).toEqual({ removed: 1, kept: 2 })
    expect(await fs.stat('Garden/unchanged.md')).toBe(null)
    expect(await fs.stat('Garden/edited.md')).not.toBe(null)
    expect(await fs.stat('Garden/covered.md')).not.toBe(null)
    expect(await state.get('Garden/edited.md')).not.toBe(null)
  })
  it('leases the physical location when removing a relocated detached copy', async () => {
    const disk = new MemoryFileSystem(),
      state = new MemoryStateStore()
    const placement = new LocalFolderPlacement('Shared', 'Device copy')
    const bytes = new TextEncoder().encode('unchanged sample')
    await disk.writeAtomic('Device copy/sample.md', bytes, 1000)
    await state.put({
      path: 'Shared/sample.md',
      fileId: 'sample',
      versionId: 'version-a',
      sha: await sha256(bytes),
      size: bytes.length,
      mtime: 1000,
    })
    const lease = vi.fn(async (path: string, work: () => Promise<void>) => {
      expect(path).toBe('Device copy/sample.md')
      await work()
    })
    expect(
      await removeDetachedCopies({
        fs: placement.fileSystem(disk),
        state,
        detached: () => true,
        covered: () => false,
        localPath: (path) => placement.toLocal(path),
        lease,
      })
    ).toEqual({ removed: 1, kept: 0 })
    expect(lease).toHaveBeenCalledOnce()
    expect(await disk.stat('Device copy/sample.md')).toBeNull()
  })
  it('refuses local copy deletion for a live item', async () => {
    await expect(
      removeDetachedCopies({
        fs: new MemoryFileSystem(),
        state: new MemoryStateStore(),
        detached: () => false,
        covered: () => false,
        lease: async (_path, work) => work(),
      })
    ).rejects.toThrow(/no longer shared/i)
  })
  it('keeps grouping separate from the downgrade registry and survives reopening', () => {
    const { data, storage, sets } = setup()
    data.delete(TOKEN_REGISTRY_KEY)
    const legacy = TokenConnectionRegistry.open(storage)
    const localId = legacy.add()
    const before = structuredClone(data.get(TOKEN_REGISTRY_KEY))
    sets.create('connection', 'Example', [folder('a', 'Garden')])
    expect(data.get(TOKEN_REGISTRY_KEY)).toEqual(before)
    expect(TokenConnectionRegistry.open(storage).records()[0].id).toBe(localId)
    expect(new ConnectionSets(storage).get('connection')?.items[0].id).toBe('a')
    expect(data.has(SETS_KEY)).toBe(true)
  })
  it('bounds new shares to twenty items without restricting an empty current server set', () => {
    const { sets } = setup()
    expect(() =>
      sets.create(
        'c',
        '',
        Array.from({ length: 21 }, (_, n) => folder(String(n), `Folder-${n}`))
      )
    ).toThrow(/20/)
    expect(() => sets.create('c', '', [])).toThrow()
    sets.create('c', '', [folder('a', 'Garden')])
    sets.reconcile('c', [])
    expect(sets.get('c')?.items[0].detached).toBe(true)
  })
  it('picks up added items, retains detached items, and resumes a readded item', () => {
    const { sets } = setup()
    sets.create('c', '', [folder('a', 'Garden')])
    expect(sets.reconcile('c', [folder('b', 'Library')])).toEqual({ added: ['b'], detached: ['a'] })
    expect(sets.get('c')?.items.find((i) => i.id === 'a')?.detached).toBe(true)
    expect(sets.reconcile('c', [folder('a', 'Garden'), folder('b', 'Library')])).toEqual({
      added: ['a'],
      detached: [],
    })
    expect(sets.get('c')?.items).toHaveLength(2)
  })
  it('fails closed on corrupt grouping without overwriting evidence', () => {
    const { storage, data } = setup()
    data.set(SETS_KEY, { version: 7, connections: [] })
    expect(() => new ConnectionSets(storage).get('c')).toThrow(/recovery/i)
    expect(data.get(SETS_KEY)).toEqual({ version: 7, connections: [] })
  })
  it('refuses duplicate and overlapping folders in either order, respecting boundaries', () => {
    const { sets } = setup()
    expect(() =>
      sets.create('c', '', [folder('a', 'Garden'), folder('b', 'Garden/Trees')])
    ).toThrow(/Garden/)
    expect(() =>
      sets.create('c', '', [folder('b', 'Garden/Trees'), folder('a', 'Garden')])
    ).toThrow(/Garden/)
    expect(() => sets.create('c', '', [folder('a', 'Garden'), folder('a', 'Garden')])).toThrow()
    sets.create('c', '', [folder('a', 'Garden'), folder('b', 'Gardens')])
  })
  it('elects one uploader using live coverage and stable order, excluding paused and detached items', () => {
    const { sets } = setup()
    sets.create('c', '', [
      folder('a', 'Garden'),
      { id: 'b', kind: 'group', scopeId: 'b', path: 'Topics.md' },
    ])
    const covers = (_id: string, path: string) => path === 'Garden/note.md'
    expect(sets.uploader('c', 'Garden/note.md', covers)).toBe('a')
    sets.pause('c', 'a', true)
    expect(sets.uploader('c', 'Garden/note.md', covers)).toBe('b')
    sets.reconcile('c', [folder('a', 'Garden')])
    expect(sets.uploader('c', 'Garden/note.md', covers)).toBe(null)
  })
  it('does not detach on an unavailable server or an unsupported capability', async () => {
    const { sets } = setup()
    sets.create('c', '', [folder('a', 'Garden')])
    await expect(
      sets.refresh('c', async () => {
        throw new Error('offline')
      })
    ).rejects.toThrow('offline')
    expect(await sets.refresh('c', async () => null)).toBe(false)
    expect(sets.get('c')?.items[0].detached).toBe(false)
  })
})
