/**
 * What a session at a place is doing, read from its journal for the node panel's sessions mode:
 * working (a run, or a long-lived session's turn), waiting for you (a question open), or stopped
 * with an error.
 */
import { expect, it } from 'vitest'
import type { JournalEvent } from '@abele/channel-protocol'
import { sessionActivity } from '@/node/sessionActivity'

const e = (seq: number, type: string, data: unknown): JournalEvent => ({
  kind: 'event',
  node_id: 'sample',
  stream_id: 'session',
  seq,
  type,
  data,
  actor: { kind: 'node' },
  at: new Date(seq * 1000).toISOString(),
})

it('is quiet with nothing going on', () => {
  expect(sessionActivity([])).toEqual({ running: false, waiting: false, failed: false })
})

it('works through a run and through a turn of a long-lived session, since it began', () => {
  expect(sessionActivity([e(1, 'run.started', { run_id: 'r' })])).toEqual({
    running: true,
    waiting: false,
    failed: false,
    since: 1000,
  })
  expect(sessionActivity([e(1, 'turn.started', { run_id: 'p', trigger: 'input' })]).running).toBe(
    true
  )
  expect(
    sessionActivity([
      e(1, 'turn.started', { run_id: 'p', trigger: 'input' }),
      e(2, 'turn.completed', { run_id: 'p', outcome: 'success' }),
    ]).running
  ).toBe(false)
  expect(
    sessionActivity([
      e(1, 'turn.started', { run_id: 'p', trigger: 'input' }),
      e(2, 'session.process', { run_id: 'p', state: 'exited' }),
    ]).running
  ).toBe(false)
})

it('waits for you while a question is open', () => {
  expect(
    sessionActivity([
      e(1, 'run.started', { run_id: 'r' }),
      e(2, 'prompt.requested', { prompt_id: 'q', run_id: 'r', state: 'pending' }),
    ]).waiting
  ).toBe(true)
  expect(
    sessionActivity([
      e(1, 'prompt.requested', { prompt_id: 'q', run_id: 'r', state: 'pending' }),
      e(2, 'prompt.answered', { prompt_id: 'q', run_id: 'r', state: 'answered' }),
    ]).waiting
  ).toBe(false)
})

it('says the last work failed until the next succeeds', () => {
  const failed = [
    e(1, 'turn.started', { run_id: 'p' }),
    e(2, 'turn.completed', { run_id: 'p', outcome: 'failed' }),
  ]
  expect(sessionActivity(failed).failed).toBe(true)
  expect(
    sessionActivity([
      ...failed,
      e(3, 'turn.started', { run_id: 'p' }),
      e(4, 'turn.completed', { run_id: 'p', outcome: 'success' }),
    ]).failed
  ).toBe(false)
  expect(sessionActivity([e(1, 'run.failed', { run_id: 'r' })]).failed).toBe(true)
})
