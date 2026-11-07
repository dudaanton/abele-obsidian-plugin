import { afterEach, expect, it, vi } from 'vitest'
import {
  boundedNativeRead,
  boundedNativeOperations,
  NATIVE_READ_DEADLINE_MS,
} from '@/sync/nativeReadDeadline'
import { deferred } from '../helpers/deferred'

afterEach(() => vi.useRealTimers())

it('reuses bounded method functions without retaining file results or replaced methods', async () => {
  const host = {
    value: 1,
    async stat() {
      return this.value
    },
  }
  const port = boundedNativeOperations(host, 'sample-vault')
  const methods = new Set<unknown>()
  for (let file = 0; file < 5000; file++) methods.add(port.stat)
  expect(methods.size).toBe(1)
  expect(await port.stat()).toBe(1)
  host.value = 2
  expect(await port.stat()).toBe(2)
  const old = port.stat
  host.stat = async function () {
    return this.value + 1
  }
  expect(port.stat).not.toBe(old)
  expect(await port.stat()).toBe(3)
})

it('fails a lost metadata promise with the engine retry classification', async () => {
  vi.useFakeTimers()
  const lost = deferred<unknown>()
  const result = boundedNativeRead(lost.promise, 'lstat')
  const rejected = expect(result).rejects.toMatchObject({
    code: 'offline',
    retryable: true,
    cause: { code: 'native-read-timeout', operation: 'lstat' },
  })
  await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
  await rejected
  lost.reject(new Error('late failure'))
  await Promise.resolve()
  expect(vi.getTimerCount()).toBe(0)
})

it('closes a handle returned after the read-open deadline exactly once', async () => {
  vi.useFakeTimers()
  const opening = deferred<{ close(): Promise<void> }>()
  const close = vi.fn(async () => {})
  const result = boundedNativeRead(opening.promise, 'open', (handle) => handle.close())
  const rejected = expect(result).rejects.toMatchObject({ retryable: true })
  await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
  await rejected
  opening.resolve({ close })
  await Promise.resolve()
  expect(close).toHaveBeenCalledOnce()
})

it('clears the bound on success and preserves a host rejection', async () => {
  vi.useFakeTimers()
  expect(await boundedNativeRead(Promise.resolve(3), 'stat')).toBe(3)
  const failure = new Error('sample native error')
  await expect(boundedNativeRead(Promise.reject(failure), 'stat')).rejects.toBe(failure)
  expect(vi.getTimerCount()).toBe(0)
})
