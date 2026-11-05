// @vitest-environment node
import '../helpers/desktopRequire'
import * as fs from 'node:fs'
import { expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { desktopNodeFs, guardedVaultAdapter } from '@/sync/vaultPathLinks'
import { NATIVE_READ_DEADLINE_MS } from '@/sync/nativeReadDeadline'

it('uses original filesystem promises even when the patched host lstat never settles', async () => {
  const original = vi.fn(async () => ({ size: 3 }))
  const patched = vi.fn(() => new Promise(() => {}))
  Object.defineProperty(window, 'require', {
    configurable: true,
    value: (name: string) => ({
      ...fs,
      promises: { ...fs.promises, lstat: name === 'original-fs' ? original : patched },
    }),
  })
  const answer = desktopNodeFs().promises.lstat('/sample-vault')
  expect(original).toHaveBeenCalledOnce()
  expect(patched).not.toHaveBeenCalled()
  expect(await answer).toMatchObject({ size: 3 })
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
