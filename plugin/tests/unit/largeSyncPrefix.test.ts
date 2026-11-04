import { afterEach, expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import * as paths from '@/sync/vaultPathLinks'
import { deferred } from '../helpers/deferred'

afterEach(() => vi.restoreAllMocks())

it.each(['open', 'read', 'close'] as const)(
  'cancels a prefix inspection waiting for native %s and closes its late handle',
  async (phase) => {
    const entered = deferred()
    const release = deferred()
    const pause = async (step: string) => {
      if (step === phase) {
        entered.resolve()
        await release.promise
      }
    }
    const handle = {
      read: vi.fn(async (bytes: Uint8Array) => {
        await pause('read')
        bytes[0] = 123
        return { bytesRead: 1 }
      }),
      close: vi.fn(async () => pause('close')),
      write: vi.fn(async () => ({ bytesWritten: 0 })),
      sync: vi.fn(async () => {}),
    }
    vi.spyOn(paths, 'nativeChunkPort').mockReturnValue({
      available: true,
      fullPath: (path) => '/sample-vault/' + path,
      open: async () => {
        await pause('open')
        return handle
      },
      utimes: undefined,
    })
    const fs = Object.create(ObsidianFileSystem.prototype) as ObsidianFileSystem
    Object.defineProperty(fs, 'disk', { value: {} })
    const controller = new AbortController()
    Reflect.get(fs, Symbol.for('abele.sync.index-wait-signal-v1')).call(fs, controller.signal)
    let settled = false
    const result = fs
      .readPrefix('.config/settings.json', 16)
      .then(
        () => 'accepted',
        (error: Error) => error.message
      )
      .finally(() => {
        settled = true
      })
    try {
      await entered.promise
      expect(Reflect.get(fs, Symbol.for('abele.sync.prefix-read-wait-v1')).call(fs)).toEqual({
        path: '.config/settings.json',
        step: 'native ' + phase,
        at: expect.any(Number),
      })
      controller.abort(new Error('sample disconnect'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(settled).toBe(true)
      expect(await result).toBe('sample disconnect')
    } finally {
      release.resolve()
      await result
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(handle.close).toHaveBeenCalledOnce()
    if (phase === 'open') expect(handle.read).not.toHaveBeenCalled()
    expect(Reflect.get(fs, Symbol.for('abele.sync.prefix-read-wait-v1')).call(fs)).toBeUndefined()
  }
)

it('inspects the prefix of a 200 MiB file without a whole-file adapter read', async () => {
  const readBinary = vi.fn(() => {
    throw new Error('whole-file read')
  })
  const close = vi.fn(async () => {})
  const read = vi.fn(async () => new Uint8Array([80, 75, 3, 4]))
  const fs = Object.assign(Object.create(ObsidianFileSystem.prototype), {
    rawStat: async () => ({ type: 'file', size: 200 * 1024 * 1024 }),
    io: {
      openRead: async () => ({
        size: 200 * 1024 * 1024,
        read,
        close,
        assertUnchanged: async () => {},
      }),
    },
  }) as ObsidianFileSystem
  Object.defineProperty(fs, 'disk', { value: { readBinary } })
  expect(await fs.readPrefix('sample.epub', 4)).toEqual(new Uint8Array([80, 75, 3, 4]))
  // The bounded reader now receives the run's cancellation signal, absent in this fixture.
  expect(read).toHaveBeenCalledWith(0, 4, undefined)
  expect(close).toHaveBeenCalledOnce()
  expect(readBinary).not.toHaveBeenCalled()
})
