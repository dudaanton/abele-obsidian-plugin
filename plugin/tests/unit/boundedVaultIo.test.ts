import { mobileReadSnapshot } from '@/sync/mobileReadDiagnostics'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopFsPort } from '../helpers/desktopRequire'
import type { DataAdapter } from 'obsidian'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { mobileStreamFixture } from '../helpers/mobileStreamFixture'

const MiB = 1024 * 1024
afterEach(() => vi.unstubAllGlobals())
describe('bounded vault I/O', () => {
  it.each([
    [true, false],
    [false, false],
    [true, true],
  ])(
    'probes mobile path mapping and offset support before reading a virtual large file (ranges=%s, resource=%s)',
    async (ranges, resource) => {
      const size = 3 * 1024 * MiB + 13
      const probes = new Map<string, Uint8Array>()
      const folders = new Set<string>()
      const readBinary = vi.fn(() => {
        throw new Error('whole file')
      })
      const calls: { offset: number; length: number; chunkSize: number; path: string }[] = []
      const adapter = {
        ...(resource
          ? {
              getResourcePath: (path: string) =>
                'capacitor://localhost/_capacitor_file_/sample/' + path + '?v=1',
            }
          : { getFullPath: (path: string) => 'file:///sample/' + path }),
        exists: async (path: string) => probes.has(path) || folders.has(path),
        mkdir: async (path: string) => {
          folders.add(path)
        },
        stat: async (path: string) => ({
          type: 'file',
          size: probes.get(path)?.length ?? size,
          mtime: 1,
          ctime: 1,
        }),
        writeBinary: async (path: string, bytes: ArrayBuffer) => {
          probes.set(path, new Uint8Array(bytes))
        },
        remove: async (path: string) => {
          probes.delete(path)
        },
        readBinary,
      } as unknown as DataAdapter
      const readFileInChunks = vi.fn(async (options, callback) => {
        calls.push(options)
        expect(options.path).toMatch(/^file:\/\/\/sample\//)
        expect(options.chunkSize).toBeLessThanOrEqual(MiB)
        const probe = probes.get(options.path.slice('file:///sample/'.length))
        if (!probe) throw new Error('unexpected read before range capability was verified')
        const bytes = probe
          ? ranges
            ? probe.slice(options.offset, options.offset + options.length)
            : probe
          : new Uint8Array()
        callback({ data: btoa(String.fromCharCode(...bytes.slice(0, Math.min(bytes.length, 4)))) })
        callback({ data: '' })
        return 'sample-callback'
      })
      vi.stubGlobal('Capacitor', {
        Plugins: {
          Filesystem: {
            stat: async ({ path }: { path: string }) => ({
              size: probes.get(path.slice('file:///sample/'.length))?.length ?? size,
            }),
            readFileInChunks,
            readFile: async (options: { path: string; offset: number; length: number }) => {
              calls.push({ ...options, chunkSize: options.length })
              const probe = probes.get(options.path.slice('file:///sample/'.length))
              const part = probe
                ? ranges
                  ? probe.slice(options.offset, options.offset + options.length)
                  : probe
                : null
              return {
                data: part ? btoa(String.fromCharCode(...part)) : btoa('I'.repeat(options.length)),
              }
            },
          },
        },
      })
      const io = new BoundedVaultIo(adapter)
      if (!ranges) {
        await expect(io.openRead('sample.bin')).rejects.toThrow('50 MiB')
      } else {
        const source = await io.openRead('sample.bin')
        readFileInChunks.mockImplementation(async (options, callback) => {
          calls.push(options)
          expect(options.chunkSize).toBeLessThanOrEqual(MiB)
          callback({ data: btoa('I'.repeat(options.length)) })
          callback({ data: '' })
          return 'sample-callback'
        })
        for (const offset of [0, 2 * 1024 * MiB, size - 13]) {
          const bytes = await source.read(offset, Math.min(MiB, size - offset))
          expect(bytes.buffer.byteLength).toBeLessThanOrEqual(MiB)
          expect(bytes[0]).toBe(73)
        }
        await source.close()
        expect(calls.filter((call) => call.offset !== undefined)).toHaveLength(4)
      }
      expect(probes.size).toBe(0)
      expect(readBinary).not.toHaveBeenCalled()
    }
  )
  it('reads a virtual multi-GiB native file without a whole-file allocation', async () => {
    const size = 3 * 1024 * MiB + 13
    let largest = 0
    const close = vi.fn(async () => {})
    const adapter = {
      stat: async () => ({ type: 'file', size, mtime: 10, ctime: 1 }),
      getFullPath: (path: string) => '/sample/' + path,
      fsPromises: {
        lstat: async () => ({ dev: 1, ino: 1, isSymbolicLink: () => false }),
        open: async () => ({
          stat: async () => ({ dev: 1, ino: 1 }),
          read: async (buffer: Uint8Array, _at: number, length: number, position: number) => {
            largest = Math.max(largest, buffer.buffer.byteLength)
            expect(buffer.buffer.byteLength).toBeLessThanOrEqual(MiB)
            buffer.fill(position % 251)
            return { bytesRead: length }
          },
          close,
        }),
      },
      readBinary: () => {
        throw new Error('whole file read')
      },
    } as unknown as DataAdapter
    desktopFsPort(Reflect.get(adapter, 'fsPromises'))
    const source = await new BoundedVaultIo(adapter).openRead('sample.bin')
    for (let offset = 0; offset < size; offset += MiB) {
      const bytes = await source.read(offset, Math.min(MiB, size - offset))
      expect(bytes[0]).toBe(offset % 251)
    }
    await source.assertUnchanged()
    await source.close()
    await source.close()
    expect(close).toHaveBeenCalledTimes(1)
    expect(largest).toBe(MiB)
  })
  it('refuses non-upload portable reads above 50 MiB before invoking the adapter', async () => {
    const readBinary = vi.fn()
    const adapter = {
      stat: async () => ({ type: 'file', size: 51 * MiB, mtime: 1, ctime: 1 }),
      readBinary,
    } as unknown as DataAdapter
    await expect(new BoundedVaultIo(adapter).openRead('sample.bin')).rejects.toThrow('50 MiB')
    expect(readBinary).not.toHaveBeenCalled()
  })
  it('accepts an existing file exactly at the portable read limit', async () => {
    const readBinary = vi.fn(async () => new ArrayBuffer(50 * MiB))
    const adapter = {
      stat: async () => ({ type: 'file', size: 50 * MiB, mtime: 1, ctime: 1 }),
      readBinary,
    } as unknown as DataAdapter
    const source = await new BoundedVaultIo(adapter).openRead('sample.bin')
    expect(await source.read(50 * MiB - 1, 1)).toEqual(new Uint8Array([0]))
    await source.close()
    expect(readBinary).toHaveBeenCalledTimes(1)
  })
  it('retains oversized partial bytes but refuses recovery after an uncertain append or lost receipt', async () => {
    const abort = new AbortController()
    let cancelWithAcknowledgement = false
    let size = 0,
      mtime = 0,
      uncertain = false
    const readBinary = vi.fn(async () => {
      throw new Error('whole file')
    })
    const adapter = {
      stat: async () => ({ type: 'file', size, mtime, ctime: 1 }),
      writeBinary: async () => {
        size = 0
        mtime++
      },
      appendBinary: async (_path: string, bytes: ArrayBuffer) => {
        size += bytes.byteLength
        mtime++
        if (uncertain) throw new Error('acknowledgement lost')
        if (cancelWithAcknowledgement) abort.abort(new Error('cancelled'))
      },
      readBinary,
    } as unknown as DataAdapter
    const io = new BoundedVaultIo(adapter),
      chunk = new Uint8Array(MiB)
    await io.create('sample.tmp', 1)
    for (let at = 0; at < 50 * MiB; at += MiB) await io.append('sample.tmp', at, chunk, 1)
    cancelWithAcknowledgement = true
    await expect(io.append('sample.tmp', size, chunk, 1, abort.signal)).rejects.toThrow('cancelled')
    cancelWithAcknowledgement = false
    expect(await io.fingerprint('sample.tmp')).toMatchObject({ size: 51 * MiB })
    // A process restart has no acknowledgement history, even when the path and stamp survive.
    const restarted = new BoundedVaultIo(adapter, undefined, undefined, {})
    await expect(restarted.fingerprint('sample.tmp', undefined, true)).rejects.toThrow(
      'bounded local verification'
    )
    uncertain = true
    await expect(io.append('sample.tmp', size, chunk, 1)).rejects.toThrow('acknowledgement lost')
    uncertain = false
    await expect(io.append('sample.tmp', size, chunk, 1)).rejects.toThrow('50 MiB')
    await expect(io.fingerprint('sample.tmp', undefined, true)).rejects.toThrow(
      'bounded local verification'
    )
    expect(size).toBe(52 * MiB)
    expect(readBinary).not.toHaveBeenCalled()
  })
  it('checks cancellation and rejects changes to an opened source', async () => {
    let mtime = 1
    const readBinary = vi.fn(async () => new Uint8Array(4).buffer)
    const adapter = {
      stat: async () => ({ type: 'file', size: 4, mtime, ctime: 1 }),
      readBinary,
    } as unknown as DataAdapter
    const source = await new BoundedVaultIo(adapter).openRead('sample.bin')
    const abort = new AbortController()
    abort.abort(new Error('cancelled'))
    await expect(source.read(0, 4, abort.signal)).rejects.toThrow('cancelled')
    mtime++
    await expect(source.assertUnchanged()).rejects.toThrow('changed')
    await source.close()
  })
})

it.each(['create', 'append'])(
  'refuses linked staging ancestors before native %s',
  async (action) => {
    const open = vi.fn(async () => ({
      sync: async () => {},
      close: async () => {},
      write: async () => ({ bytesWritten: 1 }),
    }))
    const adapter = {
      getFullPath: (p: string) => '/vault/' + p,
      stat: async () => ({ type: 'file', size: 0, mtime: 1, ctime: 1 }),
      fsPromises: {
        open,
        lstat: async (p: string) => ({
          isSymbolicLink: () => p === '/vault/.obsidian/sync-staging',
          isDirectory: () => p !== '/vault/.obsidian/sync-staging',
        }),
      },
    } as unknown as DataAdapter
    const io = new BoundedVaultIo(adapter)
    const path = '.obsidian/sync-staging/sample.tmp'
    await expect(
      action === 'create' ? io.create(path, 1) : io.append(path, 0, new Uint8Array([1]), 1)
    ).rejects.toThrow(/symbolic link/i)
    expect(open).not.toHaveBeenCalled()
  }
)

it('reads a small mobile file without per-file resource fetch overhead', async () => {
  const bytes = new Uint8Array(8200).fill(7)
  const readBinary = vi.fn(async () => bytes.buffer)
  const fetcher = vi.fn(() => {
    throw new Error('unexpected local fetch')
  })
  vi.stubGlobal('fetch', fetcher)
  const adapter = {
    getResourcePath: () => 'capacitor://localhost/_capacitor_file_/sample/sample.md',
    exists: async () => false,
    mkdir: async () => {},
    writeBinary: async () => {},
    remove: async () => {},
    stat: async () => ({ type: 'file', size: bytes.length, mtime: 1, ctime: 1 }),
    readBinary,
  } as unknown as DataAdapter
  const source = await new BoundedVaultIo(adapter).openRead('sample.md')
  try {
    expect(await source.read(0, bytes.length)).toEqual(bytes)
  } finally {
    await source.close()
  }
  expect(readBinary).toHaveBeenCalledOnce()
  expect(fetcher).not.toHaveBeenCalled()
})

it('keeps small reads on the adapter after a whole-file upload read', async () => {
  const f = mobileStreamFixture()
  const originalStat = f.adapter.stat.bind(f.adapter)
  f.adapter.stat = async (path) =>
    path === 'small.md' ? { type: 'file', size: 8, mtime: 1, ctime: 1 } : originalStat(path)
  const smallRead = vi.fn(
    async (path: string) => new Uint8Array(path === 'small.md' ? 8 : f.size).buffer
  )
  f.adapter.readBinary = smallRead
  const io = new BoundedVaultIo(f.adapter)
  const large = await io.openUploadRead('sample.bin')
  await large.read(0, MiB)
  await large.close()
  const before = f.fetcher.mock.calls.length
  const small = await io.openRead('small.md')
  try {
    expect(await small.read(0, 8)).toEqual(new Uint8Array(8))
  } finally {
    await small.close()
  }
  expect(f.fetcher.mock.calls.length).toBe(before)
  expect(smallRead).toHaveBeenCalledTimes(2)
})

it('keeps a 2 MiB mobile file on the original adapter path without large-upload diagnostics or resource probes', async () => {
  const fixture = mobileStreamFixture(2 * MiB)
  const before = mobileReadSnapshot()
  const io = new BoundedVaultIo(fixture.adapter)
  const source = await io.openRead('sample.bin')
  try {
    expect((await source.read(0, MiB)).length).toBe(MiB)
  } finally {
    await source.close()
  }
  expect(fixture.readBinary).toHaveBeenCalledOnce()
  expect(fixture.fetcher).not.toHaveBeenCalled()
  expect(fixture.readFileInChunks).not.toHaveBeenCalled()
  expect(fixture.readFile).not.toHaveBeenCalled()
  expect(mobileReadSnapshot().wholeReads).toBe(before.wholeReads)
})
