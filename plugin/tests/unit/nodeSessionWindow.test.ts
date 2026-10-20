/**
 * A long node session opens at its end: the device keeps only a window of its latest events,
 * starts reading near the journal's head instead of replaying it, and fetches older pages only
 * when asked. A node that cannot say where its journal ends is read as before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { MemoryClientStore, NodeClient } from '@abele/node-client'
import { ChannelError } from '@abele/channel-protocol'
import type { JournalEvent } from '@abele/channel-protocol'
import { giantJournal } from '../fixtures/giantJournal.mjs'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { NodeConnection } from '@/node/NodeService'
import type { NodeClientState } from '@/node/NodeClientStore'
import { SESSION_WINDOW, catchUp, openWindow, readOlder, trimWindows } from '@/node/sessionWindow'

const SID = 'sample-giant-session'
const journal = giantJournal({ turns: 300, node: 'sample-node', stream: SID }) as JournalEvent[]
const HEAD = journal.length

/** A connected client whose node holds `journal`; the store and the node's answers are real
 *  enough to drive the window, and every request is recorded. */
function fixture(options: { head?: boolean; stored?: JournalEvent[] } = {}) {
  const store = new MemoryClientStore()
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: 'sample-token' },
    store
  )
  const requests: { method: string; params: Record<string, unknown> }[] = []
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true)
  vi.spyOn(client, 'request').mockImplementation(async (method, raw) => {
    const params = raw as Record<string, unknown>
    requests.push({ method, params })
    if (method === 'stream.head') {
      if (options.head === false) throw new ChannelError('unsupported_method')
      return { head_seq: HEAD }
    }
    if (method === 'stream.read') {
      const after = Number(params.after_seq)
      return journal.filter((e) => e.seq > after).slice(0, Number(params.limit ?? 256))
    }
    if (method === 'stream.subscribe') return { head_seq: HEAD }
    if (method === 'session.get') return journal[0].data
    if (method === 'node.describe') return { providers: [] }
    if (method === 'session.state') return { live: false }
    throw new Error('Unexpected request ' + method)
  })
  return { store, client, requests, stored: options.stored }
}

afterEach(() => vi.restoreAllMocks())

it('keeps visible turns when the device event window advances between refreshes', async () => {
  const f = fixture()
  const p = new NodeChatPresenter(
    {
      kind: 'node-session',
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      sessionId: SID,
      title: 'Sample',
    },
    { client: f.client, state: ref('offline'), error: ref('') } as unknown as NodeConnection
  )
  try {
    await f.store.transaction((s) => {
      s.events[SID] = journal.slice(0, 100)
    })
    await p.refresh()
    const shown = p.messages.value.map((m) => ({ ...m }))
    await f.store.transaction((s) => {
      s.events[SID] = journal.slice(90, 200)
    })
    await p.refresh()
    for (const message of shown) expect(p.messages.value).toContainEqual(message)
    expect(p.hasOlder.value).toBe(false)
  } finally {
    p.destroy()
  }
})

it('holds the visible transcript across an offline event gap and fills it on reconnect', async () => {
  const f = fixture()
  const online = vi.mocked(Object.getOwnPropertyDescriptor(f.client, 'connected')!.get!)
  const p = new NodeChatPresenter(
    {
      kind: 'node-session',
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      sessionId: SID,
      title: 'Sample',
    },
    { client: f.client, state: ref('offline'), error: ref('') } as unknown as NodeConnection
  )
  try {
    await f.store.transaction((s) => {
      s.events[SID] = journal.slice(0, 50)
    })
    await p.refresh()
    const shown = p.messages.value
    online.mockReturnValue(false)
    await f.store.transaction((s) => {
      s.events[SID] = journal.slice(100, 150)
    })
    await expect(p.refresh()).rejects.toThrow('earlier messages')
    expect(p.messages.value).toBe(shown)
    online.mockReturnValue(true)
    await p.refresh()
    expect(f.requests).toContainEqual({
      method: 'stream.read',
      params: { stream_id: SID, after_seq: 50, limit: 50 },
    })
    const expected = journal.slice(0, 150).filter((e) => e.type === 'input.accepted').length
    expect(p.messages.value.filter((m) => m.role === 'user')).toHaveLength(expected)
  } finally {
    p.destroy()
  }
})

describe('trimWindows', () => {
  it('keeps only the latest events of a windowed stream, and nothing of others', () => {
    const state = {
      cursors: { [SID]: HEAD, other: 3 },
      events: { [SID]: journal.slice(), other: journal.slice(0, 3) },
      outbox: [],
      results: {},
      windows: { [SID]: 100 },
    } as unknown as NodeClientState
    trimWindows(state)
    expect(state.events[SID].map((e) => e.seq)).toEqual(journal.slice(-100).map((e) => e.seq))
    expect(state.events.other).toHaveLength(3)
    expect(state.cursors[SID]).toBe(HEAD)
  })
})

