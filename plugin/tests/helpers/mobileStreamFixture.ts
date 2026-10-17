import { vi } from 'vitest'
import type { DataAdapter } from 'obsidian'

/** Synthetic mobile bridge: ignored HTTP ranges, unsupported chunk proxy, whole-file adapter reads. */
export function mobileStreamFixture(size = 200 * 1024 * 1024) {
  const probes = new Map<string, Uint8Array>(),
    folders = new Set<string>()
  const counts = { largeFetches: 0, bytesProduced: 0, cancelled: 0, arrayBuffers: 0, blobs: 0 }
  const readBinary = vi.fn(async () => {
    counts.bytesProduced += size
    return new Uint8Array(size).fill(73).buffer
  })
  const adapter = {
    getFullPath: (path: string) => 'sample-vault/' + path,
    getResourcePath: (path: string) => 'capacitor://localhost/_capacitor_file_/sample/' + path,
    stat: async (path: string) => ({
      type: 'file',
      size: probes.get(path)?.length ?? size,
      mtime: 1,
      ctime: 1,
    }),
    exists: async (path: string) => probes.has(path) || folders.has(path),
    mkdir: async (path: string) => {
      folders.add(path)
    },
    writeBinary: async (path: string, bytes: ArrayBuffer) => {
      probes.set(path, new Uint8Array(bytes))
    },
    appendBinary: async () => {},
    remove: async (path: string) => {
      probes.delete(path)
    },
    readBinary,
  } as unknown as DataAdapter
  const local = (path: string) =>
    path.startsWith('file:')
      ? new URL(path).pathname.split('/sample/')[1]
      : path.replace(/^sample-vault\//, '')
  const readFile = vi.fn(async ({ path }: { path: string }) => {
    const bytes = probes.get(local(path))
    if (!bytes) throw new Error('unbounded native read of large source')
    return { data: btoa(String.fromCharCode(...bytes)) }
  })
  const readFileInChunks = vi.fn(async () => {
    throw new Error('Filesystem.readFileInChunks() is not implemented on ios')
  })
  vi.stubGlobal('Capacitor', {
    Plugins: {
      Filesystem: {
        stat: async ({ path }: { path: string }) => ({
          size: probes.get(local(path))?.length ?? size,
        }),
        readFile,
        readFileInChunks,
      },
    },
  })
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname.split('/sample/')[1],
      probe = probes.get(decodeURIComponent(path))
    if (probe) return new Response(probe, { status: 200 })
    counts.largeFetches++
    let at = 0
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (at === size) {
              controller.close()
              return
            }
            const length = Math.min(65536, size - at)
            controller.enqueue(new Uint8Array(length).fill(73))
            at += length
            counts.bytesProduced += length
          },
          cancel() {
            counts.cancelled++
          },
        },
        { highWaterMark: 0 }
      )
    )
    response.arrayBuffer = async () => {
      counts.arrayBuffers++
      throw new Error('whole-file resource arrayBuffer')
    }
    response.blob = async () => {
      counts.blobs++
      throw new Error('whole-file resource blob')
    }
    return response
  })
  vi.stubGlobal('fetch', fetcher)
  return { adapter, probes, folders, counts, fetcher, readBinary, readFile, readFileInChunks, size }
}
