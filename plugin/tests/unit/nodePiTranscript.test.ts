import { expect, it } from 'vitest'
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
it('replaces pi partials with final snapshots and separates runtime generations and runs', () => {
  const base = { run_id: 'sample-run', runtime_generation: 1, message_id: '1' }
  const partial = event(1, 'pi.message.delta', {
    ...base,
    delta: { type: 'text_delta', contentIndex: 0, delta: 'Partial' },
  })
  const final = event(2, 'pi.message.final', {
    ...base,
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Final answer' },
        { type: 'thinking', thinking: 'Sample reasoning' },
      ],
    },
  })
  const projection = reduceTranscript([
    partial,
    final,
    partial,
    event(3, 'pi.message.delta', {
      ...base,
      delta: { type: 'text_delta', contentIndex: 0, delta: 'late' },
    }),
    event(4, 'pi.message.final', {
      ...base,
      runtime_generation: 2,
      message: { role: 'assistant', content: [{ type: 'text', text: 'New runtime' }] },
    }),
    event(5, 'pi.message.final', {
      ...base,
      run_id: 'other-run',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Follow-up' }] },
    }),
  ])
  expect(projection.messages.map((m) => m.content)).toEqual([
    'Final answer',
    'New runtime',
    'Follow-up',
  ])
  expect(projection.messages[0].thinking).toBe('Sample reasoning')
})
it('clears obsolete partial text when the final snapshot contains only a tool call', () => {
  const scope = { run_id: 'sample-run', runtime_generation: 1, message_id: '1' }
  const projection = reduceTranscript([
    event(1, 'pi.message.delta', {
      ...scope,
      delta: { type: 'text_delta', contentIndex: 0, delta: 'Obsolete partial' },
    }),
    event(2, 'pi.message.final', {
      ...scope,
      message: {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'sample-call', name: 'read', arguments: { path: 'sample.txt' } },
        ],
      },
    }),
  ])
  expect(projection.messages.find((m) => m.role === 'assistant')!.content).toBe('')
  expect(projection.messages.find((m) => m.role === 'tool-call')!.toolName).toBe('read')
})

it('correlates parallel pi tools, replacing cumulative updates and keeping errors and late evidence', () => {
  const base = { run_id: 'sample-run', runtime_generation: 1 }
  const projection = reduceTranscript([
    event(1, 'pi.tool.call', {
      ...base,
      tool_use_id: 'a',
      name: 'read',
      input: { path: 'sample.txt' },
    }),
    event(2, 'pi.tool.call', {
      ...base,
      tool_use_id: 'b',
      name: 'bash',
      input: { command: 'sample' },
    }),
    event(3, 'pi.tool.update', {
      ...base,
      tool_use_id: 'a',
      result: { content: [{ type: 'text', text: 'Part' }] },
    }),
    event(4, 'pi.tool.result', {
      ...base,
      tool_use_id: 'b',
      result: { content: [{ type: 'text', text: 'Failure' }] },
      is_error: true,
    }),
    event(5, 'pi.tool.result', {
      ...base,
      tool_use_id: 'a',
      result: { content: [{ type: 'text', text: 'Full result' }] },
    }),
    event(6, 'pi.message.final', {
      ...base,
      message_id: '1',
      late: true,
      message: { role: 'assistant', content: [{ type: 'text', text: 'Late' }] },
    }),
    event(7, 'pi.message.final', { ...base, artifact_id: 'sample-artifact', size: 9000 }),
  ])
  expect(projection.messages.map((m) => [m.toolName, m.toolResult, m.toolStatus])).toEqual([
    ['read', 'Full result', 'approved'],
    ['bash', 'Failure', 'rejected'],
  ])
  expect(projection.unknown).toHaveLength(2)
  expect(projection.artifacts).toEqual([
    { messageId: 'event:7', artifactId: 'sample-artifact', size: 9000 },
  ])
})
