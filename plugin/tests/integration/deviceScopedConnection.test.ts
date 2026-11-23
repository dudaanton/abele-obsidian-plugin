import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { TokenUi } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { decodeAccessToken } from '@/sync/v2/client'
import { encodeAccessToken } from '@/sync/v2/contract'
import { scopeInventory } from '@/sync/deviceScopeInventory'
import type { DeviceScopeLease } from '@/sync/deviceScopeLease'
import { LocalOnlyCopies } from '@/sync/localOnlyCopies'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { connectionAdapter } from '@/sync/connectionScope'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { buildFakeVault } from '../helpers/fakeVault'
import { retainedCopyCovered } from '@/sync/retainedCopyCoverage'
import {
  MemoryFileSystem,
  MemoryStateStore,
  V2EngineClient,
  SyncEngine,
  selectiveDefaults,
} from '@abele/sync-sdk/core'

function fixture(rootPath = '/', folderPath = 'Garden', multiSource = false) {
  const values = new Map<string, unknown>(),
    secrets = new Map<string, string>()
  const storage = {
    loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, structuredClone(value))
    },
  }
  const root = { kind: 'folder' as const, id: 'root', path: rootPath }
  const group = {
    kind: 'group' as const,
    id: 'group-note',
    path: rootPath === '/' ? 'Reading.md' : rootPath + '/Reading.md',
  }
  const folder = { kind: 'folder' as const, id: 'folder-a', path: folderPath }
  const file = {
    kind: 'file' as const,
    id: 'file-a',
    path: rootPath === '/' ? 'Plan.md' : rootPath + '/Plan.md',
  }
  const scopes = [group, folder, file]
  const items = scopes.map((scope, index) => ({
    id: 'item-' + index,
    scope_id: scope.id,
    scope,
    added_at: '2025-01-01T00:00:00Z',
    removed_at: null,
  }))
  const source = encodeAccessToken(
    multiSource
      ? {
          v: 2,
          address: 'https://sync.example',
          key: 'a'.repeat(43),
          items: [items[1], items[0], items[2]].map((item) => ({
            id: item.id,
            kind: item.scope.kind,
            scope_id: item.scope.id,
            path: item.scope.path,
          })),
        }
      : {
          v: 1,
          address: 'https://sync.example',
          key: 'a'.repeat(43),
          scope: root,
        }
  )
  const owned = encodeAccessToken({
    v: 1,
    address: 'https://sync.example',
    key: 'b'.repeat(43),
    scope: group,
  })
  let chosen = [items[0]]
  let issued = false
  let readOnly = false
  const issueRequests: { read_only?: boolean }[] = []
  const revoked: string[] = []
  const calls: string[] = []
  let remoteMembers = rootPath === '/' ? ['Reading.md'] : [group.path, file.path]
  const content = (path: string) =>
    new TextEncoder().encode(
      path === 'Reading.md' ? 'Sample group\n' : '---\ngroups: ["[[Reading]]"]\n---\nSample note\n'
    )
  const fileItem = (path: string, id = path) => ({
    file_id: id,
    version_id: 'v1',
    path,
    kind: 'note',
    sha: createHash('sha256').update(content(path)).digest('hex'),
    size: content(path).length,
    mtime: 1,
  })
  const transport: typeof fetch = vi.fn(async (input, init) => {
    const url = new URL(String(input)),
      headers = new Headers(init?.headers)
    const sourceKey = headers.get('authorization') === 'Bearer ' + 'a'.repeat(43)
    const selected = chosen.find((item) => item.id === headers.get('abele-scope-item')) ?? chosen[0]
    calls.push((init?.method ?? 'GET') + ' ' + url.pathname)
    if (url.pathname === '/v2/changes') return Response.json({ items: [], cursor: 1, next: null })
    if (/^\/v2\/files\/[^/]+\/content$/.test(url.pathname)) {
      const path = decodeURIComponent(url.pathname.split('/')[3])
      const bytes = content(path)
      return new Response(bytes, { headers: { 'content-length': String(bytes.length) } })
    }
    if (url.pathname === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: sourceKey ? 'source' : 'owned',
        space_id: 'space',
        scope: sourceKey
          ? multiSource
            ? (items.find((item) => item.id === headers.get('abele-scope-item')) ?? items[1]).scope
            : root
          : selected.scope,
        status: 'active',
        read_only: readOnly,
        limits: { max_file_bytes: 100000, quota_bytes: null },
      })
    if (url.pathname === '/v2/manifest')
      return Response.json({
        items: sourceKey
          ? [
              fileItem(group.path, group.id),
              {
                kind: 'directory',
                file_id: folder.id,
                path: folder.path,
                version_id: 'v1',
                mtime: 1,
              },
              fileItem(file.path, file.id),
            ]
          : (selected.scope.kind === 'file' ? [selected.scope.path] : remoteMembers).map((path) =>
              fileItem(path, rootPath === '/' ? path : path === file.path ? file.id : group.id)
            ),
        cursor: 1,
        next: null,
      })
    if (url.pathname === '/v2/connection/items')
      return Response.json({
        items: sourceKey ? (multiSource ? [items[1], items[0], items[2]] : []) : chosen,
      })
    if (url.pathname === '/v2/tokens' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      issueRequests.push(body)
      issued = true
      chosen = [
        body.scope.id === root.id
          ? {
              id: 'item-root',
              scope_id: root.id,
              scope: root,
              added_at: '2025-01-01T00:00:00Z',
              removed_at: null,
            }
          : items.find((item) => item.scope.id === body.scope.id)!,
      ]
      return Response.json({
        token:
          chosen[0].scope.kind === 'file'
            ? encodeAccessToken({
                v: 2,
                address: 'https://sync.example',
                key: 'b'.repeat(43),
                items: [
                  {
                    id: chosen[0].id,
                    kind: 'file',
                    scope_id: chosen[0].scope.id,
                    path: chosen[0].scope.path,
                  },
                ],
              })
            : encodeAccessToken({ ...decodeAccessToken(owned), scope: chosen[0].scope }),
        info: {
          id: 'owned',
          label: body.label,
          scope: chosen[0].scope,
          issued_by_token_id: 'source',
          created_at: '2025-01-01T00:00:00Z',
          revoked_at: null,
        },
      })
    }
    if (url.pathname === '/v2/tokens/owned/items' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      const item = items.find((item) => item.scope.id === body.scope.id)!
      if (multiSource && headers.get('abele-scope-item') !== item.id)
        return Response.json({ error: { code: 'forbidden' } }, { status: 403 })
      chosen.push(item)
      return Response.json(item)
    }
    if (url.pathname === '/v2/tokens') return Response.json({ items: [] })
    if (url.pathname.startsWith('/v2/tokens/') && init?.method === 'DELETE') {
      revoked.push(url.pathname.split('/').pop()!)
      return Response.json({ revoked: true })
    }
    throw new Error('Unexpected test request: ' + url.pathname)
  })
  const open = () => {
    const registry = TokenConnectionRegistry.open(storage)
    const ui = new TokenUi(
      registry,
      {
        get: (reference) => secrets.get(reference) ?? null,
        set: (reference, key) => {
          secrets.set(reference, key)
        },
        remove: (reference) => {
          secrets.delete(reference)
        },
      },
      transport
    )
    ui.connectionsChanged = vi.fn(async () => {})
    return { ui, registry }
  }
  return {
    ...open(),
    restart: open,
    source,
    scopes,
    calls,
    revoked,
    transport,
    content,
    issueRequests,
    secrets,
    setReadOnly: () => {
      readOnly = true
    },
    addRemoteMember: () => {
      remoteMembers.push('Remote/New member.md')
    },
    issued: () => issued,
  }
}

