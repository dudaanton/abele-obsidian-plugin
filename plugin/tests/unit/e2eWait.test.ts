import { afterEach, describe, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE, until } from '../e2e/helpers/wait'

// Exercise the exact JavaScript sent to Obsidian as well as the host-side helper.
const inPage = new Function(`${WAIT_PRELUDE}; return until`)() as typeof until

afterEach(() => vi.useRealTimers())

for (const [name, poll] of [
  ['host', until],
  ['page', inPage],
] as const) {
  describe(`condition polling in the ${name}`, () => {
    it('returns an already-ready value without sleeping', async () => {
      vi.useFakeTimers()
      const value = { ready: true }
      expect(await poll(() => value)).toBe(value)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('awaits asynchronous predicates instead of accepting a truthy Promise', async () => {
      vi.useFakeTimers()
      const predicate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce('ready')
      const done = vi.fn()
      const result = poll(predicate).then(done)
      await vi.advanceTimersByTimeAsync(99)
      expect(done).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await result
      expect(done).toHaveBeenCalledWith('ready')
      expect(predicate).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('retries transient exceptions and rejected predicates', async () => {
      vi.useFakeTimers()
      const predicate = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('not mounted')
        })
        .mockRejectedValueOnce(new Error('not indexed'))
        .mockReturnValueOnce('ready')
      const result = poll(predicate)
      await vi.advanceTimersByTimeAsync(200)
      expect(await result).toBe('ready')
    })

    it('returns null at the deadline, even when the predicate keeps throwing', async () => {
      vi.useFakeTimers()
      const predicate = vi.fn(() => {
        throw new Error('missing')
      })
      const result = poll(predicate, 250)
      await vi.advanceTimersByTimeAsync(250)
      expect(await result).toBeNull()
      expect(predicate).toHaveBeenCalledTimes(3)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('uses the same fifteen-second default allowance', async () => {
      vi.useFakeTimers()
      const done = vi.fn()
      const result = poll(() => false).then(done)
      await vi.advanceTimersByTimeAsync(14999)
      expect(done).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await result
      expect(done).toHaveBeenCalledWith(null)
    })
  })
}
