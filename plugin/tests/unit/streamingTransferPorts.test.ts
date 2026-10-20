import { expect, it, vi } from 'vitest'
import {
  V2EngineClient,
  TransferBudget,
  downloadToStage,
  fingerprintSource,
} from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { fetchViaCapacitorHttp, exactNativeRequestBodies } from '@/sync/mobileTransport'

const MiB = 1024 * 1024
const token = encodeAccessToken({
  v: 1,
  address: 'https://sync.example.invalid',
  key: 'a'.repeat(43),
  scope: { kind: 'folder', id: 'sample-root', path: '/' },
})

it('downloads a virtual multi-GiB version through bounded transport and staging ports with no read ahead', async () => {
  const size = 3 * 1024 * MiB + 13,
    identity = { size, sha: 'a'.repeat(64) }
  let offset = 0,
    pendingAppend = false,
    liveBytes = 0,
    peakBytes = 0,
    requests = 0
  const acquire = (size: number) => {
    liveBytes += size
    peakBytes = Math.max(peakBytes, liveBytes)
  }
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    expect(pendingAppend).toBe(false)
    const match = /^bytes=(\d+)-(\d+)$/.exec(new Headers(init?.headers).get('range')!)!
    const start = Number(match[1]),
      end = Number(match[2]),
      length = end - start + 1
    expect(length).toBeLessThanOrEqual(MiB)
    expect(start).toBe(offset)
    requests++
    acquire(length)
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(new Uint8Array(length))
        } else {
          liveBytes -= length
          controller.close()
        }
      },
    })
    return new Response(body, {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${size}` },
    })
  })
  const client = new V2EngineClient(token, { fetch })
  const remote = await client.openVersion('sample-file', 'sample-version', identity)
  const source = {
    ...remote,
    read: async (at: number, length: number, signal?: AbortSignal) => {
      const bytes = await remote.read(at, length, signal)
      acquire(bytes.length)
      return bytes
    },
  }
  let sealed = false,
    committed = false
  const stage = {
    id: 'sample-stage',
    get offset() {
      return offset
    },
    append: async (at: number, bytes: Uint8Array) => {
      expect(bytes.buffer.byteLength).toBeLessThanOrEqual(MiB)
      expect(at).toBe(offset)
      pendingAppend = true
      await Promise.resolve()
      offset += bytes.length
      liveBytes -= bytes.length
      pendingAppend = false
    },
    seal: async (expected: typeof identity) => {
      expect(expected).toEqual(identity)
      expect(offset).toBe(size)
      sealed = true
    },
    commit: async () => {
      expect(sealed).toBe(true)
      committed = true
    },
    discard: async () => {},
  }
  await downloadToStage(source, stage, identity, new TransferBudget())
  expect(committed).toBe(true)
  expect(requests).toBe(Math.ceil(size / MiB))
  expect(liveBytes).toBe(0)
  expect(peakBytes).toBeLessThanOrEqual(2 * MiB)
}, 60000)

it('negotiates at most one MiB upload parts and encodes only each part through the native bridge', async () => {
  const size = 3 * MiB + 7
  const source = () => ({
    size,
    read: async (_at: number, length: number) => new Uint8Array(length),
    assertUnchanged: async () => {},
    close: async () => {},
  })
  const identity = await fingerprintSource(source())
  const parts: number[] = []
  const request = vi.fn(async (options) => {
    let status = 204,
      data = ''
    if (options.url.endsWith('/begin')) {
      const input = JSON.parse(atob(options.data))
      expect(input).toEqual({ size, max_part_bytes: MiB })
      status = 200
      data = btoa(
        JSON.stringify({
          upload_id: '00000000-0000-4000-8000-000000000001',
          part_size: MiB,
          parts: 4,
        })
      )
    } else if (options.method === 'PUT') {
      expect(options.dataType).toBe('file')
      expect(options.data.length).toBeLessThanOrEqual(4 * Math.ceil(MiB / 3))
      parts.push(atob(options.data).length)
    }
    return { status, url: options.url, headers: {}, data }
  })
  const client = new V2EngineClient(token, {
    fetch: fetchViaCapacitorHttp(exactNativeRequestBodies({ request })),
  })
  await client.putBlobSource(identity, source())
  expect(parts).toEqual([MiB, MiB, MiB, 7])
})
