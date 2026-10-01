import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAIClient } from '@/ai/client/OpenAIClient'

// Exercise the parser directly so malformed frames never reach the chat assembler.
const parse = (stream: ReadableStream<Uint8Array>) =>
  (
    new OpenAIClient() as unknown as {
      parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown>
    }
  ).parseSSE(stream)

afterEach(() => vi.useRealTimers())
describe('chat stream bounds', () => {
  it('abandons a silent reader', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ cancel })
    const check = expect(parse(stream).next()).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(60_001)
    await check
    expect(cancel).toHaveBeenCalled()
  })
  it('refuses an endless SSE line', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: ' + 'x'.repeat(2 * 1024 * 1024 + 1)))
      },
      cancel,
    })
    await expect(parse(stream).next()).rejects.toThrow(/too large/i)
    expect(cancel).toHaveBeenCalled()
  })
})
