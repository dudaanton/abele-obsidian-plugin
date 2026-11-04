import { vi } from 'vitest'
import { mobileStreamFixture } from './mobileStreamFixture'

/** Native model: ordinary file resources allocate whole bodies; only media aliases
 * honor Range. Copies are performed by the native cache API, never by JS buffers. */
export function mobileRangeCacheFixture(size = 200 * 1024 * 1024) {
  const base = mobileStreamFixture(size)
  const cache = new Map<string, { size: number; bytes?: Uint8Array }>()
  const directories = new Set<string>()
  const seen = new Set<string>()
  const native = { copies: 0, ranges: 0, maxBuffer: 0, unbounded: 0 }
  const files = Reflect.get(window, 'Capacitor').Plugins.Filesystem
  Object.assign(files, {
    mkdir: async ({ path }: { path: string }) => {
      directories.add(path)
    },
    readdir: async ({ path }: { path: string }) => ({
      files: [...cache.keys()]
        .filter((key) => key.startsWith(path + '/'))
        .map((key) => ({ name: key.slice(path.length + 1) })),
    }),
    copy: async ({ from, to, toDirectory }: { from: string; to: string; toDirectory: string }) => {
      if (toDirectory !== 'CACHE') throw new Error('wrong copy directory')
      const path = decodeURIComponent(new URL(from).pathname.split('/sample/')[1])
      const bytes = base.probes.get(path)
      cache.set(to, { size: bytes?.length ?? size, bytes: bytes?.slice() })
      if (!bytes) native.copies++
    },
    getUri: async ({ path, directory }: { path: string; directory: string }) => {
      if (directory !== 'CACHE') throw new Error('wrong URI directory')
      return { uri: 'file:///cache/' + path }
    },
    deleteFile: async ({ path, directory }: { path: string; directory: string }) => {
      if (directory !== 'CACHE') throw new Error('wrong delete directory')
      cache.delete(path)
    },
  })
  const originalStat = files.stat
  files.stat = async ({ path, directory }: { path: string; directory?: string }) => {
    if (directory !== 'CACHE') return originalStat({ path })
    if (directories.has(path)) return { type: 'directory', size: 0 }
    const entry = cache.get(path)
    if (!entry) throw new Error('cache entry unavailable')
    return { type: 'file', size: entry.size }
  }
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(input)).pathname)
    const key = path.split('/_capacitor_file_/cache/')[1]
    if (key) {
      const entry = cache.get(key)
      if (!entry) return new Response(null, { status: 404 })
      const range = new Headers(init?.headers).get('Range')
      if (!range || !key.endsWith('.mp4')) {
        native.unbounded++
        throw new Error('native full-body allocation')
      }
      const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(range)!
      const start = Number(a),
        end = Number(b),
        length = end - start + 1
      native.maxBuffer = Math.max(native.maxBuffer, length)
      if (length > 1024 * 1024) throw new Error('native allocation exceeded budget')
      const bytes = entry.bytes?.slice(start, end + 1) ?? new Uint8Array(length).fill(73)
      if (!entry.bytes) {
        native.ranges++
        base.counts.bytesProduced += length
        if (!seen.has(key)) {
          seen.add(key)
          base.counts.largeFetches++
        }
      }
      return new Response(bytes, {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${entry.size}` },
      })
    }
    const local = path.split('/sample/')[1]
    if (base.probes.has(local)) return base.fetcher(input)
    native.unbounded++
    throw new Error('native full-body allocation')
  })
  vi.stubGlobal('fetch', fetcher)
  return { ...base, fetcher, native, cache }
}
