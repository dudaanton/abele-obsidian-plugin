import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { TokenUi } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { decodeAccessToken } from '@/sync/v2/client'
import { encodeAccessToken } from '@/sync/v2/contract'
import { scopeInventory } from '@/sync/deviceScopeInventory'
import type { DeviceScopeLease } from '@/sync/deviceScopeLease'
import {
  MemoryFileSystem,
  MemoryStateStore,
  V2EngineClient,
  SyncEngine,
  selectiveDefaults,
} from '@abele/sync-sdk/core'

function fixture(rootPath = '/', folderPath = 'Garden') {
  const values = new Map<string, unknown>(),
    secrets = new Map<string, string>()
  const storage = {
    loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, structuredClone(value))
    },
  }
  const root = { kind: 'folder' as const, id: 'root', path: rootPath }
  const group = { kind: 'group' as const, id: 'group-note', path: 'Reading.md' }
  const folder = { kind: 'folder' as const, id: 'folder-a', path: folderPath }
  const file = { kind: 'file' as const, id: 'file-a', path: 'Plan.md' }
  const scopes = [group, folder, file]
  const items = scopes.map((scope, index) => ({
    id: 'item-' + index,
    scope_id: scope.id,
    scope,
    added_at: '2025-01-01T00:00:00Z',
    removed_at: null,
  }))
  const source = encodeAccessToken({
    v: 1,
    address: 'https://sync.example',
    key: 'a'.repeat(43),
    scope: root,
  })
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
  let remoteMembers = ['Reading.md']
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
        scope: sourceKey ? root : selected.scope,
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
          : remoteMembers.map((path) => fileItem(path)),
        cursor: 1,
        next: null,
      })
    if (url.pathname === '/v2/connection/items')
      return Response.json({ items: sourceKey ? [] : chosen })
    if (url.pathname === '/v2/tokens' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      issueRequests.push(body)
      issued = true
      chosen = [items.find((item) => item.scope.id === body.scope.id)!]
      return Response.json({
        token: owned,
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
