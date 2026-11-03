import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { syncTransportForTests } from '@/testing/syncTransportOverride'
import { syncTransportForTests as productionTransport } from '@/helpers/productionTestFence'
const key = Symbol.for('abele.sync.test-transport-v1')
afterEach(() => {
  Reflect.deleteProperty(window, key)
})
it('takes only an explicit callable layout transport and leaves absent/invalid values unused', () => {
  expect(syncTransportForTests()).toBeUndefined()
  Reflect.set(window, key, {})
  expect(syncTransportForTests()).toBeUndefined()
  const transport = vi.fn()
  Reflect.set(window, key, transport)
  expect(syncTransportForTests()).toBe(transport)
})
it('guards the startup dependency at the production compile-time boundary', () => {
  const main = readFileSync(join(__dirname, '../../src/main.ts'), 'utf8')
  expect(
    /process\.env\.NODE_ENV\s*!==\s*'production'\s*\?\s*\{\s*fetch:\s*syncTransportForTests\(\)\s*\}\s*:\s*\{\s*\}/.test(
      main
    )
  ).toBe(true)
})
it('checks transport construction before acquiring the review database handle', () => {
  const main = readFileSync(join(__dirname, '../../src/main.ts'), 'utf8')
  const transport = main.indexOf('const transport = timedSyncTransport(')
  const reviews = main.indexOf('const reviews = await openDeviceReviews(')
  expect(transport).toBeGreaterThan(0)
  expect(transport).toBeLessThan(reviews)
})

it('keeps production immune to an injected layout transport', () => {
  Reflect.set(window, key, vi.fn())
  expect(productionTransport()).toBeUndefined()
})
