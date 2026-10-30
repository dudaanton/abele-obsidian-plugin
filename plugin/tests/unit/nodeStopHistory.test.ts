import { expect, it } from 'vitest'
import type { JournalEvent } from '@abele/channel-protocol'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'

const interruptedTurn = (reason: string | null) => [
  event(1, 'turn.started', { turn_id: 'sample-turn' }),
  event(2, 'turn.completed', {
    turn_id: 'sample-turn',
    outcome: 'interrupted',
    terminal_reason: reason,
  }),
]

const event = (seq: number, type: string, data: Record<string, unknown>): JournalEvent => ({
  kind: 'event',
  node_id: 'sample-node',
  stream_id: 'sample-session',
  seq,
  type,
  actor: { kind: 'node' },
  at: '2025-01-01T00:00:00.000Z',
  data: { run_id: 'sample-run', ...data },
})

it('attributes an interruption to the owner only with explicit evidence', () => {
  expect(
    reduceTranscript(interruptedTurn('stopped_by_owner')).messages.at(-1)?.sessionMark?.text
  ).toBe('Stopped by you')
})

it.each([
  'process_lost',
  'node_restart',
  'codex_process_inventory_unavailable',
  'process_exited',
  'future_reason',
  null,
])('uses a resumable neutral line for node-side interruption %s', (reason) => {
  const projection = reduceTranscript(interruptedTurn(reason))
  expect(projection.messages.at(-1)?.sessionMark).toEqual({
    kind: 'notice',
    level: 'info',
    text: 'The agent run ended on the node',
    ...(reason ? { detail: reason } : {}),
  })
  expect(projection.activeRuns).toEqual([])
  // Interrupted turns retain the existing attention state and accept another turn.
  expect(projection.state).toBe('needs-attention')
  expect(
    reduceTranscript([
      ...interruptedTurn(reason),
      event(3, 'turn.started', { turn_id: 'next-turn' }),
      event(4, 'turn.completed', { outcome: 'success' }),
    ]).state
  ).toBe('idle')
})

it('uses a following process reason only for the matching interrupted turn with no reason', () => {
  const projection = reduceTranscript([
    ...interruptedTurn(null),
    event(3, 'session.process', { state: 'exited', run_id: 'other-run', reason: 'unrelated' }),
    event(4, 'session.process', { state: 'exited', reason: 'process_lost' }),
  ])
  expect(projection.messages.find((m) => m.id === 'stopped:2')?.sessionMark?.detail).toBe(
    'process_lost'
  )
  expect(
    reduceTranscript([
      ...interruptedTurn('node_restart'),
      event(3, 'session.process', { state: 'exited', reason: 'process_exited' }),
    ]).messages.at(-1)?.sessionMark?.detail
  ).toBe('node_restart')
})

it('does not attach a later turn process exit to an earlier interruption', () => {
  const projection = reduceTranscript([
    ...interruptedTurn(null),
    event(3, 'turn.started', { turn_id: 'next-turn' }),
    event(4, 'session.process', { state: 'exited', reason: 'process_lost' }),
  ])
  expect(projection.messages.find((m) => m.id === 'stopped:2')?.sessionMark?.detail).toBeUndefined()
})

it('describes stopping with a pending approval as interrupted rather than denied', () => {
  const p = reduceTranscript([
    event(1, 'turn.started', { input_ids: ['sample-input'] }),
    event(2, 'pi.tool.call', { tool_use_id: 'sample-call', name: 'read', input: {} }),
    event(3, 'prompt.resolved', {
      kind: 'permission',
      prompt_id: 'sample-prompt',
      session_id: 'sample-session',
      revision: 1,
      action_digest: 'a'.repeat(64),
      expires_at: 1999999999999,
      state: 'resolved',
      choice: 'deny',
      installation_id: 'sample-installation',
      delivered: true,
      tool_use_id: 'sample-call',
      tool_name: 'read',
      input: {},
    }),
    event(4, 'turn.completed', { outcome: 'interrupted' }),
  ])
  const tool = p.messages.find((message) => message.role === 'tool-call')!
  expect(tool.toolResult).not.toBe('User rejected this action')
  expect(tool.toolExecution).toBe('interrupted')
})

it.each(['pi', 'claude'] as const)(
  'retains completed %s calls and marks an unfinished call on replay',
  (provider) => {
    const events = [event(1, 'run.started', {})]
    for (const [index, id] of ['one', 'two', 'three'].entries()) {
      events.push(
        event(index * 2 + 2, `${provider}.tool.call`, { tool_use_id: id, name: 'read', input: {} })
      )
      if (id !== 'three')
        events.push(
          event(index * 2 + 3, `${provider}.tool.result`, {
            tool_use_id: id,
            content: 'Saved ' + id,
            result: { content: [{ type: 'text', text: 'Saved ' + id }] },
          })
        )
    }
    events.push(
      event(8, provider === 'pi' ? 'pi.message.delta' : 'claude.block.delta', {
        message_id: 'sample-message',
        index: 0,
        text: 'Partial answer',
        delta: { type: 'text_delta', contentIndex: 0, delta: 'Partial answer' },
      }),
      event(9, 'run.interrupted', {})
    )
    const projection = reduceTranscript(events)
    expect(
      projection.messages.filter((m) => m.role === 'tool-call').map((m) => m.toolResult)
    ).toEqual(['Saved one', 'Saved two', undefined])
    expect(projection.messages.find((m) => m.toolName && !m.toolResult)).toMatchObject({
      toolExecution: 'interrupted',
    })
    expect(projection.messages.at(-1)?.content).toBe('Partial answer')
    expect(reduceTranscript(JSON.parse(JSON.stringify(events)))).toEqual(projection)
  }
)

it('marks pi snapshot-only calls not run and does not interrupt completed or other-run tools', () => {
  const projection = reduceTranscript([
    event(1, 'run.started', {}),
    event(2, 'pi.message.final', {
      message_id: 'sample-message',
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'requested', name: 'read', arguments: {} }],
      },
    }),
    event(3, 'tool.started', { tool_call_id: 'done', name: 'read' }),
    event(4, 'tool.completed', { tool_call_id: 'done', result: 'Complete' }),
    event(5, 'tool.started', { run_id: 'other-run', tool_call_id: 'other', name: 'read' }),
    event(6, 'run.interrupted', {}),
    event(7, 'run.interrupted', {}),
  ])
  expect(projection.messages.find((m) => m.id.includes('requested'))).toMatchObject({
    toolExecution: 'not-run',
  })
  expect(projection.messages.find((m) => m.id === 'tool:done')).toMatchObject({
    toolResult: 'Complete',
    toolStatus: 'approved',
  })
  expect(projection.messages.find((m) => m.id === 'tool:other')?.toolExecution).toBeUndefined()
})

it('keeps pi streamed text when an aborted final carries an empty snapshot', () => {
  const projection = reduceTranscript([
    event(1, 'pi.message.delta', {
      message_id: 'sample-message',
      delta: { type: 'text_delta', contentIndex: 0, delta: 'Partial answer' },
    }),
    event(2, 'pi.message.final', {
      message_id: 'sample-message',
      message: { role: 'assistant', stopReason: 'aborted', content: [] },
    }),
    event(3, 'run.interrupted', {}),
  ])
  expect(projection.messages[0].content).toBe('Partial answer')
})
