import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFailureMonitor, serializeErrorObservation } from './failure-monitor.mjs'

test('parallel device waiters wait for the same recovery observation', async () => {
  let release, calls = 0, secondFinished = false
  const blocked = new Promise(resolve => { release = resolve })
  const observe = serializeErrorObservation(async () => { calls++; await blocked })
  const first = observe()
  const second = observe().then(() => { secondFinished = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(secondFinished, false)
  assert.equal(calls, 1)
  release()
  await Promise.all([first, second])
})

test('early errors on either device are captured once before recovery observation continues', async () => {
  const captures = []
  let release
  const copying = new Promise(resolve => { release = resolve })
  const monitor = createFailureMonitor({
    readMarkers: async () => [{ device: '1', pid: 12, at: 1 }, { device: '0', pid: 11, at: 2 }],
    capture: async marker => { captures.push(marker.device); await copying },
  })
  const first = monitor.poll()
  await new Promise(resolve => setImmediate(resolve))
  const second = monitor.poll()
  assert.deepEqual(captures, ['1'])
  release()
  await Promise.all([first, second])
  await monitor.poll()
  assert.deepEqual(captures, ['1', '0'])
})
