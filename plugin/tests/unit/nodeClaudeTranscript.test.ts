import { expect, it } from 'vitest'
import type { JournalEvent } from '@abele/channel-protocol'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import { toolSummary } from '@/ai/toolLine'
it('shows a short Claude tool argument summary on the shared row', () => {
  expect(toolSummary({ toolName: 'Read', toolParams: { file_path: 'sample.txt' } })).toBe(
    'sample.txt'
  )
  expect(toolSummary({ toolName: 'Bash', toolParams: { command: 'git status' } })).toBe(
    'git status'
  )
  expect(toolSummary({ toolName: 'Agent', toolParams: { description: 'Sample child' } })).toBe(
    'Sample child'
  )
})
const e = (seq: number, type: string, data: unknown): JournalEvent => ({
  kind: 'event',
  node_id: 'sample',
  stream_id: 'session',
  seq,
  type,
  data,
  actor: { kind: 'node' },
  at: '2025-01-01T00:00:00.000Z',
})

it('reconciles block finals without duplication, scopes native IDs to runs and keeps child work grouped', () => {
  const projection = reduceTranscript([
    e(1, 'run.started', { run_id: 'r' }),
    e(2, 'claude.block.delta', { run_id: 'r', message_id: 'm', index: 0, text: 'Partial' }),
    e(3, 'claude.message.final', {
      run_id: 'r',
      message_id: 'm',
      role: 'assistant',
      content: [{ type: 'text', text: '**Final**' }],
      block_indices: [0],
      finalized_indices: [0],
    }),
    e(4, 'claude.tool.call', {
      run_id: 'r',
      tool_use_id: 't',
      name: 'Agent',
      input: { description: 'Sample child task' },
    }),
    e(5, 'claude.message.final', {
      run_id: 'r',
      message_id: 'child',
      parent_tool_use_id: 't',
      role: 'assistant',
      content: [{ type: 'text', text: 'Child answer' }],
    }),
    e(6, 'run.completed', { run_id: 'r' }),
    e(7, 'run.started', { run_id: 'next' }),
    e(8, 'claude.block.delta', { run_id: 'next', message_id: 'm', index: 0, text: 'Next answer' }),
  ])
  expect(projection.messages.filter((m) => m.role === 'assistant').map((m) => m.content)).toEqual([
    '**Final**',
    'Next answer',
  ])
  expect(
    Object.values(projection.children)
      .flat()
      .map((m) => m.content)
  ).toEqual(['Child answer'])
})

it('renders successful edits as diffs, correlated results and honest collapsed thinking', () => {
  const projection = reduceTranscript([
    e(1, 'claude.tool.call', {
      run_id: 'r',
      tool_use_id: 't',
      name: 'Edit',
      input: { file_path: 'sample.txt', old_string: 'before', new_string: 'after' },
    }),
    e(2, 'claude.tool.result', {
      run_id: 'r',
      tool_use_id: 't',
      content: [{ type: 'text', text: 'Edited' }],
      is_error: false,
    }),
    e(3, 'claude.thinking', {
      run_id: 'r',
      message_id: 'm',
      index: 0,
      text: '',
      visibility: 'withheld_or_empty',
    }),
    e(4, 'claude.unsupported_tool', {
      run_id: 'r',
      tool_name: 'AskUserQuestion',
      reason: 'Question-response bridge unsupported',
    }),
  ])
  expect(projection.messages[0]).toMatchObject({
    toolName: 'Edit',
    toolResult: 'Edited',
    toolDiff: { old: 'before', new: 'after' },
  })
  expect(projection.messages[1].thinking).toBe('Thinking was not exposed by the provider.')
  expect(projection.messages[2].content).toContain('not supported yet')
})

it('keeps queued inputs, active runs, session metadata and pending permission details through replay', () => {
  const projection = reduceTranscript([
    e(1, 'session.created', {
      session_id: 's',
      title: 'Sample task',
      provider: 'claude',
      workspace_id: 'w',
      created_at: '2025-01-01T00:00:00.000Z',
    }),
    e(2, 'input.accepted', { input_id: 'i', text: 'Follow-up' }),
    e(3, 'input.queued', { input_id: 'i', state: 'queued' }),
    e(4, 'run.started', { run_id: 'r' }),
  ])
  expect(projection.session?.provider).toBe('claude')
  expect(projection.activeRuns).toEqual(['r'])
  expect(projection.queuedInputs).toEqual([{ id: 'i', text: 'Follow-up' }])
})
