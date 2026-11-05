// @vitest-environment node
import '../helpers/desktopRequire'
import * as fs from 'node:fs'
import { expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { desktopNodeFs, guardedVaultAdapter, mutationCheckedAdapter } from '@/sync/vaultPathLinks'
import { nativeLstatSnapshot } from '@/sync/nativeDiagnostics'
import { NATIVE_READ_DEADLINE_MS } from '@/sync/nativeReadDeadline'

it('uses original filesystem promises even when the patched host lstat never settles', async () => {
  const original = vi.fn(async () => ({ size: 3 }))
  const patched = vi.fn(() => new Promise(() => {}))
  const originalPort = { ...fs.promises, lstat: original }
  const patchedPort = { ...fs.promises, lstat: patched }
  Object.defineProperty(window, 'require', {
    configurable: true,
    value: (name: string) => ({
      ...fs,
      promises: name === 'original-fs' ? originalPort : patchedPort,
    }),
  })
  const answer = desktopNodeFs().promises.lstat('/sample-vault')
  expect(original).toHaveBeenCalledOnce()
  expect(patched).not.toHaveBeenCalled()
  expect(await answer).toMatchObject({ size: 3 })
  expect(nativeLstatSnapshot().recent).toContainEqual(
    expect.objectContaining({
      source: 'host-original-fs.promises',
      site: 'no-follow-open',
      outcome: 'fulfilled',
    })
  )
})

it('puts checked private opens on the original leaf while preserving authorization', async () => {
  const open = vi.fn(async () => ({ close: async () => {} }))
  const patchedOpen = vi.fn(() => new Promise(() => {}))
  const original = { ...fs.promises, open }
  const patched = { ...fs.promises, open: patchedOpen }
  Object.defineProperty(window, 'require', {
    configurable: true,
    value: (name: string) => ({ ...fs, promises: name === 'original-fs' ? original : patched }),
  })
  const check = vi.fn()
  const adapter = mutationCheckedAdapter(
    {
      fsPromises: patched,
      getFullPath: (path: string) => '/sample/' + path,
    } as unknown as DataAdapter,
    check,
    ['.private']
  )
  const result = Reflect.get(adapter, 'fsPromises').open('/sample/.private/stage', 'wx')
  expect(open).toHaveBeenCalledOnce()
  expect(patchedOpen).not.toHaveBeenCalled()
  await (await result).close()
  expect(check).toHaveBeenCalled()
  await expect(Reflect.get(adapter, 'fsPromises').open('/sample/public.md', 'w')).rejects.toThrow(
    'Raw public mutation refused'
  )
  expect(open).toHaveBeenCalledOnce()
})

it.each(['stat', 'exists'])(
  'bounds the requested leaf in guarded %s and releases the host queue',
  async (method) => {
    vi.useFakeTimers()
    const stat = {
      dev: 1,
      ino: 2,
      size: 3,
      mtimeMs: 1,
      birthtimeMs: 1,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    }
    let held = true
    const original = {
      ...fs.promises,
      realpath: async (path: string) => path,
      lstat: async (path: string) => {
        if (path.endsWith('/sample.md') && held) return new Promise(() => {})
        return stat
      },
    }
    Object.defineProperty(window, 'require', {
      configurable: true,
      value: () => ({ ...fs, promises: original }),
    })
    let queue = Promise.resolve<unknown>(undefined)
    const adapter = guardedVaultAdapter({
      fsPromises: original,
      getFullPath: (path: string) => '/sample-leaf' + (path ? '/' + path : ''),
      stat: async () => null,
      exists: async () => false,
      queue: (work: () => Promise<unknown>) => (queue = queue.then(work, work)),
    } as unknown as DataAdapter)
    try {
      const failed = expect(
        Reflect.get(adapter, method).call(adapter, 'sample.md')
      ).rejects.toMatchObject({ retryable: true })
      await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
      await failed
      held = false
      expect(await adapter.exists('sample.md')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  }
)

it('bounds guarded directory enumeration and closes its native handle before releasing the queue', async () => {
  vi.useFakeTimers()
  const stat = { dev: 1, ino: 2, isDirectory: () => true, isSymbolicLink: () => false }
  const close = vi.fn(async () => {})
  let held = true
  const original = {
    ...fs.promises,
    realpath: async (path: string) => path,
    lstat: async () => stat,
    open: async () => ({ stat: async () => stat, close }),
    readdir: async () => (held ? new Promise(() => {}) : []),
  }
  Object.defineProperty(window, 'require', {
    configurable: true,
    value: () => ({ ...fs, promises: original }),
  })
  const adapter = guardedVaultAdapter({
    fsPromises: original,
    getFullPath: (path: string) => '/sample-list' + (path ? '/' + path : ''),
    list: async () => ({ files: [], folders: [] }),
  } as unknown as DataAdapter)
  try {
    const failed = expect(adapter.list('Shared')).rejects.toMatchObject({ retryable: true })
    await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
    await failed
    expect(close).toHaveBeenCalledOnce()
    held = false
    expect(await adapter.list('Shared')).toEqual({ files: [], folders: [] })
  } finally {
    vi.useRealTimers()
  }
})

it.each(['no-follow', 'initial-root'])(
  'releases a guarded read-open after a lost %s metadata call and allows retry',
  async (phase) => {
    vi.useFakeTimers()
    const stat = { dev: 1, ino: 2, isDirectory: () => true, isSymbolicLink: () => false }
    const close = vi.fn(async () => {})
    const read = vi.fn(() => new Promise(() => {}))
    const handle = { stat: async () => stat, close, read }
    const open = vi.fn(async () => handle)
    let held = true
    const adapterPort = {
      realpath: async (path: string) => path,
      lstat: () =>
        held && phase === 'initial-root' ? new Promise(() => {}) : Promise.resolve(stat),
      open,
    }
    const nativePort = {
      ...adapterPort,
      lstat: () => (held && phase === 'no-follow' ? new Promise(() => {}) : Promise.resolve(stat)),
    }
    Object.defineProperty(window, 'require', {
      configurable: true,
      value: () => ({ ...fs, promises: nativePort }),
    })
    const adapter = guardedVaultAdapter({
      fsPromises: adapterPort,
      getFullPath: (path: string) => '/sample-vault' + (path ? '/' + path : ''),
    } as unknown as DataAdapter)
    const port = Reflect.get(adapter, 'fsPromises')
    try {
      const failed = expect(
        port.open('/sample-vault/.config/settings.json', 'r')
      ).rejects.toMatchObject({ code: 'offline', retryable: true })
      await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
      await failed
      expect(open).not.toHaveBeenCalled()
      held = false
      const reopened = await port.open('/sample-vault/.config/settings.json', 'r')
      const interrupted = expect(reopened.read()).rejects.toMatchObject({
        code: 'offline',
        retryable: true,
      })
      await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
      await interrupted
      await reopened.close()
      expect(open).toHaveBeenCalledOnce()
      expect(close).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  }
)
