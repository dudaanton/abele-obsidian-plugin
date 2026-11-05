// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { boundedNativeRead } from '@/sync/nativeReadDeadline'

afterEach(() => vi.useRealTimers())

it('uses the timer host of a portable adapter without a DOM window', async () => {
  expect(typeof window).toBe('undefined')
  await expect(boundedNativeRead(Promise.resolve('sample result'), 'stat')).resolves.toBe(
    'sample result'
  )
})

it('still bounds a lost portable read without a DOM window', async () => {
  vi.useFakeTimers()
  const result = boundedNativeRead(new Promise<never>(() => {}), 'stat').catch(
    (error: unknown) => error
  )
  await vi.advanceTimersByTimeAsync(15000)
  expect(await result).toMatchObject({ code: 'offline', retryable: true })
})
