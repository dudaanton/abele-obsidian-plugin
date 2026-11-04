import { afterEach, expect, it, vi } from 'vitest'
import { cachedResourceRanges, readCacheNamespace } from '@/sync/mobileCachedRanges'
import { mobileRangeCacheFixture } from '../helpers/mobileRangeCacheFixture'
import { deferred } from '../helpers/deferred'
afterEach(() => vi.unstubAllGlobals())
const anchor = '.abele-sync-work'
it('cleans inactive read aliases only in its namespace and preserves another active reader', async () => {
  const f = mobileRangeCacheFixture(8 * 1024 * 1024)
  const namespace = readCacheNamespace(f.adapter, anchor)
  const orphan = namespace + '/read-' + 'a'.repeat(32) + '.mp4'
  const foreign = 'other-vault/read-' + 'b'.repeat(32) + '.mp4'
  const unowned = namespace + '/sample.keep'
  f.cache.set(orphan, { size: 1 })
  f.cache.set(foreign, { size: 1 })
  f.cache.set(unowned, { size: 1 })
  const first = await cachedResourceRanges(f.adapter, f.fetcher, anchor)!.response(
    'sample.bin',
    f.size
  )
  expect(f.cache.has(orphan)).toBe(false)
  const active = [...f.cache.keys()].find((key) => key !== foreign && key !== unowned)!
  const second = await cachedResourceRanges(f.adapter, f.fetcher, anchor)!.response(
    'sample.bin',
    f.size
  )
  expect(f.cache.has(active)).toBe(true)
  expect(f.cache.has(foreign)).toBe(true)
  expect(f.cache.has(unowned)).toBe(true)
  await first.body!.cancel()
  await second.body!.cancel()
  expect([...f.cache.keys()].sort()).toEqual([foreign, unowned].sort())
})
it('waits for a cancelled native copy to acknowledge before retiring its cache file', async () => {
  const f = mobileRangeCacheFixture()
  const files = Reflect.get(window, 'Capacitor').Plugins.Filesystem
  const original = files.copy
  const entered = deferred(),
    written = deferred()
  files.copy = async (...args: unknown[]) => {
    await original(...args)
    entered.resolve()
    await written.promise
  }
  const cancellation = new AbortController()
  const pending = cachedResourceRanges(f.adapter, f.fetcher, anchor)!.response(
    'sample.bin',
    f.size,
    cancellation.signal
  )
  const rejected = expect(pending).rejects.toThrow('sample stop')
  await entered.promise
  cancellation.abort(new Error('sample stop'))
  expect(f.cache.size).toBe(1)
  written.resolve()
  await rejected
  expect(f.cache.size).toBe(0)
  expect(f.native.ranges).toBe(0)
})
it('fails a vanished disposable cache without mutating or reading the original file', async () => {
  const f = mobileRangeCacheFixture()
  const response = await cachedResourceRanges(f.adapter, f.fetcher, anchor)!.response(
    'sample.bin',
    f.size
  )
  f.cache.clear()
  await expect(response.body!.getReader().read()).rejects.toThrow('range response')
  expect(f.readBinary).not.toHaveBeenCalled()
  expect(f.native.unbounded).toBe(0)
})
