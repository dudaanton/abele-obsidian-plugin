// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import {
  phoneRouteProbe,
  phoneRouteDetail,
  type PhoneRouteResult,
} from '../e2e/helpers/phoneRouteProbe'

let socket: FakeSocket
class FakeSocket {
  onopen?: () => void
  onerror?: () => void
  onclose?: (event: { code: number; wasClean: boolean; reason: string }) => void
  onmessage?: (event: { data: string }) => void
  send = vi.fn()
  close = vi.fn()
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- expose the fake event source
    socket = this
  }
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('validates diagnostic fields instead of echoing arbitrary page data', () => {
  const result = {
    ok: false,
    stage: 'Bearer sample-private-key',
    cause: 'ws://user:secret@example.invalid',
    code: 'secret',
    clean: 'secret',
    reason: 'private',
  } as unknown as PhoneRouteResult
  expect(phoneRouteDetail(result, 12345, 'absent')).toBe(
    'port=12345 reverse=absent stage=upgrade cause=unknown'
  )
})

it('runs without module bindings when serialized into the page', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeSocket)
  const serialized = new Function(
    `return (${phoneRouteProbe.toString()})`
  )() as typeof phoneRouteProbe
  const result = serialized('ws://127.0.0.1:12345/v2/events', 'sample-private-key')
  socket.onopen!()
  socket.onmessage!({ data: '{"type":"changes"}' })
  expect(await result).toEqual({ ok: true })
})
function start() {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeSocket)
  return phoneRouteProbe('ws://127.0.0.1:12345/v2/events', 'sample-private-key')
}
it('returns close code and stage without the peer reason or credential', async () => {
  const result = start()
  socket.onopen!()
  socket.onclose!({ code: 1008, wasClean: true, reason: 'Bearer sample-private-key' })
  expect(await result).toEqual({
    ok: false,
    stage: 'authentication',
    cause: 'close',
    code: 1008,
    clean: true,
  })
  expect(socket.close).toHaveBeenCalledOnce()
})
it('waits for the close following an opaque browser error to retain its code', async () => {
  const result = start()
  socket.onerror!()
  socket.onclose!({ code: 1006, wasClean: false, reason: 'private' })
  expect(await result).toEqual({
    ok: false,
    stage: 'upgrade',
    cause: 'close',
    code: 1006,
    clean: false,
  })
})
it('times out and closes an upgrade that never answers', async () => {
  const result = start()
  await vi.advanceTimersByTimeAsync(5000)
  expect(await result).toEqual({ ok: false, stage: 'upgrade', cause: 'timeout' })
  expect(socket.close).toHaveBeenCalledOnce()
})
it('accepts only a changes reply and does not return malformed payloads', async () => {
  const result = start()
  socket.onopen!()
  socket.onmessage!({ data: 'sample-private-key' })
  expect(await result).toEqual({ ok: false, stage: 'authentication', cause: 'invalid-message' })
  const success = start()
  socket.onopen!()
  socket.onmessage!({ data: '{"type":"changes"}' })
  expect(await success).toEqual({ ok: true })
})
