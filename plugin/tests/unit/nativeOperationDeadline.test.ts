import { afterEach, expect, it, vi } from 'vitest'
import { boundedNativeOperations, NATIVE_READ_DEADLINE_MS } from '@/sync/nativeReadDeadline'
import { deferred } from '../helpers/deferred'

afterEach(() => vi.useRealTimers())

it('keeps a delayed create-open owned and releases its uncertainty fence only after settlement', async () => {
  vi.useFakeTimers()
  const opening = deferred<{ close(): Promise<void> }>()
  const close = vi.fn(async () => {})
  const port = boundedNativeOperations(
    { open: (_path: string, _flags: string) => opening.promise, lstat: async () => 3 },
    'sample-late-create-scope'
  )
  const openingResult = port.open('sample.tmp', 'wx')
  await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
  await expect(port.lstat()).rejects.toMatchObject({ retryable: true })
  opening.resolve({ close })
  await (await openingResult).close()
  expect(close).toHaveBeenCalledOnce()
  expect(await port.lstat()).toBe(3)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['lstat', 'readdir', 'open', 'read', 'write', 'close'])(
  'preserves native %s ownership until safe settlement',
  async (kind) => {
    vi.useFakeTimers()
    const pending = deferred<void>()
    const port = boundedNativeOperations(
      { [kind]: () => pending.promise },
      'sample-operation-' + kind
    )
    // Mutation deadlines must not release the caller or its host queue.
    const mutation = kind === 'write' || kind === 'open'
    const done = port[kind]()
    let settled = false
    void done.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    const failed = mutation ? undefined : expect(done).rejects.toMatchObject({ retryable: true })
    await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
    await failed
    expect(settled).toBe(!mutation)
    pending.resolve()
    if (mutation) await done
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

it('holds a write and refuses new work until its actual completion, retaining cleanup access', async () => {
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
  const done = handle.write()
  await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
  await expect(other.read()).rejects.toMatchObject({ retryable: true })
  expect(read).not.toHaveBeenCalled()
  writing.resolve()
  await done
  await handle.close()
  expect(await other.read()).toBe(3)
  expect(write).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it('keeps an uncertain mutation fenced across a plugin module reload', async () => {
  vi.useFakeTimers()
  const pending = deferred<void>()
  const old = boundedNativeOperations({ write: () => pending.promise }, 'sample-reload-scope')
  const done = old.write()
  await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
  vi.resetModules()
  const next = await import('@/sync/nativeReadDeadline')
  const read = vi.fn(async () => 3)
  const fresh = next.boundedNativeOperations({ read }, 'sample-reload-scope')
  await expect(fresh.read()).rejects.toBeInstanceOf(next.NativeReadTimeout)
  expect(read).not.toHaveBeenCalled()
  pending.resolve()
  await done
  expect(await fresh.read()).toBe(3)
})