it('reconnects a folder with a sibling group and file through their own delegation authorities', async () => {
  const f = fixture('/', 'Garden', true)
  await f.ui.connect(f.source, undefined, [f.scopes[1], f.scopes[0], f.scopes[2]])
  const id = f.ui.rows.value[0].id
  expect(f.ui.deviceScopes.state(id)?.current?.records).toHaveLength(3)
  await f.registry.flush()
  const restarted = f.restart()
  await restarted.ui.deviceScopes.resume()
  expect(restarted.ui.deviceScopes.state(id)?.current?.records).toHaveLength(3)
  expect(f.issueRequests).toHaveLength(1)
  const shared = decodeAccessToken(
    await restarted.ui.itemSets.issue(id, {
      items: [f.scopes[1], f.scopes[0], f.scopes[2]],
      label: 'Sample shared access',
      readOnly: false,
    })
  )
  expect(shared.v).toBe(2)
  if (shared.v === 2) expect(shared.items).toHaveLength(3)
})

it('connects groups, folders and files using a device-owned Share key and keeps source management-only', async () => {
  const f = fixture()
  await f.ui.connect(f.source, undefined, f.scopes)
  const row = f.ui.rows.value[0]
  const state = f.ui.deviceScopes.state(row.id)!
  expect(state.current?.records).toHaveLength(3)
  expect(f.ui.rows.value).toHaveLength(1)
  expect(f.ui.deviceScopes.runnable(row.id)).toBe(false)
  expect(f.calls.filter((call) => call === 'POST /v2/tokens')).toHaveLength(1)
  expect(f.calls.filter((call) => call === 'POST /v2/tokens/owned/items')).toHaveLength(2)
  expect(f.calls.some((call) => /commit|uploads/.test(call))).toBe(false)
  const groupRecord = f.registry.records().find((record) => record.scope?.kind === 'group')!
  const encoded = f.ui.itemSets.encoded(groupRecord)
  expect(decodeAccessToken(encoded).key).toBe('b'.repeat(43))
  const client = new V2EngineClient(encoded, { fetch: f.transport })
  const fs = new MemoryFileSystem(),
    ledger = new MemoryStateStore()
  await client.prepare(fs, ledger)
  f.addRemoteMember()
  expect((await client.manifest(null)).items.map((item) => item.path)).toContain(
    'Remote/New member.md'
  )
  const engine = new SyncEngine({ client, fs, state: ledger, selective: selectiveDefaults() })
  try {
    await engine.sync()
    expect(await fs.stat('Remote/New member.md')).not.toBeNull()
  } finally {
    await engine.stop()
  }
  await f.ui.disconnect(row.id)
  expect(f.revoked).toEqual(['owned'])
  expect(f.registry.records()).toHaveLength(0)
})

