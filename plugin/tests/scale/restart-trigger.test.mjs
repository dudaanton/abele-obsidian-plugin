import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import * as comparison from './restart-trigger.mjs'
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
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('waited for app readiness')), 100)
    ),
  ])
  assert.deepEqual(result, { kind: 'comparison' })
  assert.deepEqual(calls, [{ passive: true }])
})

test('inventory completes before acquiring the comparison hold; an expired acquisition is rearmed', async () => {
  const proxy = Object.assign(new EventEmitter(), {
    active: new Map(),
    events: [],
    record(row) {
      this.events.push(row)
    },
  })
  const calls = []
  let id = 0
  assert.equal(typeof comparison.prepareComparisonReindex, 'function')
  const prepared = await comparison.prepareComparisonReindex(
    async () => {
      calls.push('inventory')
      return 42
    },
    async () => {
      calls.push('hold')
      return { id: ++id }
    }
  )
  const result = await comparison.clickWithComparisonHold(
    proxy,
    prepared.trigger,
    async () => {
      calls.push('rearm')
      proxy.active.set(++id, {})
      return { id }
    },
    async () => {
      calls.push('click')
      return { at: 10 }
    }
  )
  assert.equal(prepared.inventory, 42)
  assert.equal(result.at, 10)
  assert.deepEqual(calls, ['inventory', 'hold', 'rearm', 'click'])
  assert.ok(proxy.events.some((row) => row.event === 'comparison-hold-rearmed'))
})

test('expiry during a click without a timely click receipt fails explicitly instead of waiting', async () => {
  const proxy = Object.assign(new EventEmitter(), { active: new Map([[1, {}]]), record() {} })
  assert.equal(typeof comparison.clickWithComparisonHold, 'function')
  await assert.rejects(
    comparison.clickWithComparisonHold(
      proxy,
      { id: 1 },
      async () => {
        throw Error('must not repeat a click')
      },
      () => {
        proxy.emit('wire', { event: 'close', id: 1, at: 20, completed: false })
        return new Promise(() => {})
      },
      { receiptGraceMs: 1 }
    ),
    /Comparison reindex hold expired before click/
  )
  assert.equal(proxy.listenerCount('wire'), 0)
})

test('a click proven before the request closes remains a genuine active-request cut', async () => {
  const proxy = Object.assign(new EventEmitter(), { active: new Map([[1, {}]]), record() {} })
  assert.equal(typeof comparison.clickWithComparisonHold, 'function')
  const result = await comparison.clickWithComparisonHold(
    proxy,
    { id: 1 },
    async () => {},
    async () => {
      proxy.emit('wire', { event: 'close', id: 1, at: 20, completed: false })
      return { at: 19 }
    }
  )
  assert.equal(result.at, 19)
})
