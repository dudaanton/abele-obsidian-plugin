import { afterEach, expect, it, vi } from 'vitest'
import { boundedNativeOperations, NATIVE_READ_DEADLINE_MS } from '@/sync/nativeReadDeadline'
import { deferred } from '../helpers/deferred'

afterEach(() => vi.useRealTimers())

it('closes a late create-open handle and releases its uncertainty fence only after settlement', async () => {
  vi.useFakeTimers()
  const opening = deferred<{ close(): Promise<void> }>()
  const close = vi.fn(async () => {})
  const port = boundedNativeOperations(
    { open: (_path: string, _flags: string) => opening.promise, lstat: async () => 3 },
    'sample-late-create-scope'
  )
  const failed = expect(port.open('sample.tmp', 'wx')).rejects.toMatchObject({
    cause: { uncertain: true },
  })
  await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
  await failed
  await expect(port.lstat()).rejects.toMatchObject({ retryable: true })
  opening.resolve({ close })
  await Promise.resolve()
  await Promise.resolve()
  expect(close).toHaveBeenCalledOnce()
  expect(await port.lstat()).toBe(3)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['lstat', 'readdir', 'open', 'read', 'write', 'close'])(
  'bounds native %s without dropping late settlement',
  async (kind) => {
    vi.useFakeTimers()
    const pending = deferred<void>()
    const port = boundedNativeOperations(
      { [kind]: () => pending.promise },
      'sample-operation-' + kind
    )
    const failed = expect(port[kind]()).rejects.toMatchObject({ retryable: true })
    await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
    await failed
    pending.resolve()
    await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  }
)

it('bounds directory enumeration and closes its directory handle', async () => {
  vi.useFakeTimers()
  const close = vi.fn(async () => {})
  const port = boundedNativeOperations(
    { open: async () => ({ close }), readdir: () => new Promise(() => {}) },
    'sample-read-scope'
  )
  const handle = await port.open()
  const done = (async () => {
    try {
      await port.readdir()
    } finally {
      await handle.close()
    }
  })()
  const failed = expect(done).rejects.toMatchObject({ retryable: true })
  await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
  await failed
  expect(close).toHaveBeenCalledOnce()
})

it('bounds a write and refuses new work until its actual completion, retaining cleanup access', async () => {
  vi.useFakeTimers()
  const writing = deferred<void>()
  const write = vi.fn(() => writing.promise)
  const read = vi.fn(async () => 3)
  const close = vi.fn(async () => {})
  const port = boundedNativeOperations(
    { open: async () => ({ write, read, close }) },
    'sample-write-scope'
  )
  const other = boundedNativeOperations({ read }, 'sample-write-scope')
  const handle = await port.open()
  const failed = expect(handle.write()).rejects.toMatchObject({
    retryable: true,
    cause: { uncertain: true },
  })
  await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
  await failed
  await expect(other.read()).rejects.toMatchObject({ retryable: true })
  expect(read).not.toHaveBeenCalled()
  await handle.close()
  writing.resolve()
  await Promise.resolve()
  expect(await other.read()).toBe(3)
  expect(write).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it('keeps an uncertain mutation fenced across a plugin module reload', async () => {
  vi.useFakeTimers()
  const pending = deferred<void>()
  const old = boundedNativeOperations({ write: () => pending.promise }, 'sample-reload-scope')
  const failed = expect(old.write()).rejects.toMatchObject({ retryable: true })
  await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
  await failed
  vi.resetModules()
  const next = await import('@/sync/nativeReadDeadline')
  const read = vi.fn(async () => 3)
  const fresh = next.boundedNativeOperations({ read }, 'sample-reload-scope')
  await expect(fresh.read()).rejects.toBeInstanceOf(next.NativeReadTimeout)
  expect(read).not.toHaveBeenCalled()
  pending.resolve()
  await Promise.resolve()
  expect(await fresh.read()).toBe(3)
})
