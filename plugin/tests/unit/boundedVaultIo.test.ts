import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'

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
        exists: async (path: string) => probes.has(path),
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
        open: async () => ({
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
  it('refuses large portable reads before invoking the whole-file adapter', async () => {
    const readBinary = vi.fn()
    const adapter = {
      stat: async () => ({ type: 'file', size: 51 * MiB, mtime: 1, ctime: 1 }),
      readBinary,
    } as unknown as DataAdapter
    await expect(new BoundedVaultIo(adapter).openRead('sample.bin')).rejects.toThrow('50 MiB')
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
