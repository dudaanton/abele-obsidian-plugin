import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeClient } from '@abele/node-client'
import { NodeEventSchema } from '@abele/node-protocol'

const event = (seq: number, path = 'sample.ts', root = 'sample-root') =>
  NodeEventSchema.parse({
    kind: 'event',
    node_id: 'sample-node',
    stream_id: 'catalog',
    seq,
    type: 'lsp.diagnostics',
    actor: { kind: 'node' },
    at: '2026-01-01T00:00:00.000Z',
    data: { workspace_id: root, path, diagnostics: [] },
  })

it('retains current diagnostics per file and root without dropping control events or cursor progress', async () => {
  const store = new NodeClientStore('sample-diagnostics', new IDBFactory())
  const client = new NodeClient(
    { profile: 'local-token-v1', url: 'ws://localhost', token: 'sample' },
    store
  )
  const received = vi.fn()
  const unsubscribe = client.onEvent(received)
  try {
    await store.transaction((s) => {
      s.node_id = 'sample-node'
    })
    const control = { ...event(2), type: 'sample.control', data: { value: 'retain' } }
    for (const item of [
      event(1),
      control,
      event(3, 'other.ts'),
      event(4, 'sample.ts', 'other-root'),
      event(5),
    ])
      await client.ingest(item)
    expect(received).toHaveBeenCalledTimes(5)
    expect(await store.read((s) => s.events.catalog.map((e) => e.seq))).toEqual([2, 3, 4, 5])
    expect(await client.cursor('catalog')).toBe(5)
    await client.ingest(event(5))
    expect(received).toHaveBeenCalledTimes(5)
  } finally {
    unsubscribe()
    store.close()
  }
})

it('compacts an existing diagnostic history on reopening and persists it on the next transaction', async () => {
  const factory = new IDBFactory()
  const name = 'sample-old-diagnostics'
  const events = Array.from({ length: 200 }, (_, i) => ({
    ...event(i + 1),
    data: {
      workspace_id: 'sample-root',
      path: 'sample.ts',
      diagnostics: [
        {
          message: 'Sample diagnostic '.repeat(200),
          source: 'sample',
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        },
      ],
    },
  }))
  for (const item of events) NodeEventSchema.parse(item)
  await new Promise<void>((resolve, reject) => {
    const open = factory.open(`abele-node-${name}`, 3)
    open.onupgradeneeded = () => {
      const client = open.result.createObjectStore('client')
      client.put({ cursors: { catalog: 200 }, events: {}, outbox: [], results: {} }, 'state')
      client.put({ catalog: 'sample-revision' }, 'streams')
      open.result.createObjectStore('journal').put(events, 'catalog')
    }
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      open.result.close()
      resolve()
    }
  })
  const store = new NodeClientStore(name, factory)
  const put = vi.spyOn(IDBObjectStore.prototype, 'put')
  try {
    expect(await store.read((s) => s.events.catalog.map((e) => e.seq))).toEqual([200])
    expect(put).not.toHaveBeenCalled()
    const bytes = await store.read((s) => JSON.stringify(s.events.catalog).length)
    expect(bytes).toBeLessThan(JSON.stringify(events).length / 100)
    await expect(
      store.transaction(() => {
        throw new Error('sample rollback')
      })
    ).rejects.toThrow('sample rollback')
    expect(put).not.toHaveBeenCalled()
    await store.transaction(() => {})
    expect(
      put.mock.calls.some(
        ([value, key]) => key === 'catalog' && Array.isArray(value) && value.length === 1
      )
    ).toBe(true)
    const reopened = new NodeClientStore(name, factory)
    try {
      expect(await reopened.read((s) => s.events.catalog.map((e) => e.seq))).toEqual([200])
      expect(await reopened.read((s) => s.cursors.catalog)).toBe(200)
    } finally {
      reopened.close()
    }
  } finally {
    put.mockRestore()
    store.close()
  }
})

it('keeps workspace and worktree diagnostics separate and preserves unknown payloads', async () => {
  const store = new NodeClientStore('sample-diagnostic-identities', new IDBFactory())
  const workspace = event(1)
  const worktree = {
    ...event(2),
    data: { worktree_id: 'sample-root', path: 'sample.ts', diagnostics: [] },
  }
  const unknown = { ...event(3), data: { path: 'sample.ts', diagnostics: [] } }
  try {
    await store.transaction((s) => {
      s.events.catalog = [workspace, worktree, unknown, event(4)]
    })
    expect(await store.read((s) => s.events.catalog.map((e) => e.seq))).toEqual([2, 3, 4])
    await expect(
      store.transaction((s) => {
        s.events.catalog.push(event(5))
        throw new Error('sample rollback')
      })
    ).rejects.toThrow('sample rollback')
    expect(await store.read((s) => s.events.catalog.map((e) => e.seq))).toEqual([2, 3, 4])
  } finally {
    store.close()
  }
})