describe('openWindow', () => {
  it('starts a new device near the head instead of replaying the journal', async () => {
    const f = fixture()
    const start = await openWindow(f.client, SID)
    expect(start).toEqual({ head: HEAD, from: HEAD - SESSION_WINDOW + 1, jumped: true })
    expect(await f.client.cursor(SID)).toBe(HEAD - SESSION_WINDOW)
    expect(await f.store.transaction((s) => (s as NodeClientState).windows?.[SID])).toBe(
      SESSION_WINDOW
    )
  })

  it('drops what a device kept from long ago when the session went far beyond it', async () => {
    const f = fixture()
    await f.store.transaction((s) => {
      s.cursors[SID] = 20
      s.events[SID] = journal.slice(0, 20)
    })
    await openWindow(f.client, SID)
    expect(await f.client.cursor(SID)).toBe(HEAD - SESSION_WINDOW)
    expect(await f.client.history(SID)).toEqual([])
  })

  it('keeps a device that is close behind where it is: it reads only what it missed', async () => {
    const f = fixture()
    const near = HEAD - 10
    await f.store.transaction((s) => {
      s.cursors[SID] = near
      s.events[SID] = journal.slice(near - 50, near)
    })
    expect(await openWindow(f.client, SID)).toEqual({ head: HEAD, from: near - 49, jumped: false })
    expect(await f.client.cursor(SID)).toBe(near)
  })

  it('reads the whole journal as before from a node that cannot say where it ends', async () => {
    const f = fixture({ head: false })
    expect(await openWindow(f.client, SID)).toBeNull()
    expect(await f.client.cursor(SID)).toBe(0)
  })
})

describe('catchUp', () => {
  it('keeps what the device missed in one go and leaves it alone when the cursor moved meanwhile', async () => {
    const f = fixture()
    await f.store.transaction((s) => {
      s.node_id = 'sample-node'
      s.cursors[SID] = HEAD - 10
    })
    expect(await catchUp(f.client, SID, HEAD)).toBe(10)
    expect(await f.client.cursor(SID)).toBe(HEAD)
    expect((await f.client.history(SID)).map((e) => e.seq)).toEqual(
      journal.slice(-10).map((e) => e.seq)
    )
    const moved = fixture()
    await moved.store.transaction((s) => {
      s.node_id = 'sample-node'
      s.cursors[SID] = HEAD - 10
    })
    vi.spyOn(moved.client, 'cursor').mockResolvedValueOnce(HEAD - 20)
    expect(await catchUp(moved.client, SID, HEAD)).toBe(0)
    expect(await moved.client.cursor(SID)).toBe(HEAD - 10)
  })
})

describe('readOlder', () => {
  it('reads the page just before the earliest event held, never more than a page', async () => {
    const f = fixture()
    const page = await readOlder(f.client, SID, 1000)
    expect(page.map((e) => e.seq)).toEqual(Array.from({ length: 256 }, (_, i) => 1000 - 256 + i))
    expect(f.requests.at(-1)).toEqual({
      method: 'stream.read',
      params: { stream_id: SID, after_seq: 1000 - 257, limit: 256 },
    })
    expect((await readOlder(f.client, SID, 10)).map((e) => e.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ])
    expect(await readOlder(f.client, SID, 1)).toEqual([])
  })
})

describe('a giant session in its chat', () => {
  const presenter = (f: ReturnType<typeof fixture>) =>
    new NodeChatPresenter(
      {
        kind: 'node-session',
        nodeId: 'sample-node',
        registrationId: 'sample-registration',
        sessionId: SID,
        title: 'Sample long session',
      },
      {
        client: f.client,
        state: ref('connected'),
        error: ref(''),
        connect: async () => {},
      } as unknown as NodeConnection
    )

  it('opens at its end with the session known, and loads earlier pages as asked', async () => {
    const f = fixture()
    await f.store.transaction((s) => {
      s.node_id = 'sample-node'
    })
    const p = presenter(f)
    try {
      await p.load()
      // The window came in pages kept at once; the subscription starts at the head.
      expect(
        f.requests.filter((r) => r.method === 'stream.read').map((r) => r.params.after_seq)
      ).toEqual([HEAD - SESSION_WINDOW, HEAD - SESSION_WINDOW + 256])
      expect(f.requests.filter((r) => r.method === 'stream.subscribe').at(-1)?.params).toEqual({
        stream_id: SID,
        after_seq: HEAD,
      })
      expect(p.provider.value).toBe('claude')
      expect(p.hasOlder.value).toBe(true)
      const shown = p.messages.value.length
      expect(p.messages.value.at(-1)?.content).toContain('Answer 300.')
      await p.loadOlder()
      expect(p.messages.value.length).toBeGreaterThan(shown)
      expect(
        f.requests
          .filter((r) => r.method === 'stream.read')
          .map((r) => r.params.after_seq)
          .at(-1)
      ).toBe(HEAD - SESSION_WINDOW - 256)
      // Never more than the window is kept on the device.
      expect((await f.client.history(SID)).length).toBeLessThanOrEqual(SESSION_WINDOW)
    } finally {
      p.destroy()
    }
  })

  it("says a failed earlier page on its own line, not in the chat's error", async () => {
    const f = fixture()
    await f.store.transaction((s) => {
      s.node_id = 'sample-node'
    })
    const p = presenter(f)
    try {
      await p.load()
      vi.mocked(f.client.request).mockRejectedValueOnce(new Error('Sample timeout'))
      await p.loadOlder()
      expect(p.olderState.value).toBe('failed')
      expect(p.olderError.value).toBe('Sample timeout')
      expect(p.error.value).toBe('')
    } finally {
      p.destroy()
    }
  })

  it('starts again at the window on a node that says where its journal ends only when subscribed', async () => {
    const f = fixture({ head: false })
    await f.store.transaction((s) => {
      s.node_id = 'sample-node'
    })
    const p = presenter(f)
    try {
      await p.load()
      expect(
        f.requests.filter((r) => r.method === 'stream.subscribe').map((r) => r.params.after_seq)
      ).toEqual([0, HEAD])
      expect(await f.client.cursor(SID)).toBe(HEAD)
      expect((await f.client.history(SID)).length).toBe(SESSION_WINDOW)
    } finally {
      p.destroy()
    }
  })
})