it('adopts equal group files into a fresh scoped ledger without downloading or rewriting them', async () => {
  const f = fixture()
  await f.ui.connect(f.source, undefined, [f.scopes[0]])
  f.addRemoteMember()
  const record = f.registry.records().find((one) => one.scope?.kind === 'group')!
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  for (const path of ['Reading.md', 'Remote/New member.md'])
    await fs.writeAtomic(path, f.content(path), 1)
  const write = vi.spyOn(fs, 'writeAtomic')
  const client = new V2EngineClient(f.ui.itemSets.encoded(record), { fetch: f.transport })
  await client.prepare(fs, state)
  const engine = new SyncEngine({ fs, state, client, selective: selectiveDefaults() })
  try {
    await engine.sync()
    expect(await state.get('Remote/New member.md')).not.toBeNull()
    expect(f.calls.filter((call) => call.includes('/content'))).toEqual([])
    expect(write).not.toHaveBeenCalled()
  } finally {
    await engine.stop()
  }
})

it('keeps inherited read-only authority on the device-owned scoped key', async () => {
  const f = fixture()
  f.setReadOnly()
  await f.ui.connect(f.source, undefined, [f.scopes[0]])
  expect(f.issueRequests).toEqual([expect.objectContaining({ read_only: true })])
  expect(f.calls.some((call) => /uploads|commit/.test(call))).toBe(false)
})

