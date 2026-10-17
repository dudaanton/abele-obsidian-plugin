import { expect, it, vi } from 'vitest'
import {
  gateMobileSource,
  mobileLargeFileGate,
  MobileLargeFileGate,
} from '@/sync/mobileLargeFileGate'

it('serializes whole uploads and hydration, releasing only after the owner has dropped its buffer', async () => {
  const gate = new MobileLargeFileGate()
  const releaseUpload = await gate.acquire()
  const hydrate = vi.fn(),
    secondUpload = vi.fn()
  const hydration = gate.acquire().then((release) => {
    hydrate()
    return release
  })
  const upload = gate.acquire().then((release) => {
    secondUpload()
    return release
  })
  await Promise.resolve()
  expect(hydrate).not.toHaveBeenCalled()
  releaseUpload()
  const releaseHydration = await hydration
  expect(hydrate).toHaveBeenCalledOnce()
  expect(secondUpload).not.toHaveBeenCalled()
  releaseUpload()
  expect(secondUpload).not.toHaveBeenCalled()
  releaseHydration()
  const releaseSecond = await upload
  expect(secondUpload).toHaveBeenCalledOnce()
  releaseSecond()
})
it('removes an aborted waiter without releasing the current owner or blocking the next transfer', async () => {
  const gate = new MobileLargeFileGate()
  const release = await gate.acquire(),
    abort = new AbortController()
  const cancelled = gate.acquire(abort.signal)
  abort.abort(new Error('sample cancellation'))
  await expect(cancelled).rejects.toThrow('sample cancellation')
  let started = false
  const next = gate.acquire().then((done) => {
    started = true
    return done
  })
  await Promise.resolve()
  expect(started).toBe(false)
  release()
  ;(await next)()
})

it('closing a queued hydration cancels its acquisition and leaves the upload owner intact', async () => {
  const release = await mobileLargeFileGate.acquire()
  const read = vi.fn(async () => new Uint8Array(1)),
    close = vi.fn(async () => {})
  const source = gateMobileSource({
    size: 200 * 1024 * 1024,
    read,
    close,
    assertUnchanged: async () => {},
  })
  const reading = source.read(0, 1)
  const rejected = expect(reading).rejects.toThrow('Large source closed')
  await source.close()
  await rejected
  expect(read).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledOnce()
  let started = false
  const next = mobileLargeFileGate.acquire().then((done) => {
    started = true
    return done
  })
  await Promise.resolve()
  expect(started).toBe(false)
  release()
  ;(await next)()
})
