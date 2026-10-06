import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeRegistry, channelUrl } from '@/node/NodeRegistry'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import type { JournalEvent } from '@abele/channel-protocol'

const event = (seq: number, type: string, data: unknown): JournalEvent => ({
  kind: 'event',
  node_id: 'sample-node',
  stream_id: 'sample-session',
  seq,
  type,
  actor: { kind: 'node' },
  at: '2025-01-01T00:00:00.000Z',
  data,
})

describe('node transcript', () => {
  it('projects replay once, joins streaming chunks and resolves attention without rewriting history', () => {
    const prompt = {
      kind: 'permission',
      prompt_id: 'p',
      session_id: 'sample-session',
      run_id: 'r',
      revision: 1,
      action_digest: 'a'.repeat(64),
      expires_at: 9999999999999,
      state: 'pending',
      choice: null,
      installation_id: null,
      delivered: false,
    }
    const events = [
      event(1, 'input.accepted', { input_id: 'i', text: 'Hello' }),
      event(2, 'run.started', { run_id: 'r', input_id: 'i' }),
      event(3, 'content.delta', { run_id: 'r', text: 'One ' }),
      event(4, 'content.delta', { run_id: 'r', text: 'answer' }),
      event(5, 'prompt.opened', prompt),
    ]
    const projected = reduceTranscript([...events, events[3]])
    expect(projected.messages.map((m) => m.content)).toEqual(['Hello', 'One answer'])
    expect(projected.state).toBe('needs-attention')
    expect(projected.prompts).toHaveLength(1)
    const done = reduceTranscript([
      ...events,
      event(6, 'prompt.resolved', { ...prompt, state: 'resolved', choice: 'deny' }),
      event(7, 'run.completed', { run_id: 'r' }),
    ])
    expect(done.state).toBe('idle')
    expect(done.prompts[0].choice).toBe('deny')
    expect(done.messages).toEqual(projected.messages)
  })

  it('keeps queue state separate from active run and preserves unknown records and artifacts', () => {
    const projection = reduceTranscript([
      event(1, 'run.started', { run_id: 'r' }),
      event(2, 'input.queued', { input_id: 'i', state: 'queued' }),
      event(3, 'content.delta', { run_id: 'r', artifact_id: 'a', size: 9000 }),
      event(4, 'future.record', { extra: true }),
    ])
    expect(projection.state).toBe('running')
    expect(projection.artifacts).toEqual([{ messageId: 'run:r', artifactId: 'a', size: 9000 }])
    expect(projection.unknown).toHaveLength(1)
    expect(
      reduceTranscript([event(1, 'input.accepted', { input_id: 'i', text: 'hi' })]).state
    ).toBe('accepted')
    expect(
      reduceTranscript([event(1, 'input.queued', { input_id: 'i', state: 'queued' })]).state
    ).toBe('queued')
  })

  it('renders tool results on their correlated call without a local tool execution', () => {
    const projection = reduceTranscript([
      event(1, 'tool.started', { tool_call_id: 't', name: 'read', params: { path: 'sample.txt' } }),
      event(2, 'tool.completed', { tool_call_id: 't', result: 'sample content' }),
    ])
    expect(projection.messages[0]).toMatchObject({
      role: 'tool-call',
      toolName: 'read',
      toolResult: 'sample content',
      toolStatus: 'approved',
    })
  })
})

describe('installation-local store', () => {
  it('commits cursor and events atomically, rolls back asynchronous failures and survives reopening', async () => {
    const factory = new IDBFactory()
    const store = new NodeClientStore('sample-installation', factory)
    await store.transaction((s) => {
      s.node_id = 'sample-node'
      s.cursors.s = 1
      s.events.s = [event(1, 'future.record', {})]
    })
    await expect(
      store.transaction(async (s) => {
        s.cursors.s = 2
        await new Promise((r) => setTimeout(r, 5))
        throw new Error('disk failure')
      })
    ).rejects.toThrow('disk failure')
    store.close()
    const restored = new NodeClientStore('sample-installation', factory)
    expect(await restored.transaction((s) => [s.cursors.s, s.events.s.length])).toEqual([1, 1])
    restored.close()
  })

  it('serializes across independent handles and isolates installations', async () => {
    const factory = new IDBFactory()
    const a = new NodeClientStore('one', factory)
    const b = new NodeClientStore('one', factory)
    await Promise.all([
      a.transaction(async (s) => {
        await new Promise((r) => setTimeout(r, 5))
        s.cursors.s = (s.cursors.s ?? 0) + 1
      }),
      b.transaction((s) => {
        s.cursors.s = (s.cursors.s ?? 0) + 1
      }),
    ])
    expect(await a.transaction((s) => s.cursors.s)).toBe(2)
    const other = new NodeClientStore('two', factory)
    expect(await other.transaction((s) => s.cursors.s)).toBeUndefined()
    a.close()
    b.close()
    other.close()
  })
})

describe('node registry', () => {
  it('uses only explicit loopback URLs', () => {
    expect(channelUrl('http://127.0.0.1:7777')).toBe('ws://127.0.0.1:7777/channel')
    for (const url of [
      'http://localhost:7777',
      'http://192.0.2.1:7777',
      'https://127.0.0.1:7777',
      'http://127.0.0.1:7777/path',
      'http://127.0.0.1:7777?token=x',
      'http://user@127.0.0.1:7777',
      'http://2130706433:7777',
    ])
      expect(() => channelUrl(url)).toThrow()
  })

  it('persists labels and pinned identity without credentials and forgets only the local key', () => {
    let data: unknown = null
    const keys = new Map<string, string>()
    const host = {
      read: () => data,
      write: (value: unknown) => {
        data = value
      },
      getSecret: (id: string) => keys.get(id) ?? '',
      setSecret: (id: string, value: string) => {
        keys.set(id, value)
      },
      removeSecret: (id: string) => {
        keys.delete(id)
      },
    }
    const registry = new NodeRegistry(host)
    registry.add(
      {
        id: 'one',
        label: 'Sample node',
        url: 'http://127.0.0.1:7777',
        expectedNodeId: 'sample-node',
      },
      'sample-token'
    )
    registry.add(
      {
        id: 'two',
        label: 'Other node',
        url: 'http://127.0.0.1:8888',
        expectedNodeId: 'other-node',
      },
      'other-token'
    )
    expect(JSON.stringify(data)).not.toContain('sample-token')
    expect(new NodeRegistry(host).list()).toHaveLength(2)
    expect(registry.token('one')).toBe('sample-token')
    registry.remove('one')
    expect(keys.size).toBe(1)
    expect(registry.list()[0].expectedNodeId).toBe('other-node')
  })
})
