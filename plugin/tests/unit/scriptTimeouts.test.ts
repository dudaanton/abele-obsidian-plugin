/**
 * How long a script waits for the network.
 *
 * Nothing here used to say: `ctx.fetch` and the two downloads waited for as long as the
 * platform waited, and a script that wanted to give up after ten seconds — or to sit through a
 * five-minute export — had no way to say so. Now each call takes a `timeout` in milliseconds,
 * any value, and without one they wait as long as they always did.
 *
 * What is asserted is the waiting and the giving up, not the request: `requestUrl` is
 * Obsidian's and is stubbed here with a promise the test controls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }))

vi.mock('obsidian', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../mocks/obsidian')),
  requestUrl,
}))

const context = () =>
  buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })

/** A request that never answers, so only the timeout can end the wait. */
function neverAnswers(): void {
  requestUrl.mockImplementation(() => new Promise(() => {}))
}

beforeEach(() => {
  useVault([])
  // The download tools read the image providers on the way in; nothing here uses them.
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  requestUrl.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a request with a timeout', () => {
  it('gives up when the time is up, and says which url it was', async () => {
    neverAnswers()
    const ctx = context()

    const pending = ctx.fetch('https://example.com/slow', { timeout: 5000 })
    const settled = expect(pending).rejects.toThrow(/timed out after 5s/)
    await vi.advanceTimersByTimeAsync(5001)

    await settled
  })

  it('answers normally when the answer comes first', async () => {
    requestUrl.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      text: 'here',
      json: null,
    })
    const ctx = context()

    const answered = await ctx.fetch('https://example.com/quick', { timeout: 5000 })

    expect(answered.status).toBe(200)
    expect(answered.text).toBe('here')
  })

  /** Any value: the point of the setting is that nothing here decides what is reasonable. */
  it('takes a timeout longer than anything this plugin would have chosen', async () => {
    neverAnswers()
    const ctx = context()

    const pending = ctx.fetch('https://example.com/export', { timeout: 20 * 60 * 1000 })
    const settled = expect(pending).rejects.toThrow(/timed out after 1200s/)

    // Still waiting well past every timeout the platform or this plugin has ever had.
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1)

    await settled
  })

  it('waits as long as it always did when nobody said otherwise', async () => {
    neverAnswers()
    const ctx = context()

    let settled = false
    void ctx.fetch('https://example.com/slow').then(
      () => (settled = true),
      () => (settled = true)
    )
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)

    expect(settled).toBe(false)
  })
})

describe('a download with a timeout', () => {
  it('gives up on a file that never arrives', async () => {
    neverAnswers()
    const ctx = context()

    const pending = ctx.downloadFile('https://example.com/big.zip', { timeout: 2000 })
    const settled = expect(pending).rejects.toThrow(/timed out after 2s/)
    await vi.advanceTimersByTimeAsync(2001)

    await settled
  })

  it('gives up on an image that never arrives', async () => {
    neverAnswers()
    const ctx = context()

    const pending = ctx.downloadImage('https://example.com/big.png', { timeout: 2000 })
    const settled = expect(pending).rejects.toThrow(/timed out after 2s/)
    await vi.advanceTimersByTimeAsync(2001)

    await settled
  })
})
