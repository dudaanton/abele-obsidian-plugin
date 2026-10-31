import test from 'node:test'
import assert from 'node:assert/strict'
import { observeErrorRecovery } from './transient-error.mjs'

const failed = { rows: [{ status: 'error' }], activity: [{ id: 'sample', failure: {
  reason: 'saved state failed', code: 'STATE', stage: 'Checking saved sync state',
  kind: 'StateError', substep: 'read',
}}] }
const healthy = { rows: [{ status: 'idle' }], engines: [{ state: 'idle', lastSyncAt: 1 }] }

test('captures the first error verbatim and keeps its strict failure after recovery', async () => {
  const sequence = [failed, healthy]
  const seen = []
  const result = await observeErrorRecovery({
    first: sequence.shift(),
    snapshot: async () => sequence.shift() ?? healthy,
    record: event => seen.push(event),
    sleep: async () => {},
    now: (() => { let at = 0; return () => at += 10 })(),
    timeoutMs: 120000,
  })
  assert.equal(result.recovered, true)
  assert.deepEqual(seen[0].failure, failed.activity[0].failure)
  assert.equal(seen[0].strictFail, true)
  assert.equal(seen.at(-1).recovered, true)
})

test('stops after the recovery limit when the row stays in error', async () => {
  const seen = []
  const result = await observeErrorRecovery({
    first: failed,
    snapshot: async () => failed,
    record: event => seen.push(event),
    sleep: async () => {},
    now: (() => { let at = 0; return () => at += 50000 })(),
    timeoutMs: 120000,
  })
  assert.equal(result.recovered, false)
  assert.equal(seen.at(-1).recovered, false)
  assert.equal(seen[0].failure.substep, 'read')
})