it('keeps a failed local preparation stopped and never issues a key or starts the broad source', async () => {
  const f = fixture()
  f.ui.scopeInventory = () => scopeInventory([{ path: 'Draft.md' }])
  const sync = vi.spyOn(f.ui, 'sync').mockRejectedValue(new Error('sample upload unavailable'))
  await expect(
    f.ui.connect(f.source, undefined, [
      { kind: 'file', id: 'local:file:Draft.md', path: 'Draft.md' },
    ])
  ).rejects.toThrow('sample upload unavailable')
  expect(sync).toHaveBeenCalledTimes(1)
  expect(f.issued()).toBe(false)
  expect(f.registry.records().some((record) => f.ui.deviceScopes.runnable(record.id))).toBe(false)
  expect(
    f.registry.records().some((record) => record.state['abele-sync-token-state:scope-bootstrap'])
  ).toBe(false)
})

it('retires only the owned key before restoring whole-vault access', async () => {
  const f = fixture()
  await f.ui.connect(f.source, undefined, [f.scopes[0]])
  const id = f.ui.rows.value[0].id
  await f.ui.deviceScopes.change(id, [{ kind: 'vault', id: 'local:vault', path: '/' }])
  expect(f.revoked).toEqual(['owned'])
  expect(f.registry.records()).toHaveLength(1)
  expect(f.ui.deviceScopes.state(id)).toBeNull()
  expect(f.ui.deviceScopes.runnable(id)).toBe(true)
  expect(f.calls.some((call) => /DELETE \/v2\/(files|directories)/.test(call))).toBe(false)
})

it('can disconnect after cleanup completes but whole-vault restoration is interrupted', async () => {
  const f = fixture()
  await f.ui.connect(f.source, undefined, [f.scopes[0]])
  const id = f.ui.rows.value[0].id
  await (f.ui.deviceScopes as unknown as { lease(id: string): DeviceScopeLease }).lease(id).remove()
  expect(f.ui.deviceScopes.state(id)).toBeNull()
  await f.ui.disconnect(id)
  expect(f.registry.records()).toHaveLength(0)
  expect(f.revoked).toEqual(['owned'])
})

it('finishes disconnect when the durable set still references forgotten owned children', async () => {
  const f = fixture()
  await f.ui.connect(f.source, undefined, [f.scopes[0]])
  const id = f.ui.rows.value[0].id
  const set = f.ui.itemSets.store.get(id)!
  await (f.ui.deviceScopes as unknown as { lease(id: string): DeviceScopeLease }).lease(id).remove()
  // The registry cleanup is durable while the connection-set write was interrupted.
  f.ui.itemSets.store.create(
    id,
    set.label,
    set.items,
    Object.fromEntries(set.items.map((item) => [item.id, item.recordId!]))
  )
  await f.ui.disconnect(id)
  expect(f.registry.records()).toHaveLength(0)
  expect(f.ui.itemSets.store.get(id)).toBeNull()
  expect(f.secrets.size).toBe(0)
  expect(f.revoked).toEqual(['owned'])
})

