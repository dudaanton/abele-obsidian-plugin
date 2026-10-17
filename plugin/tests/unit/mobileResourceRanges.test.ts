import { afterEach, expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { probeResourceRanges } from '@/sync/mobileResourceRanges'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { connectionAdapter } from '@/sync/connectionScope'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { mobileStreamFixture } from '../helpers/mobileStreamFixture'
afterEach(() => vi.unstubAllGlobals())

function legacyMobile() {
  const f = setup(200),
    size = 200 * 1024 * 1024
  const local = (path: string) =>
    path.startsWith('file:')
      ? new URL(path).pathname.split('/sample/')[1]
      : path.replace(/^sample-vault\//, '')
  const whole = vi.fn(() => {
    throw new Error('whole-file adapter read')
  })
  const readFile = vi.fn(async ({ path }: { path: string }) => {
    const bytes = f.files.get(local(path))
    if (!bytes) throw new Error('unbounded native read of large source')
    // This host ignores offset/length rather than rejecting unsupported options.
    return { data: btoa(String.fromCharCode(...bytes)) }
  })
  const readFileInChunks = vi.fn(async () => {
    throw new Error('Filesystem.readFileInChunks() is not implemented on ios')
  })
  const stat = async ({ path }: { path: string }) => {
    if (path.startsWith('/')) throw new Error('file not found')
    return { size: f.files.get(local(path))?.length ?? size }
  }
  Object.assign(f.adapter, {
    getFullPath: (path: string) => 'sample-vault/' + path,
    stat: async (path: string) => ({
      type: 'file',
      size: f.files.get(path)?.length ?? size,
      mtime: 1,
      ctime: 1,
    }),
    appendBinary: async () => {},
    readBinary: whole,
  })
  vi.stubGlobal('fetch', f.fetcher)
  // Proxy method presence does not mean the native host implements that method.
  vi.stubGlobal('Capacitor', {
    Plugins: { Filesystem: { stat, readFile, readFileInChunks } },
    PluginHeaders: [
      {
        name: 'Filesystem',
        methods: ['stat', 'readFile', 'appendFile'].map((name) => ({ name, rtype: 'promise' })),
      },
    ],
  })
  return { ...f, io: new BoundedVaultIo(f.adapter), whole, readFile, readFileInChunks, size }
}

it('reproduces a mobile host whose resources ignore ranges and whose chunk proxy is not implemented', async () => {
  const f = legacyMobile()
  const diagnosis = await f.io.diagnoseMobile()
  expect(diagnosis.available).toBe(false)
  expect(diagnosis.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        step: 'resource-response',
        status: 200,
        bodyBytes: 20480,
        validHeaders: false,
      }),
      expect.objectContaining({
        step: 'error',
        message: expect.stringContaining('not implemented on ios'),
      }),
      expect.objectContaining({
        step: 'error',
        message: 'Native filesystem ignored the bounded read',
      }),
    ])
  )
  expect(f.readFileInChunks).toHaveBeenCalled()
  expect(f.whole).not.toHaveBeenCalled()
  expect(f.files.size).toBe(0)
})

it('returns bounded upload parts from one 200 MiB whole mobile read', async () => {
  const f = mobileStreamFixture()
  const source = await new BoundedVaultIo(f.adapter).openUploadRead('sample.bin')
  try {
    for (let offset = 0; offset < f.size; offset += 1024 * 1024)
      expect((await source.read(offset, 1024 * 1024)).every((byte) => byte === 73)).toBe(true)
    expect(f.readBinary).toHaveBeenCalledOnce()
    expect(f.counts).toMatchObject({
      largeFetches: 0,
      bytesProduced: f.size,
      arrayBuffers: 0,
      blobs: 0,
    })
    expect(f.probes.size).toBe(0)
  } finally {
    await source.close()
  }
})

it('creates and removes resource probes only in the connection-owned staging area', async () => {
  const f = setup(),
    root = connectionPrivateRoot('sample-connection')
  const write = vi.spyOn(f.adapter, 'writeBinary'),
    remove = vi.spyOn(f.adapter, 'remove')
  const adapter = connectionAdapter(f.adapter, 'Shared', root)
  expect(
    await probeResourceRanges(
      adapter,
      f.fetcher as unknown as typeof fetch,
      () => {},
      '.obsidian',
      root
    )
  ).not.toBeNull()
  expect(write).toHaveBeenCalledOnce()
  expect(write.mock.calls[0][0]).toMatch(new RegExp('^' + root.replaceAll('.', '\\.') + '/writes/'))
  expect(remove.mock.calls.map(([path]) => path)).toEqual([write.mock.calls[0][0]])
  expect(f.files.size).toBe(0)
})
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
    // This older fixture explicitly has no stream API; its refusal remains required.
    Object.defineProperty(response, 'body', { value: null })
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

it('keeps the whole-file cap when the WebView ignores Range and native reads are absent', async () => {
  const f = setup(200),
    readBinary = vi.fn(() => {
      throw new Error('whole-file read')
    })
  Object.assign(f.adapter, {
    stat: async () => ({ type: 'file', size: 201 * 1024 * 1024, mtime: 1, ctime: 1 }),
    appendBinary: async () => {},
    readBinary,
  })
  vi.stubGlobal('fetch', f.fetcher)
  vi.stubGlobal('Capacitor', undefined)
  const io = new BoundedVaultIo(f.adapter)
  await expect(io.requireTransfer(201 * 1024 * 1024)).rejects.toThrow('200 MiB')
  await expect(io.openUploadRead('sample.bin')).rejects.toThrow('200 MiB')
  expect(readBinary).not.toHaveBeenCalled()
  expect(f.files.size).toBe(0)
})
