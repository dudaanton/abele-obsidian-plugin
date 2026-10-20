import { afterEach, expect, it, vi } from 'vitest'
import { request, setRequestTransport } from '@/helpers/http'

afterEach(() => {
  setRequestTransport(undefined)
  vi.useRealTimers()
})

it('allows an unlimited request beyond the normal network deadline', async () => {
  vi.useFakeTimers()
  let finish!: (value: any) => void
  setRequestTransport(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const pending = request({ url: 'https://images.example/generate', timeoutMs: 0 })
  const outcome = pending.then(
    () => 'done',
    () => 'failed'
  )
  await vi.advanceTimersByTimeAsync(301_000)
  finish({ status: 200, headers: {}, text: '', arrayBuffer: new ArrayBuffer(0) })
  expect(await outcome).toBe('done')
})

it('Stop settles even when the native transport cannot cancel', async () => {
  setRequestTransport(() => new Promise(() => {}))
  const controller = new AbortController()
  const pending = request({
    url: 'https://images.example/edit',
    timeoutMs: 0,
    signal: controller.signal,
  })
  controller.abort()
  await expect(pending).rejects.toThrow(/abort/i)
})