it('retains relocated file and group placement through narrowing, restart and widening', async () => {
  const f = fixture('Shared', 'Shared/Sub')
  await f.ui.connect(f.source)
  const id = f.ui.rows.value[0].id
  f.registry.setLocalRoot(id, 'Imported')
  const selection = [f.scopes[2], f.scopes[0]].map((scope) => ({
    ...scope,
    path: scope.path.replace('Shared/', 'Imported/'),
  }))
  vi.mocked(f.ui.connectionsChanged).mockRejectedValueOnce(
    new Error('sample activation interrupted')
  )
  await expect(f.ui.deviceScopes.change(id, selection)).rejects.toThrow(
    'sample activation interrupted'
  )
  expect(f.ui.deviceScopes.state(id)?.activating).toBe(true)
  const check = (registry: TokenConnectionRegistry, ui: TokenUi) => {
    for (const child of ui.deviceScopes.state(id)!.current!.records) {
      expect(registry.records().find((record) => record.id === child)).toMatchObject({
        scopePlacement: { server: 'Shared', local: 'Imported' },
      })
    }
  }
  check(f.registry, f.ui)
  await f.registry.flush()
  const restarted = f.restart()
  await restarted.ui.deviceScopes.resume()
  check(restarted.registry, restarted.ui)
  const fileRecord = restarted.registry
    .records()
    .find(
      (record) =>
        restarted.ui.deviceScopes.state(id)!.current!.records.includes(record.id) &&
        record.scope.kind === 'file'
    )!
  expect(retainedCopyCovered([fileRecord], new Map(), 'other', 'Imported/Plan.md')).toBe(true)
  expect(retainedCopyCovered([fileRecord], new Map(), 'other', 'Shared/Plan.md')).toBe(false)
  await restarted.ui.itemSets.enroll(decodeAccessToken(restarted.ui.itemSets.encoded(fileRecord)))
  check(restarted.registry, restarted.ui)
  for (const child of restarted.ui.deviceScopes.state(id)!.current!.records) {
    const record = restarted.registry.records().find((one) => one.id === child)!
    const members =
      record.scope.kind === 'file' ? [record.scope.path] : ['Shared/Reading.md', 'Shared/Plan.md']
    const app = buildFakeVault(
      members.flatMap((path) => [
        {
          path: path.replace('Shared/', 'Imported/'),
          content: new TextDecoder().decode(f.content(path)),
        },
        { path, content: 'unrelated local bytes' },
      ])
    )
    const root = record.scopePlacement!.local
    const raw = app.vault.adapter
    const adapter = connectionAdapter(raw as never, root, connectionPrivateRoot(child))
    const fs = new ObsidianFileSystem(app as never, {
      adapter,
      fileScope: root,
      connectionId: child,
    })
    const reviews = new MemoryStateStore()
    const runtime = new TokenEngineRuntime({
      id: child,
      scope: record.scope,
      scopePlacement: record.scopePlacement,
      encoded: restarted.ui.itemSets.encoded(record),
      item: restarted.ui.itemSets.store.get(id)!.items.find((item) => item.recordId === child)!.id,
      fs,
      state: new MemoryStateStore(),
      reviews: {
        executables: new ExecutableReview(reviews),
        attachments: new AttachmentConsent(reviews),
        close: () => {},
      },
      fetch: f.transport,
      changed: () => {},
      failed: () => {},
      covers: async () => false,
    })
    const commit = vi
      .spyOn(runtime.client, 'commitRaw')
      .mockRejectedValue(new Error('sample commit captured'))
    vi.spyOn(runtime.client, 'hasBlob').mockResolvedValue(true)
    try {
      await runtime.sync()
      expect(commit).not.toHaveBeenCalled()
      const path = members.at(-1)!
      const bytes = new TextEncoder().encode('edited relocated note')
      await raw.writeBinary(path.replace('Shared/', 'Imported/'), bytes.buffer, { mtime: 5000 })
      await runtime.sync().catch(() => {})
      expect(commit).toHaveBeenCalled()
      const ops = commit.mock.calls.flatMap(([ops]) => ops)
      expect(ops).toContainEqual(
        expect.objectContaining({
          file_id: 'file-a',
          sha: createHash('sha256').update(bytes).digest('hex'),
        })
      )
      expect(
        ops.some(
          (op) =>
            'sha' in op &&
            op.sha === createHash('sha256').update('unrelated local bytes').digest('hex')
        )
      ).toBe(false)
      expect(new TextDecoder().decode(await raw.readBinary(path))).toBe('unrelated local bytes')
    } finally {
      await runtime.disconnect()
    }
  }
  await restarted.ui.deviceScopes.change(id, [{ kind: 'folder', id: 'root', path: 'Imported' }])
  const child = restarted.ui.deviceScopes.state(id)!.current!.records[0]
  expect(restarted.registry.records().find((record) => record.id === child)).toMatchObject({
    localRoot: 'Imported',
  })
})

