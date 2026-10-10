import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { modelFetch, nativeModelFetch } from '@/ai/client/modelFetch'
import type { SessionNet } from '@/sync/desktopNet'
import { getModelNet } from '@/ai/client/modelNet'
import { getDesktopNet } from '@/helpers/netTransport'

vi.mock('@/helpers/netTransport', () => ({ getDesktopNet: vi.fn(() => null) }))
vi.mock('@/ai/client/modelNet', () => ({ getModelNet: vi.fn() }))

afterEach(() => vi.restoreAllMocks())

function host(fetch: typeof window.fetch): SessionNet {
  return {
    session: { fetch },
    bytes: (bytes) => new Uint8Array(bytes),
    body: (bytes) => new Uint8Array(bytes),
    controller: () => new AbortController(),
  }
}

describe('named model streaming transport', () => {
  it('keeps browser fetch for empty names, even on desktop', async () => {
    vi.mocked(getDesktopNet).mockReturnValue({} as ReturnType<typeof getDesktopNet>)
    const browser = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('sample'))
    for (const name of [undefined, '', '   '])
      await modelFetch('https://model.example.invalid', {}, name)
    expect(browser).toHaveBeenCalledTimes(3)
    expect(getModelNet).not.toHaveBeenCalled()
  })

  it('keeps browser streaming when native desktop networking is unavailable', async () => {
    vi.mocked(getDesktopNet).mockReturnValue(null)
    const browser = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('sample'))
    await modelFetch(
      'https://model.example.invalid',
      { headers: { 'User-Agent': 'SampleClient/1.0' } },
      'SampleClient/1.0'
    )
    expect(browser).toHaveBeenCalledOnce()
    expect(getModelNet).not.toHaveBeenCalled()
  })

  it('selects native desktop fetch and sends the identity to a capturing server before EOF', async () => {
    let captured: Record<string, string | string[] | undefined> = {}
    let finish!: () => void
    const server = createServer((request, response) => {
      captured = request.headers
      response.setHeader('Access-Control-Allow-Origin', '*')
      response.setHeader('Access-Control-Allow-Headers', '*')
      if (request.method === 'OPTIONS') {
        response.end()
        return
      }
      response.setHeader('Content-Type', 'text/event-stream')
      response.setHeader('X-Sample', 'sample-value')
      response.write('data: first\n\n')
      finish = () => response.end('data: [DONE]\n\n')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const browserFetch = window.fetch.bind(window)
    vi.mocked(getDesktopNet).mockReturnValue({} as ReturnType<typeof getDesktopNet>)
    vi.mocked(getModelNet).mockReturnValue(host(browserFetch))
    const browser = vi
      .spyOn(window, 'fetch')
      .mockRejectedValue(new Error('browser fetch must not run'))
    try {
      const response = await modelFetch(
        url,
        { headers: { 'User-Agent': 'SampleClient/1.0' } },
        'SampleClient/1.0'
      )
      expect(response.headers.get('x-sample')).toBe('sample-value')
      expect(captured['user-agent']).toBe('SampleClient/1.0')
      expect(browser).not.toHaveBeenCalled()
      const reader = response.body!.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n')
      finish()
      expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: [DONE]\n\n')
      expect((await reader.read()).done).toBe(true)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('bridges only the visible range of a native chunk', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new Uint8Array([0, 65, 66, 0]).subarray(1, 3))
            stream.close()
          },
        })
      )
    )
    expect(
      await (await nativeModelFetch(host(fetch), 'https://model.example.invalid', {})).text()
    ).toBe('AB')
  })

  it('preserves HTTP failures for the client to report', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('sample error', { status: 429 }))
    const response = await nativeModelFetch(host(fetch), 'https://model.example.invalid', {})
    expect(response.status).toBe(429)
    expect(await response.text()).toBe('sample error')
  })

  it('aborts a pending connection and an idle stream through the native controller', async () => {
    for (const connected of [false, true]) {
      const controller = new AbortController()
      const fetch = vi.fn((_url, init) =>
        connected
          ? Promise.resolve(
              new Response(
                new ReadableStream({
                  start(stream) {
                    init!.signal!.addEventListener('abort', () =>
                      stream.error(new DOMException('Aborted', 'AbortError'))
                    )
                  },
                })
              )
            )
          : new Promise<Response>((_resolve, reject) =>
              init!.signal!.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError'))
              )
            )
      )
      const work = nativeModelFetch(host(fetch), 'https://model.example.invalid', {
        signal: controller.signal,
      })
      const read = connected ? (await work).body!.getReader().read() : work
      controller.abort()
      await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    }
  })

  it('cancelling the response aborts the native stream', async () => {
    let signal: AbortSignal | null | undefined
    const fetch = vi.fn((_url, init) => {
      signal = init?.signal
      return Promise.resolve(new Response(new ReadableStream()))
    })
    const response = await nativeModelFetch(host(fetch), 'https://model.example.invalid', {})
    await response.body!.cancel()
    expect(signal?.aborted).toBe(true)
  })
})
