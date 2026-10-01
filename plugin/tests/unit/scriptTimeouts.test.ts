/**
 * How long a script waits for the network.
 *
 * `ctx.fetch` has a five-minute ceiling, including when its timeout is omitted or longer.
 * A shorter timeout still ends the wait earlier. Downloads also accept a timeout to shorten
 * their service deadline. These expectations deliberately replace the old unlimited-fetch
 * contract with the approved five-minute limit.
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

  it('caps an explicitly longer fetch timeout at five minutes', async () => {
    neverAnswers()
    const ctx = context()

    const pending = ctx.fetch('https://sample.example/export', { timeout: 20 * 60 * 1000 })
    let finished = false
    void pending.then(
      () => (finished = true),
      () => (finished = true)
    )
    const settled = expect(pending).rejects.toThrow(/timed out after 300s/)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(2)

    await settled
    expect(finished).toBe(true)
  })

  it('uses the five-minute fetch deadline when no timeout is supplied', async () => {
    neverAnswers()
    const ctx = context()

    const pending = ctx.fetch('https://sample.example/slow')
    let finished = false
    void pending.then(
      () => (finished = true),
      () => (finished = true)
    )
    const settled = expect(pending).rejects.toThrow(/timed out after 300s/)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(2)

    await settled
    expect(finished).toBe(true)
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