it('keeps a narrowed subfolder under the relocated local parent', async () => {
  const f = fixture('Shared', 'Shared/Sub')
  await f.ui.connect(f.source)
  const id = f.ui.rows.value[0].id
  f.registry.setLocalRoot(id, 'Imported')
  await f.ui.deviceScopes.change(id, [{ ...f.scopes[1], path: 'Imported/Sub' }])
  const child = f.ui.deviceScopes.state(id)!.current!.records[0]
  expect(f.registry.records().find((record) => record.id === child)).toMatchObject({
    localRoot: 'Imported/Sub',
    serverRoot: 'Shared/Sub',
  })
})

it.each(['restart', 'reselect'] as const)(
  'recovers activation after persisting current (%s)',
  async (action) => {
    const f = fixture()
    const pause = f.registry.setPaused.bind(f.registry)
    const interrupted = vi.spyOn(f.registry, 'setPaused').mockImplementation((id, paused) => {
      if (!paused) throw new Error('sample activation interrupted')
      pause(id, paused)
    })
    await expect(f.ui.connect(f.source, undefined, [f.scopes[0]])).rejects.toThrow(
      'sample activation interrupted'
    )
    const id = f.ui.rows.value[0].id
    expect(f.ui.deviceScopes.state(id)?.current).toBeDefined()
    const child = f.ui.deviceScopes.state(id)!.current!.records[0]
    expect(f.registry.records().find((record) => record.id === child)?.paused).toBe(true)
    interrupted.mockRestore()
    if (action === 'restart') await f.ui.deviceScopes.resume()
    else await f.ui.deviceScopes.change(id, [f.scopes[0]])
    expect(f.registry.records().find((record) => record.id === child)?.paused).toBe(false)
    expect(f.calls.filter((call) => call === 'POST /v2/tokens')).toHaveLength(1)
  }
)

it('preserves a later user pause when revisiting a fully activated scope', async () => {
  const f = fixture()
  await f.ui.connect(f.source, undefined, [f.scopes[0]])
  const id = f.ui.rows.value[0].id
  const child = f.ui.deviceScopes.state(id)!.current!.records[0]
  f.registry.setPaused(child, true)
  const item = f.ui.itemSets.store.get(id)!.items[0]
  f.ui.itemSets.store.pause(id, item.id, true)
  await f.ui.deviceScopes.resume()
  await f.ui.deviceScopes.change(id, [f.scopes[0]])
  expect(f.registry.records().find((record) => record.id === child)?.paused).toBe(true)
})

it.each(['restart', 'reselect'] as const)(
  'preserves a user item pause after activation effects but before completion (%s)',
  async (action) => {
    const f = fixture()
    vi.mocked(f.ui.connectionsChanged).mockRejectedValueOnce(new Error('sample host unavailable'))
    const selection = f.scopes.slice(0, 2)
    await expect(f.ui.connect(f.source, undefined, selection)).rejects.toThrow(
      'sample host unavailable'
    )
    const id = f.ui.rows.value[0].id
    expect(f.ui.deviceScopes.state(id)?.activating).toBe(true)
    const items = f.ui.itemSets.store.get(id)!.items
    expect(f.registry.records().find((record) => record.id === items[0].recordId)?.paused).toBe(
      false
    )
    await f.ui.itemSets.pauseItem(id, items[0].id, true)
    const owned = f.ui.deviceScopes.state(id)!.current
    let current = { ui: f.ui, registry: f.registry }
    if (action === 'restart') {
      await f.registry.flush()
      current = f.restart()
      expect(current.ui).not.toBe(f.ui)
      expect(current.registry).not.toBe(f.registry)
      await current.ui.deviceScopes.resume()
    } else await current.ui.deviceScopes.change(id, selection)
    expect(
      current.registry.records().find((record) => record.id === items[0].recordId)?.paused
    ).toBe(true)
    expect(current.ui.itemSets.store.get(id)!.items[0].paused).toBe(true)
    expect(
      current.registry.records().find((record) => record.id === items[1].recordId)?.paused
    ).toBe(false)
    expect(current.ui.deviceScopes.state(id)?.activating).toBeUndefined()
    expect(current.ui.deviceScopes.state(id)?.current).toEqual(owned)
    expect(f.calls.filter((call) => call === 'POST /v2/tokens')).toHaveLength(1)
  }
)

