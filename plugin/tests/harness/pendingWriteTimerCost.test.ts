import { expect, it, vi } from 'vitest'
import { trackWriteTimers } from '../setup/pendingWrites'

it('does not format diagnostic stacks for timers without a write producer', () => {
  const original = Error.prepareStackTrace
  const format = vi.fn((error: Error, frames: NodeJS.CallSite[]) =>
    original ? original(error, frames) : 'sample timer stack'
  )
  const restore = trackWriteTimers()
  let formatted = -1
  try {
    Error.prepareStackTrace = format
    for (let i = 0; i < 100; i++) {
      const timer = setTimeout(() => {}, 15000)
      clearTimeout(timer)
    }
    formatted = format.mock.calls.length
  } finally {
    Error.prepareStackTrace = original
    restore()
  }
  expect(formatted).toBe(0)
})
