import { Buffer } from 'node:buffer'
import { afterEach, expect, it, vi } from 'vitest'
import {
  exactNativeRequestBodies,
  fetchViaCapacitorHttp,
  type NativeHttpOptions,
} from '@/sync/mobileTransport'
import { deferred } from '../helpers/deferred'

afterEach(() => vi.restoreAllMocks())
it('keeps a submitted body through JavaScript cancellation until native acknowledgement', async () => {
  const entered = deferred(),
    acknowledged = deferred(),
    finished = deferred()
  let held: NativeHttpOptions | undefined
  const send = fetchViaCapacitorHttp({
    request: async (options) => {
      held = options
      entered.resolve()
      await acknowledged.promise
      finished.resolve()
      return { status: 204, headers: {}, data: null, url: options.url }
    },
  })
  const controller = new AbortController()
  const pending = send('https://sync.example/v2/uploads/sample', {
    method: 'PUT',
    body: new Uint8Array(1024),
    signal: controller.signal,
  })
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await entered.promise
  controller.abort()
  await rejected
  expect(typeof held?.data).toBe('string')
  acknowledged.resolve()
  await finished.promise
  // Let the acknowledged native promise run its cleanup continuation.
  await Promise.resolve()
  await Promise.resolve()
  expect(held?.data).toBeUndefined()
})
it('releases encoded upload bodies from completed native request envelopes', async () => {
  const retained: NativeHttpOptions[] = []
  const send = fetchViaCapacitorHttp(
    exactNativeRequestBodies({
      request: async (options) => {
        expect(typeof options.data).toBe('string')
        retained.push(options)
        return { status: 204, headers: {}, data: null, url: options.url }
      },
    })
  )
  const body = new Uint8Array(1024 * 1024)
  for (let part = 0; part < 8; part++) {
    await send('https://sync.example/v2/uploads/sample', { method: 'PUT', body })
    expect(
      retained.reduce(
        (bytes, item) => bytes + (typeof item.data === 'string' ? item.data.length : 0),
        0
      )
    ).toBe(0)
  }
  await send('https://sync.example/v2/commit', {
    method: 'POST',
    body: '{"sample":true}',
    headers: { 'Content-Type': 'application/json' },
  })
  expect(retained.every((item) => item.data === undefined)).toBe(true)
})

it('encodes binary requests without constructing a chunk-sized intermediate binary string', async () => {
  const encode = vi.spyOn(globalThis, 'btoa')
  const data = new Uint8Array(1024 * 1024 + 2).map((_, at) => at % 251)
  let received = ''
  const send = fetchViaCapacitorHttp({
    request: async (options) => {
      received = String(options.data)
      return { status: 204, headers: {}, data: null, url: options.url }
    },
  })
  await send('https://sync.example/v2/uploads/sample', { method: 'PUT', body: data })
  expect(Math.max(...encode.mock.calls.map(([text]) => text.length))).toBeLessThanOrEqual(32766)
  const decoded = atob(received)
  expect(decoded.length).toBe(data.length)
  expect(received).toBe(Buffer.from(data).toString('base64'))
})
