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

it('shows rate-limit states once per session across turns, preserving changed states and errors', () => {
  const notice = (seq: number, text: string, level = 'warning', code = 'rate_limit') =>
    e(seq, 'session.update', {
      run_id: `run-${seq}`,
      update: { kind: 'notice', code, level, text },
    })
  const warning = 'Usage limit close, resets 2025-01-01T12:00:00.000Z'
  const events = [
    notice(1, warning),
    e(2, 'claude.message.final', {
      run_id: 'r',
      message_id: 'm',
      role: 'assistant',
      content: [{ type: 'text', text: 'Sample reply' }],
    }),
    notice(3, warning),
    notice(4, 'Sample diagnostic', 'warning', 'other'),
    notice(5, warning),
    notice(6, 'Usage limit close, resets 2025-01-01T18:00:00.000Z'),
    notice(7, 'Usage limit reached', 'error'),
    notice(8, 'Usage limit reached', 'error'),
  ]
  for (const journal of [events, [...events]]) {
    const notices = reduceTranscript(journal).messages.filter(
      (m) => m.sessionMark?.kind === 'notice'
    )
    expect(notices).toHaveLength(4)
    expect(notices[0].content).toContain(new Date('2025-01-01T12:00:00.000Z').toLocaleString())
    expect(notices.at(-1)?.sessionMark).toMatchObject({
      level: 'error',
      text: 'Usage limit reached',
    })
  }
  expect(reduceTranscript([notice(1, warning)]).messages).toHaveLength(1)
})

it('deduplicates raw and legacy rate-limit notices without hiding unrelated notices', () => {
  const raw = (seq: number, resetsAt: number) =>
    e(seq, 'claude.rate_limit', {
      run_id: `r${seq}`,
      info: { status: 'allowed_warning', resetsAt },
    })
  const legacy = (seq: number) =>
    e(seq, 'session.update', {
      run_id: `r${seq}`,
      update: { kind: 'notice', level: 'warning', text: 'Usage limit close, resets at 21:00' },
    })
  expect(
    reduceTranscript([raw(1, 1735732800), raw(2, 1735732800), raw(3, 1735754400)]).messages
  ).toHaveLength(2)
  expect(reduceTranscript([legacy(1), legacy(2)]).messages).toHaveLength(1)
  const other = (seq: number) =>
    e(seq, 'session.update', {
      update: { kind: 'notice', level: 'warning', text: 'Sample diagnostic' },
    })
  expect(reduceTranscript([other(1), other(2)]).messages).toHaveLength(2)
})

it('keeps raw provider evidence collapsed instead of creating dozens of transcript artifact buttons', () => {
  const projected = reduceTranscript([
    e(1, 'claude.raw', { run_id: 'r', artifact_id: 'raw', size: 9000 }),
    e(2, 'claude.message.final', { run_id: 'r', artifact_id: 'normalized', size: 9000 }),
  ])
  expect(projected.artifacts.map((a) => a.artifactId)).toEqual(['normalized'])
  expect(projected.unknown).toHaveLength(2)
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

it('renders successful edits as diffs and correlated results, and no empty thought', () => {
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
  // Reasoning the provider withheld draws nothing: no empty «Thought» to open.
  expect(projection.messages.some((m) => m.role === 'assistant')).toBe(false)
  // Said the way the node says it for every agent: a warning line naming the tool and why.
  expect(projection.messages[1]).toMatchObject({
    content: 'AskUserQuestion: Question-response bridge unsupported',
    sessionMark: { kind: 'notice', level: 'warning' },
  })
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
