import { expect, it } from 'vitest'
import {
  pruneLocalStorage,
  pruneNodePathCaches,
  trimLocalPreference,
} from '@/helpers/localStorageBudget'

it('prunes dead node caches and budgets retained caches without crossing vaults', () => {
  const store = window.localStorage
  store.clear()
  for (let i = 0; i < 100; i++) store.setItem(`sample-abele-node-path-cache:${i}`, 'x'.repeat(3000))
  store.setItem('other-abele-node-path-cache:0', 'keep')
  pruneLocalStorage(store, 'sample-', 'abele-node-path-cache:', new Set(['98', '99']), 4096)
  expect(store.getItem('sample-abele-node-path-cache:0')).toBeNull()
  expect(store.getItem('other-abele-node-path-cache:0')).toBe('keep')
  expect(store.getItem('sample-abele-node-path-cache:99')).toHaveLength(3000)
  expect(store.length).toBe(2)
})

it('includes key lengths in the budget and prioritizes the cache just written', () => {
  const store = window.localStorage
  store.clear()
  store.setItem('sample-cache:old', 'old')
  store.setItem('sample-cache:new', 'new')
  pruneLocalStorage(store, 'sample-', 'cache:', undefined, 20, 'cache:new')
  expect(store.getItem('sample-cache:new')).toBe('new')
  expect(store.getItem('sample-cache:old')).toBeNull()
})

it('keeps long-lived cache families bounded across repeated writes and startup cleanup', () => {
  const store = window.localStorage
  store.clear()
  const app = { appId: 'sample' }
  const ids = new Set(Array.from({ length: 100 }, (_, i) => String(i)))
  for (const id of ids) {
    store.setItem('sample-abele-node-path-cache:' + id, 'x'.repeat(3000))
    pruneNodePathCaches(app, ids, 'abele-node-path-cache:' + id)
  }
  const size = () =>
    Object.keys(store).reduce((sum, key) => sum + key.length + store.getItem(key)!.length, 0)
  expect(size()).toBeLessThanOrEqual(65536)
  expect(store.getItem('sample-abele-node-path-cache:99')).toHaveLength(3000)
  pruneNodePathCaches(app, new Set(['99']))
  expect(store.length).toBe(1)
  for (let i = 0; i < 100; i++)
    store.setItem('sample-abele-debug-launch-arguments:' + i, 'x'.repeat(1000))
  trimLocalPreference(app, 'abele-debug-launch-arguments:')
  expect(size()).toBeLessThanOrEqual(65536 + 32768)
})
