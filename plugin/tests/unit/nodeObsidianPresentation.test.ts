import { expect, it } from 'vitest'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import type { JournalEvent } from '@abele/channel-protocol'
const event = (seq: number, data: Record<string, unknown>): JournalEvent => ({
  kind: 'event',
  node_id: 'sample-node',
  stream_id: 'sample-session',
  actor: { kind: 'node' },
  at: '2025-01-01T00:00:00.000Z',
  seq,
  type: 'obsidian.tools.updated',
  data,
})

it('only places the device code on calls that reached execution', () => {
  for (const state of ['preparing', 'ready', 'awaiting_approval', 'denied', 'cancelled']) {
    const projection = reduceTranscript([
      event(1, {
        invocation_id: 'sample-call',
        tool_name: 'create',
        arguments: { path: 'sample.md' },
        state,
        preview: { device: 'Sample remote' },
      }),
    ])
    expect(projection.messages[0].toolDevice).toBeUndefined()
  }
})

it('uses one ordinary row for a trusted Obsidian bridge call while retaining later unmatched native calls', () => {
  const args = { path: 'sample.md', content: 'Sample text' }
  const native = (seq: number, id: string): JournalEvent => ({
    ...event(seq, {}),
    type: 'claude.tool.call',
    data: {
      run_id: 'sample-run',
      tool_use_id: id,
      name: 'mcp__abele_debugger__obsidian_create',
      input: args,
    },
  })
  const update = {
    invocation_id: 'sample-invocation',
    run_id: 'sample-run',
    tool_name: 'create',
    arguments: args,
    state: 'preparing',
  }
  const calls = reduceTranscript([
    native(1, 'first'),
    event(2, update),
    native(3, 'later'),
    event(4, { ...update, state: 'ready' }),
  ]).messages.filter((message) => message.role === 'tool-call')
  expect(calls).toHaveLength(2)
  expect(calls[0].toolName).toBe('create')
  expect(calls[1].toolName).toBe('mcp__abele_debugger__obsidian_create')
})
it('projects node Obsidian calls as ordinary create text and edit diffs without executing during replay', () => {
  const base = {
    invocation_id: 'sample-call',
    tool_name: 'create',
    state: 'awaiting_approval',
    arguments: { path: 'sample.md', content: 'Sample text' },
    preview: { path: 'sample.md', diff: { old: '', new: 'Sample text' } },
  }
  const pending = reduceTranscript([event(1, base)])
  expect(pending.messages[0]).toMatchObject({
    role: 'tool-call',
    toolName: 'create',
    toolParams: base.arguments,
    toolStatus: 'pending',
  })
  const complete = reduceTranscript([
    event(1, base),
    event(2, {
      ...base,
      state: 'succeeded',
      result: {
        content: [{ type: 'text', text: 'Created' }],
        details: { diff: { old: '', new: 'Sample text' }, path: 'sample.md' },
      },
    }),
  ])
  expect(complete.messages).toHaveLength(1)
  expect(complete.messages[0].toolDiff).toEqual({ old: '', new: 'Sample text' })
  expect(complete.messages[0].toolResult).toBe('Created')
})
