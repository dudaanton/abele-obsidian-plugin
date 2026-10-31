import assert from 'node:assert/strict'
import { test } from 'node:test'
import diagnostic from './failure-diagnostic.cjs'

test('fingerprint wrappers preserve results and capture the SDK caller before awaits', async () => {
  const events = []
  class FileSystem {
    async fingerprint(path) { await Promise.resolve(); return this.fingerprintFresh(path) }
    async fingerprintFresh(path) { return { sha: path, size: 7 } }
  }
  diagnostic.wrapFingerprints(FileSystem, row => events.push(row))
  const result = await new FileSystem().fingerprint('sample.md')
  assert.deepEqual(result, { sha: 'sample.md', size: 7 })
  assert.equal(events.filter(row => row.event === 'fingerprint-start').length, 2)
  assert.ok(events.some(row => row.method === 'fingerprint' && row.stack.includes('failure-diagnostic.test.mjs')))
  assert.equal(events.filter(row => row.event === 'fingerprint-result').length, 2)
})

test('fatal capture writes the complete exception and state before freezing exactly once', () => {
  const order = [], events = [], listeners = new Map()
  const target = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener() {} }
  const original = () => order.push('console')
  const console = { error: original, warn: original }
  const cause = new Error('sample root cause')
  const error = new Error('sample startup failure', { cause })
  const capture = diagnostic.captureFailures({ target, console, emit: row => events.push(row),
    getState: () => ({ rows: [{ status: 'error' }], failure: error }),
    writeFatal: row => { order.push('write'); assert.equal(row.state.failure.cause.message, cause.message) },
    freeze: () => order.push('freeze'), armed: () => true })
  console.error('failed', error)
  listeners.get('unhandledrejection')({ reason: error })
  capture.poll(); capture.poll()
  assert.deepEqual(order, ['console', 'write', 'freeze'])
  assert.equal(events[0].args[1].stack, error.stack)
  assert.equal(events[1].reason.cause.stack, cause.stack)
  capture.close()
  assert.equal(console.error, original)
})
