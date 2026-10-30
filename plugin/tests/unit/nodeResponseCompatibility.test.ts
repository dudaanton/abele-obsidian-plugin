import { describe, expect, it, vi } from 'vitest'
import { MemoryClientStore, NodeClient } from '@abele/node-client'
import { FrameCodec, responseSchema } from '@abele/channel-protocol'
import {
  NodeEventSchema,
  SessionSchema,
  TraceShapeSchema,
  validateParams,
} from '@abele/node-protocol'
import { z } from 'zod'
import { IDBFactory } from 'fake-indexeddb'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import { NodeClientStore } from '@/node/NodeClientStore'

const client = () =>
  new NodeClient(
    { url: 'ws://127.0.0.1:1/channel', profile: 'local-token-v1', token: 'sample-token' },
    new MemoryClientStore()
  )
const context = {
  run_id: 'sample-run',
  total_tokens: 100,
  max_tokens: 1000,
  percentage: 10,
  auto_compact_threshold: null,
  auto_compact_enabled: true,
  model: null,
  categories: [{ name: 'sample', tokens: 100, future_category: true }],
}
const session = {
  session_id: 'sample-session',
  title: 'Sample session',
  provider: 'fake',
  created_at: '2026-01-01T00:00:00.000Z',
  owner_stopped: false,
  stop_generation: 1,
  future_session: true,
}

