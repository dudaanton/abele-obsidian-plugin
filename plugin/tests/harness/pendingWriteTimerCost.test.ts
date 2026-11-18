import { expect, it, vi } from 'vitest'
import { trackWriteTimers } from '../setup/pendingWrites'

it.each([
  'ChatSession.markDirty',
  'BookBookmarks.schedule',
  'BookPlaces.schedule',
  'PdfInk.changed',
  'GithubUsers.scheduleSave',
])('still classifies the named write producer %s', (name) => {
  const [type, method] = name.split('.')
  const Producer = new Function(
    `return class ${type} { ${method}() { return setTimeout(() => {}, 15000) } }`
  )()
  const original = Error.prepareStackTrace
  const format = vi.fn((error: Error, frames: NodeJS.CallSite[]) =>
    original ? original(error, frames) : 'sample write stack'
  )
  const restore = trackWriteTimers()
  try {
    Error.prepareStackTrace = format
    const timer = new Producer()[method]()
    clearTimeout(timer)
    expect(format).toHaveBeenCalled()
  } finally {
    Error.prepareStackTrace = original
    restore()
  }
})

it('does not resolve receiver property names while classifying native timers', () => {
  const lookup = vi.fn(() => 'sampleCallback')
  class TimerError extends Error {
    constructor() {
      super()
      Object.defineProperty(this, 'stack', {
        value: [
          {
            getTypeName: () => 'Object',
            getFunctionName: () => 'sampleCallback',
            getMethodName: lookup,
          },
        ],
      })
    }
  }
  const restore = trackWriteTimers()
  try {
    vi.stubGlobal('Error', TimerError)
    const timer = setTimeout(() => {}, 15000)
    clearTimeout(timer)
    expect(lookup).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
    restore()
  }
})

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
