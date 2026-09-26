/**
 * One step of the plugin's start failing, or never finishing, no longer ends the start there
 * without a word: the step is named in the console and the next one runs.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { beginStartup, startupStep, startupStepAsync, SLOW_STEP_MS } from '@/helpers/startupSteps'

let error: ReturnType<typeof vi.spyOn>
let warn: ReturnType<typeof vi.spyOn>
let debug: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
  beginStartup()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('a startup step', () => {
  it('that throws is named, and the steps after it still run', () => {
    const ran: string[] = []
    startupStep('settings', () => {
      throw new Error('boom')
    })
    startupStep('views', () => void ran.push('views'))

    expect(ran).toEqual(['views'])
    expect(String(error.mock.calls[0][0])).toContain('settings')
    expect(debug.mock.calls.some((c) => String(c[0]).includes('views'))).toBe(true)
  })

  it('that rejects is named, and the start goes on', async () => {
    await startupStepAsync('secrets', () => Promise.reject(new Error('locked')))
    let after = false
    await startupStepAsync('store', async () => {
      after = true
    })

    expect(after).toBe(true)
    expect(String(error.mock.calls[0][0])).toContain('secrets')
  })

  it('that hangs says what it is waiting on', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const pending = startupStepAsync('settings file', () => new Promise<void>((r) => (finish = r)))

    vi.advanceTimersByTime(SLOW_STEP_MS + 1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('settings file')

    finish()
    await pending
  })
})
