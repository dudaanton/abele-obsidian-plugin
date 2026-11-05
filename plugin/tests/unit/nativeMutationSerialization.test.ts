// @vitest-environment node
import '../helpers/desktopRequire'
import { constants } from 'node:fs'
import * as fs from 'node:fs'
import type { DataAdapter } from 'obsidian'
import { afterEach, expect, it, vi } from 'vitest'
import { boundedNativeOperations, NATIVE_READ_DEADLINE_MS } from '@/sync/nativeReadDeadline'
import { deferred } from '../helpers/deferred'
import { guardedVaultAdapter } from '@/sync/vaultPathLinks'

afterEach(() => vi.useRealTimers())

it('keeps the real guarded adapter queue ahead of an ordinary editor save', async () => {
  vi.useFakeTimers()
  const pending = deferred<void>()
  const entered = deferred<void>()
  let contents = 'old'
  const stat = { dev: 1, ino: 2, isDirectory: () => true, isSymbolicLink: () => false }
  const close = vi.fn(async () => {})
  const native = {
    realpath: async (path: string) => path,
    lstat: async () => stat,
    open: async () => ({
      stat: async () => stat,
      truncate: async () => {
        entered.resolve()
        await pending.promise
        contents = ''
      },
      write: async (bytes: Uint8Array) => {
        contents = new TextDecoder().decode(bytes)
        return { bytesWritten: bytes.length }
      },
      close,
    }),
  }
  Object.defineProperty(window, 'require', {
    configurable: true,
    value: () => ({
      ...fs,
      promises: native,
      lstatSync: () => stat,
      realpathSync: (path: string) => path,
    }),
  })
  let queue = Promise.resolve<unknown>(undefined)
  const host = {
    fsPromises: native,
    getFullPath: (path: string) => '/sample-guard-queue' + (path ? '/' + path : ''),
    queue: (work: () => Promise<unknown>) => (queue = queue.then(work, work)),
    write: async () => {},
  }
  const adapter = guardedVaultAdapter(host as unknown as DataAdapter)
  const writing = adapter.write('sample.md', 'sync contents')
  void writing.catch(() => {})
  await vi.advanceTimersByTimeAsync(0)
  await entered.promise
  const save = vi.fn(async () => {
    contents = 'editor contents'
  })
  const saving = host.queue(save)
  await vi.advanceTimersByTimeAsync(3 * NATIVE_READ_DEADLINE_MS)
  expect(save).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  pending.resolve()
  await writing
  await saving
  expect(contents).toBe('editor contents')
  expect(close).toHaveBeenCalledOnce()
})

it('keeps the host queue held until a delayed truncate actually settles', async () => {
  vi.useFakeTimers()
  const pending = deferred<void>()
  let contents = 'old'
  const close = vi.fn(async () => {})
  const port = boundedNativeOperations(
    {
      truncate: async () => {
        await pending.promise
        contents = ''
      },
      close,
    },
    'sample-editor-queue'
  )
  let queue = Promise.resolve()
  const enqueue = (work: () => Promise<void>) => (queue = queue.then(work, work))
  const operation = enqueue(async () => {
    try {
      await port.truncate()
    } finally {
      await port.close()
    }
  })
  void operation.catch(() => {})
  const save = vi.fn(async () => {
    contents = 'new editor contents'
  })
  const editor = enqueue(save)
  await vi.advanceTimersByTimeAsync(3 * NATIVE_READ_DEADLINE_MS)
  expect(save).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  pending.resolve()
  await operation
  await editor
  expect(contents).toBe('new editor contents')
  expect(close).toHaveBeenCalledOnce()
})

it.each([constants.O_RDONLY, constants.O_RDONLY | constants.O_NOFOLLOW])(
  'abandons read-only numeric open %s without fencing healthy work',
  async (flags) => {
    vi.useFakeTimers()
    const port = boundedNativeOperations(
      {
        open: (_path: string, _flags: number) => new Promise(() => {}),
        lstat: async () => 3,
      },
      'sample-read-open-' + flags
    )
    const failed = expect(port.open('sample.md', flags)).rejects.toMatchObject({ retryable: true })
    await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
    await failed
    expect(await port.lstat()).toBe(3)
  }
)

it.each([
  constants.O_WRONLY,
  constants.O_RDWR,
  constants.O_RDONLY | constants.O_CREAT,
  constants.O_RDONLY | constants.O_TRUNC,
])('retains numeric mutation open %s until rejection', async (flags) => {
  vi.useFakeTimers()
  const pending = deferred<void>()
  const port = boundedNativeOperations(
    {
      open: (_path: string, _flags: number) => pending.promise,
      lstat: async () => 3,
    },
    'sample-mutating-open-' + flags
  )
  const error = new Error('sample native failure')
  const opening = port.open('sample.md', flags)
  let settled = false
  const failed = expect(opening).rejects.toBe(error)
  void opening.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    }
  )
  await vi.advanceTimersByTimeAsync(3 * NATIVE_READ_DEADLINE_MS)
  expect(settled).toBe(false)
  await expect(port.lstat()).rejects.toMatchObject({ cause: { uncertain: true } })
  pending.reject(error)
  await failed
  expect(await port.lstat()).toBe(3)
  expect(vi.getTimerCount()).toBe(0)
})
