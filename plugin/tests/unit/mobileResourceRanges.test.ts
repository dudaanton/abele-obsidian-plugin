import { afterEach, expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { probeResourceRanges } from '@/sync/mobileResourceRanges'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
afterEach(() => vi.unstubAllGlobals())
function setup(status = 206) {
  const files = new Map<string, Uint8Array>()
  const folders = new Set<string>()
  const adapter = {
    getResourcePath: (path: string) =>
      'capacitor://localhost/_capacitor_file_/sample/' + path + '?v=123',
    exists: async (path: string) => files.has(path) || folders.has(path),
    mkdir: async (path: string) => {
      folders.add(path)
    },
    writeBinary: async (path: string, data: ArrayBuffer) => {
      files.set(path, new Uint8Array(data))
    },
    remove: async (path: string) => {
      files.delete(path)
    },
  } as unknown as DataAdapter
  const arrayBuffer = vi.fn()
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).not.toContain('?')
    const data = files.get(url.split('/sample/')[1])!
    const range = new Headers(init?.headers).get('Range')
    let body = data,
      headers: Record<string, string> = {}
    if (range && status === 206) {
      const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!
      body = data.slice(Number(start), Number(end) + 1)
      headers = {
        'Content-Range': `bytes ${start}-${end}/${data.length}`,
        'Content-Length': String(body.length),
      }
    }
    const response = new Response(body, { status: range ? status : 200, headers })
    const native = response.arrayBuffer.bind(response)
    response.arrayBuffer = async () => {
      arrayBuffer()
      return native()
    }
    return response
  })
  return { adapter, files, fetcher, arrayBuffer }
}
it('probes start, middle, last partial and un-ranged responses before accepting scheme ranges', async () => {
  const f = setup(),
    events: unknown[] = []
  const access = await probeResourceRanges(
    f.adapter,
    f.fetcher as unknown as typeof fetch,
    (event) => events.push(event)
  )
  expect(access).not.toBeNull()
  expect(f.fetcher).toHaveBeenCalledTimes(4)
  expect(f.files.size).toBe(0)
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ step: 'resource-response', status: 206, bodyBytes: 7 }),
      expect.objectContaining({ step: 'resource-response', status: 200, bodyBytes: 20480 }),
    ])
  )
})
it('refuses ignored ranges and records the tiny whole response', async () => {
  const f = setup(200),
    events: unknown[] = []
  expect(
    await probeResourceRanges(f.adapter, f.fetcher as unknown as typeof fetch, (event) =>
      events.push(event)
    )
  ).toBeNull()
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ step: 'resource-response', status: 200, bodyBytes: 20480 }),
    ])
  )
  expect(f.files.size).toBe(0)
})
it('records response headers even when the WebView cannot expose the body', async () => {
  const f = setup(200),
    events: unknown[] = []
  f.fetcher.mockImplementation(
    async () =>
      ({
        status: 200,
        headers: new Headers({ 'Content-Length': '20480' }),
        arrayBuffer: async () => {
          throw new Error('body unavailable')
        },
      }) as Response
  )
  expect(
    await probeResourceRanges(f.adapter, f.fetcher as unknown as typeof fetch, (event) =>
      events.push(event)
    )
  ).toBeNull()
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        step: 'resource-headers',
        status: 200,
        headers: { 'content-length': '20480' },
      }),
      expect.objectContaining({
        step: 'resource-response',
        status: 200,
        bodyBytes: null,
        message: 'body unavailable',
      }),
    ])
  )
  expect(f.files.size).toBe(0)
})
it('rejects a whole-file response on a large read before calling arrayBuffer', async () => {
  const f = setup()
  const access = await probeResourceRanges(f.adapter, f.fetcher as unknown as typeof fetch)
  f.fetcher.mockImplementation(
    async () =>
      ({
        status: 200,
        headers: new Headers(),
        body: { cancel: vi.fn(async () => {}) },
        arrayBuffer: f.arrayBuffer,
      }) as unknown as Response
  )
  f.arrayBuffer.mockClear()
  await expect(access!.read('sample.bin', 3 * 1024 ** 3, 0, 1024 * 1024)).rejects.toThrow('range')
  expect(f.arrayBuffer).not.toHaveBeenCalled()
})

