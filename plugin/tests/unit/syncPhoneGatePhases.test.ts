import { afterEach, expect, it, vi } from 'vitest'
import { runGatePhase } from '../e2e/helpers/syncPhoneGatePhases'

afterEach(() => vi.useRealTimers())

it('does not let an earlier fast phase donate time to a slower phase', async () => {
  vi.useFakeTimers()
  await runGatePhase('prepare', 1000, async () => {})
  const slow = runGatePhase('pull', 100, async (signal) => {
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
  })
  const failed = expect(slow).rejects.toThrow('pull exceeded 100 ms')
  await vi.advanceTimersByTimeAsync(100)
  await failed
  expect(vi.getTimerCount()).toBe(0)
})

it('waits for cancellation cleanup before reporting the expired phase', async () => {
  vi.useFakeTimers()
  let closed = false
  const run = runGatePhase('desktop replica', 100, async (signal) => {
    try {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 10))
      closed = true
    }
  })
  const failed = expect(run).rejects.toThrow('desktop replica exceeded 100 ms')
  await vi.advanceTimersByTimeAsync(110)
  await failed
  expect(closed).toBe(true)
})

it('preserves the original failure and clears the phase timer', async () => {
  vi.useFakeTimers()
  const cause = new Error('byte inventory mismatch')
  await expect(
    runGatePhase('verify', 100, async () => {
      throw cause
    })
  ).rejects.toBe(cause)
  expect(vi.getTimerCount()).toBe(0)
})