describe('node response compatibility', () => {
  it('reads a 0.4.72 file observation with truncated and future nested fields', async () => {
    const c = client()
    vi.spyOn(c, 'request').mockResolvedValue({
      revision: {
        kind: 'working',
        observation_id: 'sample-observation',
        head: null,
        observed_at: '2026-01-01T00:00:00.000Z',
        future_revision: true,
      },
      atomic: false,
      truncated: true,
      future_observation: true,
    })
    await expect(c.repository.observe({ worktree_id: 'sample-worktree' })).resolves.toMatchObject({
      truncated: true,
      revision: { observation_id: 'sample-observation' },
    })
  })

  it('reads session state with context.run_id and future nested fields', async () => {
    const c = client()
    vi.spyOn(c, 'request').mockResolvedValue({
      session_id: session.session_id,
      live: true,
      process: 'idle',
      run_id: 'sample-run',
      turn: null,
      background_tasks: [],
      context,
      compacting: false,
      settings: {
        model: 'default',
        effort: 'default',
        account: 'default',
        permission_mode: 'manual',
        continue_after_compaction: true,
        continuation_text: 'Continue.',
        messaging: true,
        future_setting: true,
      },
      process_settings: null,
      restart_pending: false,
      watchers: 1,
      idle_since: null,
      future_state: true,
    })
    await expect(c.sessionState(session.session_id)).resolves.toMatchObject({
      context: { total_tokens: 100, run_id: 'sample-run' },
      process: 'idle',
    })
  })

  it('accepts future session fields in the SDK and the plugin transcript parser', async () => {
    const c = client()
    vi.spyOn(c, 'request').mockResolvedValue(session)
    await expect(c.getSession(session.session_id)).resolves.toMatchObject({ title: session.title })
    expect(
      reduceTranscript([
        {
          kind: 'event',
          node_id: 'sample-node',
          stream_id: session.session_id,
          seq: 1,
          type: 'session.created',
          actor: { kind: 'node' },
          at: session.created_at,
          data: session,
        },
      ]).session
    ).toMatchObject({ title: session.title })
  })

  it('accepts extra response envelope fields while rejecting unknown request fields', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ kind: 'response', request_id: 'sample-request', result: {}, future: true })
    )
    expect(FrameCodec.decode(bytes)).toMatchObject({ kind: 'response', result: {} })
    expect(() =>
      validateParams('workspace.read', {
        workspace_id: 'sample-workspace',
        path: 'sample.txt',
        future: true,
      })
    ).toThrow()
    expect(() =>
      FrameCodec.encode({
        kind: 'request',
        request_id: 'sample-request',
        method: 'node.describe',
        params: {},
        future: true,
      })
    ).toThrow()
  })

  it('still rejects malformed known response fields', async () => {
    const c = client()
    vi.spyOn(c, 'request').mockResolvedValue({ ...session, title: 42, future: true })
    await expect(c.getSession(session.session_id)).rejects.toThrow()
  })

  it('keeps new event fields through SDK ingestion, IndexedDB and transcript replay', async () => {
    const factory = new IDBFactory()
    const store = new NodeClientStore('sample-compatible-events', factory)
    const c = new NodeClient(client().target, store)
    await store.transaction((s) => {
      s.node_id = 'sample-node'
    })
    const event = {
      kind: 'event',
      node_id: 'sample-node',
      stream_id: session.session_id,
      seq: 1,
      type: 'session.created',
      actor: { kind: 'node', future_actor: true },
      at: session.created_at,
      data: session,
      future_event: true,
    }
    try {
      await c.ingest(event)
      await expect(
        c.ingest({ ...event, seq: 2, data: { ...session, title: 42 } })
      ).rejects.toThrow()
      expect(await c.cursor(session.session_id)).toBe(1)
      store.close()
      const restored = new NodeClientStore('sample-compatible-events', factory)
      try {
        const events = await restored.transaction((s) => s.events[session.session_id])
        expect(events[0].data).toMatchObject({ future_session: true })
        expect(reduceTranscript(events).session).toMatchObject({ title: session.title })
      } finally {
        restored.close()
      }
    } finally {
      store.close()
    }
  })

  it('accepts additions to live event payloads without bypassing their known-field checks', () => {
    const event = {
      kind: 'event',
      node_id: 'sample-node',
      stream_id: session.session_id,
      seq: 1,
      type: 'session.context',
      actor: { kind: 'node' },
      at: session.created_at,
      data: { ...context, future_context: true },
    }
    expect(responseSchema(NodeEventSchema).safeParse(event).success).toBe(true)
    expect(
      responseSchema(NodeEventSchema).safeParse({
        ...event,
        data: { ...context, max_tokens: 'bad' },
      }).success
    ).toBe(false)
  })

  it('reads extra LSP location fields but rejects extra outgoing position fields before sending', async () => {
    const c = client()
    const position = { line: 0, character: 0 }
    const request = vi.spyOn(c, 'request').mockResolvedValue({
      locations: [
        {
          path: 'sample.ts',
          range: { start: { ...position, future: true }, end: position, future: true },
          future: true,
        },
      ],
      future: true,
    })
    await expect(
      c.lsp.definition({ workspace_id: 'sample-workspace' }, 'sample.ts', position)
    ).resolves.toHaveLength(1)
    request.mockClear()
    const futurePosition = { ...position, future: true }
    await expect(
      c.lsp.definition({ workspace_id: 'sample-workspace' }, 'sample.ts', futurePosition)
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('handles additions in recursive recorded shapes and keeps size and scalar constraints', () => {
    const schema = responseSchema(TraceShapeSchema)
    expect(
      schema.parse({ type: 'object', future: true, children: [{ type: 'number', future: true }] })
    ).toEqual({ type: 'object', children: [{ type: 'number' }] })
    expect(
      schema.safeParse({ type: 'object', children: [{ type: 42, future: true }] }).success
    ).toBe(false)
    const bounded = responseSchema(
      z.array(z.object({ value: z.number().positive() }).strict()).max(1)
    )
    expect(bounded.safeParse([{ value: -1, future: true }]).success).toBe(false)
    expect(bounded.safeParse([{ value: 1 }, { value: 2 }]).success).toBe(false)
  })

  it('keeps default factories lazy and their objects independent between responses', () => {
    let calls = 0
    const schema = responseSchema(
      z
        .object({
          details: z.record(z.string(), z.unknown()).default(() => {
            calls++
            return {}
          }),
        })
        .strict()
    )
    expect(calls).toBe(0)
    const first = schema.parse({ future: true })
    const second = schema.parse({ future: true })
    first.details.sample = true
    expect(second.details).toEqual({})
    expect(calls).toBe(2)
  })

  it('retains response refinements and leaves the shared request schema unchanged', () => {
    const object = z
      .object({ start: z.number(), end: z.number() })
      .strict()
      .refine((v) => v.end >= v.start)
    const schema = responseSchema(z.record(z.string(), object.optional()))
    expect(schema.parse({ sample: { start: 1, end: 2, future: true } })).toEqual({
      sample: { start: 1, end: 2 },
    })
    expect(schema.safeParse({ sample: { start: 2, end: 1, future: true } }).success).toBe(false)
    expect(object.safeParse({ start: 1, end: 2, future: true }).success).toBe(false)
    expect(responseSchema(SessionSchema).safeParse({ ...session, provider: 'acp' }).success).toBe(
      false
    )
  })
})