it.each(['bytes 1-7/20480', 'bytes 0-6/*', null])(
  'refuses incorrect Content-Range %s before reading a large body',
  async (header) => {
    const f = setup()
    const access = await probeResourceRanges(f.adapter, f.fetcher as unknown as typeof fetch)
    f.fetcher.mockImplementation(
      async () =>
        ({
          status: 206,
          headers: new Headers(header ? { 'Content-Range': header } : {}),
          body: { cancel: vi.fn(async () => {}) },
          arrayBuffer: f.arrayBuffer,
        }) as unknown as Response
    )
    f.arrayBuffer.mockClear()
    await expect(access!.read('sample.bin', 3 * 1024 ** 3, 0, 7)).rejects.toThrow('range')
    expect(f.arrayBuffer).not.toHaveBeenCalled()
  }
)

it('rejects a body whose length differs from the authenticated range', async () => {
  const f = setup(),
    access = await probeResourceRanges(f.adapter, f.fetcher as unknown as typeof fetch)
  f.fetcher.mockImplementation(
    async () =>
      new Response(new Uint8Array(8), {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-6/20480' },
      })
  )
  await expect(access!.read('sample.bin', 20480, 0, 7)).rejects.toThrow('range')
})

it('uses validated WebView ranges before unavailable native APIs for a virtual multi-GiB source', async () => {
  const f = setup(),
    size = 3 * 1024 ** 3
  Object.assign(f.adapter, {
    stat: async () => ({ type: 'file', size, mtime: 1, ctime: 1 }),
    appendBinary: async () => {},
    readBinary: () => {
      throw new Error('whole-file read')
    },
  })
  const native = vi.fn(() => {
    throw new Error('Native fallback must not run')
  })
  vi.stubGlobal('Capacitor', {
    Plugins: { Filesystem: { stat: native, readFile: native, readFileInChunks: native } },
  })
  vi.stubGlobal('fetch', f.fetcher)
  const io = new BoundedVaultIo(f.adapter)
  expect(await io.diagnoseMobile()).toMatchObject({ available: true, mode: 'webview-ranges' })
  await io.requireTransfer(size)
  f.fetcher.mockImplementation(async (url, init) => {
    expect(url).not.toContain('?')
    const range = new Headers(init?.headers).get('Range')!
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!
    const length = Number(end) - Number(start) + 1
    expect(length).toBeLessThanOrEqual(1024 * 1024)
    return new Response(new Uint8Array(length).fill(73), {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${size}` },
    })
  })
  const source = await io.openRead('sample.bin')
  expect((await source.read(2 * 1024 ** 3, 1024 * 1024))[0]).toBe(73)
  const abort = new AbortController()
  abort.abort(new Error('sample cancellation'))
  const before = f.fetcher.mock.calls.length
  await expect(source.read(0, 7, abort.signal)).rejects.toThrow('sample cancellation')
  expect(f.fetcher.mock.calls.length).toBe(before)
  await source.close()
  expect(native).not.toHaveBeenCalled()
  expect(f.files.size).toBe(0)
})

it('keeps the large-file refusal when the WebView ignores Range and native reads are absent', async () => {
  const f = setup(200),
    readBinary = vi.fn(() => {
      throw new Error('whole-file read')
    })
  Object.assign(f.adapter, {
    stat: async () => ({ type: 'file', size: 200 * 1024 * 1024, mtime: 1, ctime: 1 }),
    appendBinary: async () => {},
    readBinary,
  })
  vi.stubGlobal('fetch', f.fetcher)
  vi.stubGlobal('Capacitor', undefined)
  const io = new BoundedVaultIo(f.adapter)
  await expect(io.requireTransfer(200 * 1024 * 1024)).rejects.toThrow('50 MiB')
  await expect(io.openRead('sample.bin')).rejects.toThrow('50 MiB')
  expect(readBinary).not.toHaveBeenCalled()
  expect(f.files.size).toBe(0)
})
