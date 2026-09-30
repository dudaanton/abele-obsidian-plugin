import { afterEach, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { trackWriteTimers } from '../setup/pendingWrites'

/** Opt in per file; keep setImmediate real so flushPromises can drain host microtasks. */
export function useFakeClock(): (ms?: number) => Promise<void> {
  let untrack: (() => void) | undefined
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'Date',
        'performance',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    })
    untrack = trackWriteTimers()
  })
  // Registered before the file's teardown so unmount/dispose still sees its own clock.
  afterEach(() => {
    untrack?.()
    vi.useRealTimers()
  })
  return async (ms = 0) => {
    if (!vi.isFakeTimers()) throw new Error('Advance requires the test clock')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(ms)
    await flushPromises()
  }
}
