import { expect, it, vi } from 'vitest'
import { V2EngineClient } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { rangedBinaryTransport } from '@/sync/rangedBinaryTransport'
import { fetchViaCapacitorHttp } from '@/sync/mobileTransport'

const MiB = 1024 * 1024
const token = encodeAccessToken({
  v: 1,
  address: 'https://sync.example',
  key: 'a'.repeat(43),
  scope: { kind: 'folder', id: 'sample-root', path: '/' },
})
function fixture(size: number, wrongTotal = false) {
  const ranges: string[] = []
  const request = vi.fn(async (options) => {
    const range = new Headers(options.headers).get('range')!
    ranges.push(range)
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range)!.map(Number)
    const length = end - start + 1
    expect(
      length,
      'the native bridge must never buffer a suffix-sized response'
    ).toBeLessThanOrEqual(MiB)
    return {
      status: 206,
      url: options.url,
      headers: {
        'content-range': `bytes ${start}-${end}/${wrongTotal && start > 0 ? size + 1 : size}`,
      },
      data: btoa('I'.repeat(length)),
    }
  })
  const client = new V2EngineClient(token, {
    fetch: rangedBinaryTransport(fetchViaCapacitorHttp({ request }), MiB),
  })
  return { client, ranges }
}
it('streams a suffix through bounded native bridge reads without read ahead', async () => {
  const size = 3 * MiB + 13,
    start = MiB + 3
  const { client, ranges } = fixture(size)
  const source = await client.openVersion('sample-file', 'sample-version', {
    size,
    sha: 'a'.repeat(64),
  })
  try {
    expect(ranges).toEqual([])
    let offset = start
    for (const length of [MiB, MiB, 10]) {
      const bytes = await source.read(offset, length)
      expect(bytes.length).toBe(length)
      expect(bytes.every((byte) => byte === 73)).toBe(true)
      expect(bytes.buffer.byteLength).toBeLessThanOrEqual(MiB)
      offset += length
      expect(ranges.length).toBe(Math.ceil((offset - start) / MiB))
      await Promise.resolve()
      expect(ranges.length).toBe(Math.ceil((offset - start) / MiB))
    }
    expect(offset).toBe(size)
    expect(ranges).toEqual([
      `bytes=${start}-${start + MiB - 1}`,
      `bytes=${start + MiB}-${start + 2 * MiB - 1}`,
      `bytes=${start + 2 * MiB}-${size - 1}`,
    ])
  } finally {
    await source.close()
  }
})
it('does not issue another bridge request after cancellation between chunks', async () => {
  const size = 3 * MiB,
    controller = new AbortController()
  const { client, ranges } = fixture(size)
  const source = await client.openVersion(
    'sample-file',
    'sample-version',
    { size, sha: 'a'.repeat(64) },
    controller.signal
  )
  try {
    await source.read(0, MiB)
    controller.abort()
    await expect(source.read(MiB, MiB)).rejects.toMatchObject({ name: 'AbortError' })
    expect(ranges).toEqual([`bytes=0-${MiB - 1}`])
  } finally {
    await source.close()
  }
})
it('rejects a changing content total inside a native suffix stream', async () => {
  const size = 3 * MiB
  const { client } = fixture(size, true)
  const source = await client.openVersion('sample-file', 'sample-version', {
    size,
    sha: 'a'.repeat(64),
  })
  try {
    await source.read(0, MiB)
    await expect(source.read(MiB, MiB)).rejects.toBeDefined()
  } finally {
    await source.close()
  }
})
