import { describe, expect, it } from 'vitest'
import { visibilityPayloadProgress, largeFileThroughput } from './payload-progress.mjs'
import writes from './writes.cjs'
import { WireProxy } from './proxy.mjs'
import { createServer } from 'node:http'

const MiB = 1024 ** 2
const windows = [0, 30000, 60000].map((beginAt) => ({
  beginAt,
  endAt: beginAt + 30000,
  installSeals: 0,
  quitOrUnload: [],
}))
const ready = { event: 'write-observer-ready', at: -1, device: '1', generation: 'sample' }
function write(id: number, at: number, bytes = MiB, extra = {}) {
  return [
    {
      event: 'write-start',
      device: '1',
      generation: 'sample',
      id,
      at: at - 1,
      source: 'abele',
      method: 'handle.write',
      path: '.abele-sync/connections/sample/writes/sample.tmp',
      bytes,
    },
    {
      event: 'write-finish',
      device: '1',
      generation: 'sample',
      id,
      at,
      bytesWritten: bytes,
      ...extra,
    },
  ]
}

describe('visibility payload progress', () => {
  it('passes zero-seal windows with confirmed payload writes and fails a true stall', () => {
    const rows = [
      ready,
      ...write(1, 5),
      ...write(2, 30005),
      ...Array.from({ length: 120 }, (_, i) => write(i + 3, 60005 + i * 200)).flat(),
    ]
    const result = visibilityPayloadProgress(rows, windows, { device: '1', scope: 'Sample' })
    expect(result.complete).toBe(true)
    expect(result.segments[2].installedPayloadBytes).toBe(120 * MiB)
    expect(result.segments[2].installSeals).toBe(0)
    const stalled = visibilityPayloadProgress(
      rows.filter((row) => row.at < 60000),
      windows,
      { device: '1', scope: 'Sample' }
    )
    expect(stalled.complete).toBe(false)
    expect(stalled.segments[2].installedPayloadBytes).toBe(0)
  })

  it('excludes failures, in-flight writes, host/state writes, responses alone and duplicate layers', () => {
    const rows = [
      ready,
      ...write(1, 5),
      ...write(2, 30005),
      ...write(3, 60002, MiB, { failed: true }),
      ...write(4, 60003, MiB, { bytesWritten: 0 }),
      ...write(5, 90001),
      { ...write(6, 60005)[0], path: '.abele-sync/connections/sample/state.json' },
      write(6, 60005)[1],
      { ...write(7, 60006)[0], source: 'host' },
      write(7, 60006)[1],
      { event: 'finish', device: '1', at: 60007, status: 206, bytes: MiB },
    ]
    expect(
      visibilityPayloadProgress(rows, windows, { device: '1', scope: 'Sample' }).complete
    ).toBe(false)
    const parent = write(9, 60030, MiB)
    parent[0] = { ...parent[0], at: 60009, method: 'native.writeFile' }
    const child = write(10, 60020, MiB)
    const result = visibilityPayloadProgress([...rows, ...parent, ...child, child[1]], windows, {
      device: '1',
      scope: 'Sample',
    })
    expect(result.segments[2].installedPayloadBytes).toBe(MiB)
    expect(result.complete).toBe(true)
    expect(
      visibilityPayloadProgress(
        [...rows, ...child, { event: 'write-observer-error', device: '1', at: 60025 }],
        windows,
        { device: '1', scope: 'Sample' }
      ).complete
    ).toBe(false)
  })

  it('records the actual bytes returned by the native handle write', async () => {
    const rows: any[] = []
    const handle = { write: async (..._args: unknown[]) => ({ bytesWritten: 3 }) }
    const native = { open: async (..._args: unknown[]) => handle, rename: async () => {} }
    const restore = writes.observeWrites(
      { getBasePath: () => '/sample-vault', fsPromises: native, writeBinary: async () => {} },
      (row: any) => rows.push(row)
    )
    try {
      const opened = await native.open('/sample-vault/sample.tmp', 'w')
      await opened.write(Buffer.alloc(100))
      expect(rows.filter((row) => row.event === 'write-finish').at(-1).bytesWritten).toBe(3)
    } finally {
      restore()
    }
  })
  it('keeps the leaf write when layer timestamps have identical millisecond boundaries', () => {
    const parent = write(3, 60020)
    parent[0] = { ...parent[0], at: 60019, method: 'native.writeFile' }
    const result = visibilityPayloadProgress(
      [ready, ...write(1, 5), ...write(2, 30005), ...parent, ...write(4, 60020)],
      windows,
      { device: '1', scope: 'Sample' }
    )
    expect(result.complete).toBe(true)
    expect(result.segments[2].installedPayloadBytes).toBe(MiB)
  })
})

describe('large-file throughput', () => {
  it('records numeric range offsets without persisting request headers', async () => {
    const upstream = createServer((_req, res) => {
      res.writeHead(206)
      res.end('sample')
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const address = upstream.address() as { port: number }
    const proxy = new WireProxy(`http://127.0.0.1:${address.port}`, 'sample')
    try {
      const endpoint = await proxy.start()
      const response = await globalThis.fetch(endpoint + '/v2/files/sample/content', {
        headers: { range: 'bytes=1048576-2097151', authorization: 'Bearer sample-private' },
      })
      await response.text()
      const start = proxy.events.find((row: any) => row.event === 'start')
      expect(start.range).toEqual({ start: MiB, end: 2 * MiB - 1 })
      expect(JSON.stringify(proxy.events)).not.toContain('sample-private')
    } finally {
      await proxy.close()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })
  it('measures first range to seal and distinguishes sequential and parallel chunks', () => {
    const wire = [0, 1].flatMap((i) => [
      {
        event: 'start',
        device: '1',
        id: i,
        at: i * 10000,
        method: 'GET',
        route: '/v2/files/sample/content',
        version: 'v',
        range: { start: i * 40 * MiB, end: (i + 1) * 40 * MiB - 1 },
      },
      { event: 'finish', device: '1', id: i, at: (i + 1) * 10000, status: 206, bytes: 40 * MiB },
    ])
    const seals = [
      {
        device: '1',
        event: 'renderer-hash',
        source: 'abele',
        stack: 'at async Object.seal',
        sha: 'sample',
        at: 20000,
        bytes: 80 * MiB,
      },
    ]
    const report = largeFileThroughput(seals, wire, new Map([['v', 'sample']]), {
      device: '1',
      beginAt: 0,
      endAt: 30000,
    })
    expect(report[0]).toMatchObject({
      size: 80 * MiB,
      mibPerSecond: 4,
      durationMs: 20000,
      pattern: 'sequential',
      maxConcurrent: 1,
      chunkSizes: [{ bytes: 40 * MiB, count: 2 }],
    })
    wire[2].at = 5000
    expect(
      largeFileThroughput(seals, wire, new Map([['v', 'sample']]), {
        device: '1',
        beginAt: 0,
        endAt: 30000,
      })[0]
    ).toMatchObject({ pattern: 'parallel', maxConcurrent: 2 })
  })
})
