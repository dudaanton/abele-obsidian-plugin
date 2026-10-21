import { expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { desktopFsPort } from '../helpers/desktopRequire'

const MiB = 1024 * 1024

function nativeIo() {
  // Model the browser's scheduler explicitly: Node orders timer and MessagePort queues
  // differently, which cannot prove whether a browser task boundary was crossed.
  const yieldTask = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  vi.stubGlobal('scheduler', { yield: yieldTask })
  const size = 2 * MiB
  const adapter = {
    stat: async () => ({ type: 'file', size, mtime: 10, ctime: 1 }),
    getFullPath: (path: string) => '/sample/' + path,
    fsPromises: {
      lstat: async () => ({ dev: 1, ino: 1, isSymbolicLink: () => false }),
      open: async () => ({
        stat: async () => ({ dev: 1, ino: 1 }),
        read: async (buffer: Uint8Array, _at: number, length: number, position: number) => {
          const bytesRead = Math.min(length, size - position)
          buffer.fill(0)
          return { bytesRead }
        },
        close: vi.fn(async () => {}),
      }),
    },
  } as unknown as DataAdapter
  desktopFsPort(Reflect.get(adapter, 'fsPromises'))
  return { io: new BoundedVaultIo(adapter), yieldTask }
}

it('lets a browser task run while fingerprinting more than one chunk', async () => {
  const { io, yieldTask } = nativeIo()
  let heartbeat = false
  const timer = setTimeout(() => {
    heartbeat = true
  }, 0)
  try {
    expect(await io.fingerprint('sample.bin')).toMatchObject({ size: 2 * MiB })
    expect(heartbeat).toBe(true)
    expect(yieldTask).toHaveBeenCalledTimes(2)
  } finally {
    clearTimeout(timer)
  }
})

it('lets a browser task run between buffered upload source chunks', async () => {
  const { io, yieldTask } = nativeIo()
  const source = await io.openUploadRead('sample.bin')
  let heartbeat = false
  const timer = setTimeout(() => {
    heartbeat = true
  }, 0)
  try {
    await source.read(0, MiB)
    await source.read(MiB, MiB)
    expect(heartbeat).toBe(true)
    expect(yieldTask).toHaveBeenCalledTimes(2)
  } finally {
    clearTimeout(timer)
    await source.close()
  }
})
