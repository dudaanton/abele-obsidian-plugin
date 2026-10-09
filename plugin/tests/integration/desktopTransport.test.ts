// @vitest-environment node
import { createServer, type Server, type RequestListener } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { transportOf } from '@/sync/environment'
import { desktopTransport } from '@/sync/desktopTransport'
import * as obsidian from 'obsidian'

vi.mock('@/sync/desktopNet', () => ({
  sessionAwareNet: () => ({
    session: {
      fetch: (url: RequestInfo | URL, options: RequestInit) => {
        expect(options.redirect).toBe('manual')
        expect(options.credentials).toBe('omit')
        expect(options.cache).toBe('no-store')
        return globalThis.fetch(url, options)
      },
    },
    bytes: (buffer: ArrayBuffer) => new Uint8Array(buffer),
    body: (buffer: ArrayBuffer) => new Uint8Array(buffer),
    controller: () => new AbortController(),
  }),
}))

// Socket-level translation checks use a manual-redirect Node fetch test port. Native Electron
// session/redirect/proxy behavior is asserted independently in the desktop e2e gate.
const servers: Server[] = []
async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No listener')
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections()
        })
    )
  )
})

describe('production desktop credential transport', () => {
  it('bridges bounded response chunks without reading a whole native ArrayBuffer', async () => {
    const chunk = new Uint8Array(65536).fill(91)
    let remaining = 32
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          if (remaining--) controller.enqueue(chunk)
          else controller.close()
        },
      })
    )
    const wholeBody = vi
      .spyOn(response, 'arrayBuffer')
      .mockRejectedValue(new Error('whole-body read'))
    const converted = vi.fn((buffer: ArrayBuffer) => {
      expect(buffer.byteLength).toBeLessThanOrEqual(65536)
      return new Uint8Array(buffer)
    })
    const fetch = desktopTransport(undefined, {
      session: { fetch: vi.fn(async () => response) },
      bytes: converted,
      body: (buffer) => new Uint8Array(buffer),
      controller: () => new AbortController(),
    })
    const bytes = new Uint8Array(await (await fetch('https://sync.example/bytes')).arrayBuffer())
    expect(bytes.length).toBe(32 * chunk.length)
    expect(bytes.every((byte) => byte === 91)).toBe(true)
    expect(converted).toHaveBeenCalledTimes(32)
    expect(wholeBody).not.toHaveBeenCalled()
  })
  it('uses an explicit native host for desktop layout emulation without opening production mobile transport', async () => {
    const source = await listen((_req, res) => res.end('sample native response'))
    const original = { ...obsidian.Platform }
    vi.stubGlobal('window', {})
    Object.assign(obsidian.Platform, { isDesktop: false, isMobile: true })
    try {
      expect(() => transportOf({})).toThrow(/unsupported/)
      await expect(desktopTransport()(source)).rejects.toThrow(/unavailable/)
      const host = {
        session: { fetch: globalThis.fetch },
        bytes: (buffer: ArrayBuffer) => new Uint8Array(buffer),
        body: (buffer: ArrayBuffer) => new Uint8Array(buffer),
        controller: () => new AbortController(),
      }
      const fetch = desktopTransport(undefined, host)
      expect(await (await fetch(source)).text()).toBe('sample native response')
      expect(obsidian.Platform.isDesktop).toBe(false)
      expect(obsidian.Platform.isMobile).toBe(true)
      expect(() => transportOf({})).toThrow(/unsupported/)
    } finally {
      Object.assign(obsidian.Platform, original)
      vi.unstubAllGlobals()
    }
  })

  it.each([301, 307, 308])(
    'does not use the auto-following API for %s or contact the second listener',
    async (status) => {
      const sink: string[] = []
      const second = await listen((req, res) => {
        sink.push(req.headers.authorization ?? '')
        res.end('forwarded')
      })
      const source = await listen((_req, res) => {
        res.writeHead(status, { location: second + '/sink' })
        res.end()
      })
      const call = vi.spyOn(obsidian, 'requestUrl')
      await expect(
        transportOf({})(source + '/redirect', {
          method: 'POST',
          headers: { authorization: 'Bearer sample-credential' },
          body: 'sample-password',
        })
      ).rejects.toThrow(/refuses redirects/)
      expect(sink).toEqual([])
      expect(call).not.toHaveBeenCalled()
    }
  )

  it('preserves bytes, content type and bodiless statuses without a redirect helper', async () => {
    const observed: { type?: string; bytes: number[] }[] = []
    const source = await listen(async (req, res) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      observed.push({ type: req.headers['content-type'], bytes: [...Buffer.concat(chunks)] })
      res.statusCode = req.url === '/unchanged' ? 304 : 200
      res.end(Buffer.from([2, 3]))
    })
    const fetch = transportOf({})
    const response = await fetch(source + '/bytes', {
      method: 'PUT',
      body: new Uint8Array([1, 2, 3, 4]).subarray(1, 3),
      headers: { 'content-type': 'application/octet-stream' },
    })
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3])
    expect(observed[0]).toEqual({ type: 'application/octet-stream', bytes: [2, 3] })
    const unchanged = await fetch(source + '/unchanged')
    expect(unchanged.status).toBe(304)
    expect(await unchanged.text()).toBe('')
  })

  it('honours an already aborted signal without contacting the listener', async () => {
    let contacted = false
    const source = await listen((_req, res) => {
      contacted = true
      res.end()
    })
    const controller = new AbortController()
    controller.abort()
    await expect(transportOf({})(source, { signal: controller.signal })).rejects.toThrow(/abort/i)
    expect(contacted).toBe(false)
  })

  it('aborts an in-flight response and releases the request', async () => {
    let received!: () => void
    const started = new Promise<void>((resolve) => {
      received = resolve
    })
    const source = await listen((_req, res) => {
      res.writeHead(200)
      res.write('partial')
      received()
    })
    const controller = new AbortController()
    const request = transportOf({})(source, { signal: controller.signal })
    const rejected = expect(request).rejects.toThrow(/abort/i)
    await started
    controller.abort()
    await rejected
  })

  it('returns each principal response independently, including a cached-looking GET and HEAD', async () => {
    const source = await listen((req, res) => {
      res.setHeader('cache-control', 'max-age=3600')
      if (req.headers.authorization === 'Bearer first-principal') res.end('first')
      else {
        res.statusCode = 403
        res.end('second')
      }
    })
    const fetch = transportOf({})
    expect(
      await (await fetch(source, { headers: { authorization: 'Bearer first-principal' } })).text()
    ).toBe('first')
    expect(
      (await fetch(source, { headers: { authorization: 'Bearer second-principal' } })).status
    ).toBe(403)
    expect(
      (
        await fetch(source, {
          method: 'HEAD',
          headers: { authorization: 'Bearer second-principal' },
        })
      ).status
    ).toBe(403)
  })
})
