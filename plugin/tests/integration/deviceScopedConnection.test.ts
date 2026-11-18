import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { TokenUi } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { decodeAccessToken } from '@/sync/v2/client'
import { encodeAccessToken } from '@/sync/v2/contract'
import { scopeInventory } from '@/sync/deviceScopeInventory'
import {
  MemoryFileSystem,
  MemoryStateStore,
  V2EngineClient,
  SyncEngine,
  selectiveDefaults,
} from '@abele/sync-sdk/core'

function fixture() {
  const values = new Map<string, unknown>(),
    secrets = new Map<string, string>()
  const registry = TokenConnectionRegistry.open({
    loadLocalStorage: (key) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key, value) => {
      values.set(key, structuredClone(value))
    },
  })
  const root = { kind: 'folder' as const, id: 'root', path: '/' }
  const group = { kind: 'group' as const, id: 'group-note', path: 'Reading.md' }
  const folder = { kind: 'folder' as const, id: 'folder-a', path: 'Garden' }
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
  return {
    ui,
    registry,
    source,
    scopes,
    calls,
    revoked,
    transport,
    content,
    issueRequests,
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
