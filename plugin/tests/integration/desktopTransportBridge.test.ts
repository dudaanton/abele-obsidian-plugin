// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { desktopTransport } from '@/sync/desktopTransport'
import { remoteSessionNet, type RemoteBridge, type SessionNet } from '@/sync/desktopNet'

const sessionAwareNet = vi.hoisted(() => vi.fn())
vi.mock('@/sync/desktopNet', async (original) => ({
  ...(await original<typeof import('@/sync/desktopNet')>()),
  sessionAwareNet,
}))

/** A fake remote bridge that counts every handle it hands out. */
function countingRemote(fetch: typeof globalThis.fetch) {
  const calls = { webContents: 0, require: 0, getGlobal: 0, bufferFrom: 0, arrayFrom: 0 }
  const remote = {
    getCurrentWebContents: () => {
      calls.webContents++
      return { session: { fetch } }
    },
    require: () => {
      calls.require++
      return {
        Buffer: {
          from: (bytes: ArrayBuffer) => {
            calls.bufferFrom++
            return new Uint8Array(bytes)
          },
        },
      }
    },
    getGlobal: (name: string) => {
      calls.getGlobal++
      if (name === 'Array')
        return {
          from: (source: Headers) => {
            calls.arrayFrom++
            return Array.from(source)
          },
        }
      return AbortController
    },
  } as unknown as RemoteBridge
  return { remote, calls }
}

const localBuffer = { from: (bytes: ArrayBuffer) => new Uint8Array(bytes) }

describe('desktop transport bridge handles', () => {
  it('resolves the remote handles once per host, not once per request', async () => {
    const { remote, calls } = countingRemote(async () => new Response('sample'))
    const net = remoteSessionNet(remote, localBuffer)
    const fetch = desktopTransport(undefined, net)
    for (let i = 0; i < 5; i++)
      expect(await (await fetch('https://sync.example/a')).text()).toBe('sample')
    expect(calls).toMatchObject({ webContents: 1, require: 1, getGlobal: 2 })
    // Headers cross the bridge in one call per response.
    expect(calls.arrayFrom).toBe(5)
  })

  it('builds the production host once per transport', async () => {
    const { remote } = countingRemote(async () => new Response('sample'))
    sessionAwareNet.mockReset().mockImplementation(() => remoteSessionNet(remote, localBuffer))
    const fetch = desktopTransport()
    for (let i = 0; i < 3; i++) await (await fetch('https://sync.example/a')).text()
    expect(sessionAwareNet).toHaveBeenCalledTimes(1)
  })

  it('keeps repeated headers joined as Headers.get joins them', async () => {
    const headers = new Headers()
    headers.append('x-sample', 'one')
    headers.append('x-sample', 'two')
    headers.append('set-cookie', 'a=1')
    headers.append('set-cookie', 'b=2')
    headers.set('content-type', 'text/plain')
    const { remote } = countingRemote(async () => new Response('body', { headers }))
    const response = await desktopTransport(
      undefined,
      remoteSessionNet(remote, localBuffer)
    )('https://sync.example/h')
    expect(response.headers.get('x-sample')).toBe(headers.get('x-sample'))
    expect(response.headers.get('content-type')).toBe('text/plain')
    expect(await response.text()).toBe('body')
  })

  it('reads a small declared body in one bridge read and streams a large one in chunks', async () => {
    const reads = { whole: 0, chunks: 0 }
    const host = (size: number): SessionNet => ({
      session: {
        fetch: async () => {
          const bytes = new Uint8Array(size).fill(7)
          const response = new Response(bytes, { headers: { 'content-length': String(size) } })
          const whole = response.arrayBuffer.bind(response)
          vi.spyOn(response, 'arrayBuffer').mockImplementation(() => {
            reads.whole++
            return whole()
          })
          return response
        },
      },
      bytes: (buffer) => {
        reads.chunks++
        return new Uint8Array(buffer)
      },
      body: (buffer) => new Uint8Array(buffer),
      controller: () => new AbortController(),
    })
    const small = await desktopTransport(undefined, host(1000))('https://sync.example/s')
    expect(new Uint8Array(await small.arrayBuffer())).toEqual(new Uint8Array(1000).fill(7))
    expect(reads).toEqual({ whole: 1, chunks: 1 })
    const large = await desktopTransport(undefined, host(200_000))('https://sync.example/l')
    expect((await large.arrayBuffer()).byteLength).toBe(200_000)
    expect(reads.whole).toBe(1)
  })

  it('still refuses a redirect and reports an abort during a small read', async () => {
    const { remote } = countingRemote(
      async () => new Response(null, { status: 307, headers: { location: 'https://x.example' } })
    )
    await expect(
      desktopTransport(undefined, remoteSessionNet(remote, localBuffer))('https://sync.example/r')
    ).rejects.toThrow(/refuses redirects/)
    const controller = new AbortController()
    const native = new AbortController()
    const fetch = desktopTransport(undefined, {
      session: {
        fetch: async () => {
          const response = new Response('x', { headers: { 'content-length': '1' } })
          vi.spyOn(response, 'arrayBuffer').mockImplementation(
            () =>
              new Promise((_resolve, reject) =>
                native.signal.addEventListener('abort', () => reject(new Error('aborted')))
              )
          )
          return response
        },
      },
      bytes: (buffer) => new Uint8Array(buffer),
      body: (buffer) => new Uint8Array(buffer),
      controller: () => native,
    })
    const pending = fetch('https://sync.example/a', { signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    await expect(pending).rejects.toThrow(/abort/i)
    expect(native.signal.aborted).toBe(true)
  })
})