it('adopts equal group files after a fresh scoped ledger without downloading or rewriting them', async () => {
  const f = fixture()
  await f.ui.connect(f.source, undefined, [f.scopes[0]])
  f.addRemoteMember()
  const record = f.registry.records().find((one) => one.scope?.kind === 'group')!
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  for (const path of ['Reading.md', 'Remote/New member.md'])
    await fs.writeAtomic(path, f.content(path), 1)
  const write = vi.spyOn(fs, 'writeAtomic')
  const client = new V2EngineClient(f.ui.itemSets.encoded(record), { fetch: f.transport })
  await client.prepare(fs, state)
  const engine = new SyncEngine({ fs, state, client, selective: selectiveDefaults() })
  try {
    await engine.sync()
    expect(await state.get('Remote/New member.md')).not.toBeNull()
    expect(f.calls.filter((call) => call.includes('/content'))).toHaveLength(0)
    expect(write).not.toHaveBeenCalled()
  } finally {
    await engine.stop()
  }
})

it('issues whole-vault access without requiring unpublished local files first', async () => {
  const f = fixture()
  await f.ui.connect(f.source)
  const id = f.ui.rows.value[0].id
  f.ui.scopeInventory = () =>
    scopeInventory(Array.from({ length: 14000 }, (_, i) => ({ path: `Drafts/sample-${i}.md` })))
  const sync = vi
    .spyOn(f.ui, 'sync')
    .mockRejectedValue(new Error('publication must stay independent'))
  expect(
    f.ui.itemSets.notOnServer(id, [{ kind: 'vault', id: 'local:vault', path: '/' }])
  ).toBeNull()
  const path = 'Drafts/sample-0.md',
    bytes = new TextEncoder().encode('Retained local draft')
  const fs = new MemoryFileSystem()
  await fs.writeAtomic(path, bytes, 1)
  f.registry.storage(id).saveLocalStorage('abele-sync-token-state:local-only', [path])
  const copies = new LocalOnlyCopies(f.registry)
  const retire = vi.fn(async (held: (path: string) => boolean) => {
    expect(held(path)).toBe(true)
    expect(copies.has(path)).toBe(true)
    expect(await fs.read(path)).toEqual(bytes)
  })
  const release = vi.fn(async (connectionId: string, paths: string[]) => {
    await copies.assertPublishSafe(async (path) => !!(await fs.stat(path)))
    await copies.releaseSelected(connectionId, paths, retire)
  })
  f.ui.releaseLocalOnly = release
  const encoded = await f.ui.itemSets.issue(id, {
    items: [{ kind: 'vault', id: 'local:vault', path: '/' }],
    label: 'Sample whole-vault access',
    readOnly: false,
  })
  expect(decodeAccessToken(encoded)).toMatchObject({
    v: 2,
    items: [{ kind: 'folder', scope_id: 'root', path: '/' }],
  })
  expect(release).toHaveBeenCalledExactlyOnceWith(id, ['/'])
  expect(retire).toHaveBeenCalledOnce()
  expect(copies.has(path)).toBe(false)
  expect(await fs.read(path)).toEqual(bytes)
  expect(sync).not.toHaveBeenCalled()
})
