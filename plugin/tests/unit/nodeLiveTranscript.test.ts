/**
 * A long-lived node session read from its journal: turns instead of runs, what it keeps running
 * in the background, how full its context is, compacting and waking as lines across the talk, and
 * a message another session wrote to it under who wrote it.
 */
import { describe, expect, it } from 'vitest'
import type { JournalEvent } from '@abele/channel-protocol'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'

const e = (seq: number, type: string, data: unknown, at = seq * 1000): JournalEvent => ({
  kind: 'event',
  node_id: 'sample',
  stream_id: 'session',
  seq,
  type,
  data,
  actor: { kind: 'node' },
  at: new Date(at).toISOString(),
})
const started = (seq: number, trigger = 'input') =>
  e(seq, 'turn.started', { run_id: 'p1', turn_id: `t${seq}`, trigger })

it('replays sender metadata without a local letter store', () => {
  const result = reduceTranscript([
    e(1, 'input.accepted', {
      input_id: 'letter',
      text: 'Sample question',
      sender: { id: 'source', title: 'Sample source' },
    }),
  ])
  expect(result.messages.find((m) => m.role === 'user')?.fromSession).toEqual({
    id: 'source',
    title: 'Sample source',
  })
})
const completed = (seq: number, outcome = 'success', input_ids: string[] = []) =>
  e(seq, 'turn.completed', {
    run_id: 'p1',
    turn_id: `t${seq}`,
    outcome,
    input_ids,
    subtype: null,
    num_turns: 1,
    duration_ms: 10,
    total_cost_usd: 0.01,
    terminal_reason: null,
  })

describe('turns of a long-lived session', () => {
  it('counts a turn as running work until it completes, and the inputs it took as done', () => {
    const running = reduceTranscript([
      e(1, 'input.accepted', { input_id: 'i1', text: 'Sample question' }),
      e(2, 'session.process', { run_id: 'p1', state: 'running' }),
      started(3),
    ])
    expect(running.state).toBe('running')
    expect(running.activeRuns).toEqual(['p1'])
    expect(running.live?.live).toBe(true)

    const done = reduceTranscript([
      e(1, 'input.accepted', { input_id: 'i1', text: 'Sample question' }),
      e(2, 'session.process', { run_id: 'p1', state: 'running' }),
      started(3),
      completed(4, 'success', ['i1']),
    ])
    expect(done.state).toBe('idle')
    expect(done.activeRuns).toEqual([])
    expect(done.queuedInputs).toEqual([])
  })

  it('ends the turn when the process exits under it', () => {
    const projection = reduceTranscript([
      e(1, 'session.process', { run_id: 'p1', state: 'running' }),
      started(2),
      e(3, 'session.process', { run_id: 'p1', state: 'exited', reason: 'stopped' }),
    ])
    expect(projection.activeRuns).toEqual([])
  })

  it('keeps its own bookkeeping out of the details', () => {
    const projection = reduceTranscript([
      e(1, 'session.process', { run_id: 'p1', state: 'running' }),
      started(2),
      e(3, 'turn.interrupt_requested', { run_id: 'p1' }),
      e(4, 'claude.status', { run_id: 'p1', permission_mode: 'plan' }),
      e(5, 'claude.task', { run_id: 'p1', subtype: 'task_started', task_id: 'k1' }),
      e(6, 'claude.rate_limit', { run_id: 'p1', status: 'allowed' }),
      e(7, 'session.message.sent', {
        run_id: 'p1',
        input_id: 'x',
        to_session_id: 's2',
        to_title: 'Sample other',
        text: 'Hello',
      }),
      completed(8, 'interrupted'),
    ])
    expect(projection.unknown).toEqual([])
  })
})

