import { expect, it, vi } from 'vitest'
import { retryTransientOperation } from '@/sync/transientOperation'

it('retries explicit offline hydration on the backoff and preserves success', async () => {
  vi.useFakeTimers()
  try {
    const work = vi
      .fn()
      .mockResolvedValueOnce({ status: 'offline' })
      .mockResolvedValue({ status: 'complete' })
    const result = retryTransientOperation(work, () => {})
    await vi.advanceTimersByTimeAsync(1999)
    expect(work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toEqual({ status: 'complete' })
  } finally {
    vi.useRealTimers()
  }
})
it('bounds offline retries and never retries refusal or stale ownership', async () => {
  vi.useFakeTimers()
  try {
    const work = vi.fn().mockResolvedValue({ status: 'offline' })
    const result = retryTransientOperation(work, () => {})
    await vi.advanceTimersByTimeAsync(6000)
    expect(await result).toEqual({ status: 'offline' })
    expect(work).toHaveBeenCalledTimes(3)
    const refused = vi.fn().mockResolvedValue({ status: 'denied' })
    expect(await retryTransientOperation(refused, () => {})).toEqual({ status: 'denied' })
    expect(refused).toHaveBeenCalledOnce()
    const stale = vi.fn().mockRejectedValue(new Error('Ownership lost'))
    await expect(retryTransientOperation(stale, () => {})).rejects.toThrow('Ownership lost')
    expect(stale).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})
it('rechecks ownership before retrying a native offline exception', async () => {
  vi.useFakeTimers()
  try {
    let current = true
    const work = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('Sync interrupted'), { code: 'offline' }))
    const result = retryTransientOperation(work, () => {
      if (!current) throw new Error('Ownership lost')
    }).catch((error) => error)
    await vi.advanceTimersByTimeAsync(1)
    current = false
    await vi.advanceTimersByTimeAsync(2000)
    expect(await result).toEqual(new Error('Ownership lost'))
    expect(work).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})
