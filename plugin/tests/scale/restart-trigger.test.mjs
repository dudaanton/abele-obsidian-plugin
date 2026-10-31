import assert from 'node:assert/strict'
import { test } from 'node:test'
import { triggerComparisonAtRestart } from './restart-trigger.mjs'

test('comparison restart does not await full app readiness while holding the response', async () => {
  const calls = []
  const start = async (options) => {
    calls.push(options)
    if (!options?.passive) await new Promise(() => {})
  }
  const triggered = async (_proxy, kind, action) => {
    assert.equal(kind, 'comparison')
    await action()
    return { kind }
  }
  const result = await Promise.race([
    triggerComparisonAtRestart({}, start, triggered),
    new Promise((_, reject) => setTimeout(() => reject(new Error('waited for app readiness')), 100)),
  ])
  assert.deepEqual(result, { kind: 'comparison' })
  assert.deepEqual(calls, [{ passive: true }])
})