describe('what a session keeps running', () => {
  it('lists the latest background tasks, each with its kind and since when it runs', () => {
    const projection = reduceTranscript([
      e(1, 'session.process', { run_id: 'p1', state: 'running' }),
      e(2, 'session.tasks', {
        run_id: 'p1',
        tasks: [{ task_id: 'k1', task_type: 'local_bash', description: 'npm test' }],
      }),
      e(5, 'session.tasks', {
        run_id: 'p1',
        tasks: [
          { task_id: 'k1', task_type: 'local_bash', description: 'npm test' },
          { task_id: 'k2', task_type: 'local_agent', description: 'Sample review' },
          { task_id: 'k3', task_type: 'monitor_mcp', description: null },
        ],
      }),
    ])
    expect(projection.live?.tasks).toEqual([
      { id: 'k1', kind: 'command', title: 'npm test', since: 2000 },
      { id: 'k2', kind: 'agent', title: 'Sample review', since: 5000 },
      { id: 'k3', kind: 'monitor', title: 'A background task', since: 5000 },
    ])
  })

  it('forgets the tasks once the process is gone', () => {
    const projection = reduceTranscript([
      e(1, 'session.tasks', {
        run_id: 'p1',
        tasks: [{ task_id: 'k1', task_type: 'local_bash', description: 'npm test' }],
      }),
      e(2, 'session.process', { run_id: 'p1', state: 'exited' }),
    ])
    expect(projection.live?.tasks).toEqual([])
  })

  it('says how full the context is, by the last report', () => {
    const projection = reduceTranscript([
      e(1, 'session.context', {
        run_id: 'p1',
        total_tokens: 412_000,
        max_tokens: 1_000_000,
        percentage: 41.2,
        auto_compact_threshold: null,
        auto_compact_enabled: true,
        model: 'sample-model',
        categories: [],
      }),
    ])
    expect(projection.live?.context).toEqual({ used: 412_000, limit: 1_000_000 })
  })
})

describe('lines the session draws itself', () => {
  it('draws compacting while it runs, then how much it kept and the retelling', () => {
    const compacting = reduceTranscript([
      e(1, 'session.process', { run_id: 'p1', state: 'running' }),
      e(2, 'compaction.started', { run_id: 'p1' }),
    ])
    expect(compacting.live?.compacting).toBe(true)
    expect(compacting.messages.map((m) => m.sessionMark?.kind)).toEqual(['compacting'])

    const done = reduceTranscript([
      e(1, 'session.process', { run_id: 'p1', state: 'running' }),
      e(2, 'compaction.started', { run_id: 'p1' }),
      e(3, 'compaction.completed', {
        run_id: 'p1',
        result: 'success',
        trigger: 'manual',
        pre_tokens: 812_000,
        post_tokens: 64_000,
        duration_ms: 1000,
        error: null,
      }),
      e(4, 'compaction.summary', { run_id: 'p1', text: 'Sample retelling' }),
    ])
    expect(done.live?.compacting).toBe(false)
    expect(done.messages).toHaveLength(1)
    expect(done.messages[0]).toMatchObject({
      role: 'system',
      content: 'Sample retelling',
      sessionMark: { kind: 'compacted', before: 812_000, after: 64_000 },
    })
  })

  it('draws an automatic compaction the same way, with no start seen', () => {
    const projection = reduceTranscript([
      e(1, 'compaction.completed', {
        run_id: 'p1',
        result: 'success',
        trigger: 'auto',
        pre_tokens: 900_000,
        post_tokens: 50_000,
        duration_ms: 1000,
        error: null,
      }),
    ])
    expect(projection.messages[0].sessionMark).toMatchObject({ kind: 'compacted' })
  })

  it('says a failed compaction and leaves no compacting line', () => {
    const projection = reduceTranscript([
      e(1, 'compaction.started', { run_id: 'p1' }),
      e(2, 'compaction.completed', {
        run_id: 'p1',
        result: 'failed',
        trigger: null,
        pre_tokens: null,
        post_tokens: null,
        duration_ms: null,
        error: 'sample failure',
      }),
    ])
    expect(projection.live?.compacting).toBe(false)
    // A line across the talk like the other compaction lines, in the error colour.
    expect(projection.messages).toHaveLength(1)
    expect(projection.messages[0]).toMatchObject({
      role: 'system',
      sessionMark: { kind: 'failed', text: 'sample failure' },
    })
    expect(projection.messages[0].error).toBeUndefined()
  })

  it('draws what woke it when a background task ends and the session answers by itself', () => {
    const projection = reduceTranscript([
      e(1, 'session.process', { run_id: 'p1', state: 'running' }),
      e(2, 'claude.task', {
        run_id: 'p1',
        subtype: 'task_notification',
        task_id: 'k1',
        status: 'completed',
        summary: 'npm test finished · 12 passed',
      }),
      started(3, 'task'),
    ])
    expect(projection.messages[0]).toMatchObject({
      role: 'system',
      sessionMark: { kind: 'woke', text: 'npm test finished · 12 passed' },
    })
  })

  it('names who of the other sessions wrote a message', () => {
    const projection = reduceTranscript([
      e(1, 'input.accepted', {
        input_id: 'i1',
        text: 'Sample result',
        from_session: { session_id: 's2', title: 'Sample tester' },
      }),
    ])
    expect(projection.messages[0]).toMatchObject({
      role: 'user',
      content: 'Sample result',
      fromSession: { id: 's2', title: 'Sample tester' },
    })
  })
})
