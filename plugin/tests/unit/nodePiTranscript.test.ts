import { expect, it } from 'vitest'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import type { JournalEvent } from '@abele/channel-protocol'
import { piFailure } from '@/node/piFailure'
it.each([502, 400, undefined])('explains normalized failures with retained status %s', (status) => {
  const explanation = piFailure({
    http_status: status,
    message: {
      role: 'assistant',
      stopReason: 'error',
      errorMessage: 'provider_error (details retained only locally by SDK)',
    },
  })
  expect(explanation).toBe(
    `The agent could not answer: the model service returned an error${status ? ` (HTTP ${status})` : ''}.`
  )
})
it.each([502, 400])(
  'projects empty failed finals and puts error evidence first (HTTP %s)',
  (status) => {
    const failure = event(2, 'pi.message.final', {
      run_id: 'sample-run',
      message_id: 'failed',
      runtime_generation: 1,
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: `${status} Sample rejection`,
      },
    })
    const projection = reduceTranscript([event(1, 'pi.session.bound', {}), failure])
    expect(projection.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: '',
      error: `The agent could not answer: the model service returned an error (HTTP ${status}).`,
    })
    expect(projection.unknown[0]).toEqual(failure)
  }
)
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
it('keeps terminal-only extension diagnostics out of the conversation without hiding failures', () => {
  const p = reduceTranscript([
    event(1, 'pi.extension.warning', {
      reason: 'unsupported_extension_ui',
      capability: 'onTerminalInput',
    }),
    event(2, 'pi.extension.error', { extension: 'sample-extension', error: 'Sample failure' }),
  ])
  expect(p.messages.some((m) => m.sessionMark?.text?.includes('onTerminalInput'))).toBe(false)
  expect(p.messages.some((m) => m.sessionMark?.text?.includes('Sample failure'))).toBe(true)
})

it('retains the edit diff when the call first appears in an assistant snapshot', () => {
  const scope = { run_id: 'sample-run', runtime_generation: 1 }
  const p = reduceTranscript([
    event(1, 'pi.message.final', {
      ...scope,
      message_id: '1',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'edit-1',
            name: 'edit',
            arguments: { path: 'sample.txt', oldText: 'before', newText: 'after' },
          },
        ],
      },
    }),
    event(2, 'pi.tool.result', { ...scope, tool_use_id: 'edit-1', result: 'Changed' }),
  ])
  expect(p.messages.find((m) => m.role === 'tool-call')?.toolDiff).toEqual({
    old: 'before',
    new: 'after',
  })
})

it('shows an owner-interrupted turn as stopped and closes its unfinished tools', () => {
  const scope = { run_id: 'sample-run', runtime_generation: 1 }
  const p = reduceTranscript([
    event(1, 'input.accepted', { input_id: 'sample-input', text: 'Read the sample' }),
    event(2, 'turn.started', { run_id: 'sample-run', input_ids: ['sample-input'] }),
    event(3, 'pi.tool.call', {
      ...scope,
      tool_use_id: 'read-1',
      name: 'read',
      input: { path: 'sample.txt' },
    }),
    event(4, 'pi.message.final', {
      ...scope,
      message_id: '1',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'provider_error',
      },
    }),
    event(5, 'turn.completed', {
      run_id: 'sample-run',
      outcome: 'interrupted',
      terminal_reason: 'stopped_by_owner',
      input_ids: ['sample-input'],
    }),
  ])
  expect(p.messages.some((m) => m.error)).toBe(false)
  expect(p.messages.some((m) => m.sessionMark?.text === 'Stopped by you')).toBe(true)
  expect(p.messages.find((m) => m.role === 'tool-call')?.toolExecution).toBe('interrupted')
  expect(p.queuedInputs).toEqual([])
})

it('surfaces startup failure and ends the queued state with a retry target', () => {
  const p = reduceTranscript([
    event(1, 'input.accepted', { input_id: 'sample-input', text: 'Sample question' }),
    event(2, 'session.process', { run_id: 'sample-run', state: 'starting' }),
    event(3, 'session.process', {
      run_id: 'sample-run',
      state: 'exited',
      reason: 'pi_host_failed',
      error: 'Sample tool configuration is invalid',
    }),
  ])
  expect(p.state).toBe('needs-attention')
  expect(p.queuedInputs).toEqual([])
  expect(p.messages.at(-1)).toMatchObject({
    retryInputId: 'input:sample-input',
    error: expect.stringContaining('Sample tool configuration is invalid'),
  })
})

it('does not erase an earlier model failure when a later turn in the same process is stopped', () => {
  const scope = { run_id: 'sample-process', runtime_generation: 1 }
  const p = reduceTranscript([
    event(1, 'turn.started', { run_id: scope.run_id }),
    event(2, 'pi.message.final', {
      ...scope,
      message_id: '1',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'Sample earlier failure',
      },
    }),
    event(3, 'turn.completed', { run_id: scope.run_id, outcome: 'error' }),
    event(4, 'turn.started', { run_id: scope.run_id }),
    event(5, 'turn.completed', { run_id: scope.run_id, outcome: 'interrupted' }),
  ])
  expect(p.messages.find((m) => m.error)?.error).toContain('Sample earlier failure')
})
it.each([
  ['', 'the model service returned an error'],
  ['Connection closed\nSample diagnostic detail', 'Connection closed'],
])('keeps failed final text and thinking with a short explanation', (errorMessage, reason) => {
  const scope = { run_id: 'sample-run', message_id: 'failed', runtime_generation: 1 }
  const failure = event(2, 'pi.message.final', {
    ...scope,
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Partial answer' },
        { type: 'thinking', thinking: 'Sample reasoning' },
      ],
      stopReason: 'error',
      errorMessage,
    },
  })
  const projection = reduceTranscript([
    event(1, 'run.started', { run_id: 'sample-run', input_id: 'sample-input' }),
    failure,
    failure,
    event(3, 'pi.message.delta', {
      ...scope,
      delta: { type: 'text_delta', contentIndex: 0, delta: 'Late text' },
    }),
  ])
  expect(projection.messages).toHaveLength(1)
  expect(projection.messages[0]).toMatchObject({
    content: 'Partial answer',
    thinking: 'Sample reasoning',
    error: `The agent could not answer: ${reason}.`,
    retryInputId: 'input:sample-input',
  })
  expect(projection.unknown).toEqual([failure])
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
