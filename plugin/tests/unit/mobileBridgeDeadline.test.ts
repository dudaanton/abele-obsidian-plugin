import { afterEach, expect, it, vi } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { BoundedVaultIo } from '@/sync/boundedVaultIo'
import { cachedResourceRanges } from '@/sync/mobileCachedRanges'
import { mobileRangeCacheFixture } from '../helpers/mobileRangeCacheFixture'
import { deferred } from '../helpers/deferred'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function ranged() {
  const probes = new Map<string, Uint8Array>(),
    folders = new Set<string>()
  const adapter = {
    getFullPath: (path: string) => 'file:///sample/' + path,
    exists: async (path: string) => probes.has(path) || folders.has(path),
    mkdir: async (path: string) => {
      folders.add(path)
    },
    stat: async (path: string) => ({
      type: 'file',
      size: probes.get(path)?.length ?? 8 * 1024 * 1024,
      mtime: 1,
      ctime: 1,
    }),
    writeBinary: async (path: string, bytes: ArrayBuffer) => {
      probes.set(path, new Uint8Array(bytes))
    },
    remove: async (path: string) => {
      probes.delete(path)
    },
    readBinary: vi.fn(async () => {
      throw new Error('whole file forbidden')
    }),
  } as unknown as DataAdapter
  const local = (path: string) => path.slice('file:///sample/'.length)
  const files = {
    stat: vi.fn(async ({ path }: { path: string }) => ({
      size: probes.get(local(path))?.length ?? 8 * 1024 * 1024,
    })),
    readFile: vi.fn(
      async ({ path, offset, length }: { path: string; offset: number; length: number }) => {
        const bytes =
          probes.get(local(path))?.slice(offset, offset + length) ?? new Uint8Array(length).fill(73)
        return { data: btoa(String.fromCharCode(...bytes)) }
      }
    ),
  }
  vi.stubGlobal('fetch', undefined)
  vi.stubGlobal('Capacitor', { Plugins: { Filesystem: files } })
  return { io: new BoundedVaultIo(adapter), files, probes, adapter }
}

it.each(['stat', 'readFile', 'sequential-stat'] as const)(
  'bounds a lost direct %s capability probe and permits a fresh attempt',
  async (method) => {
    vi.useFakeTimers()
    const f = ranged(),
      lost = deferred<never>()
    const key = method === 'sequential-stat' ? 'stat' : method
    if (method === 'sequential-stat')
      Reflect.set(f.files, 'readFileInChunks', async () => {
        throw new Error('unsupported callback')
      })
    f.files[key].mockImplementationOnce(() => lost.promise)
    let failure: unknown
    const work = f.io.canReplayStage().catch((error) => {
      failure = error
    })
    await vi.waitFor(() => expect(f.files[key]).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(15000)
    expect(failure).toMatchObject({ code: 'offline', retryable: true })
    await work
    expect(f.probes.size).toBe(0)
    expect(await f.io.canReplayStage()).toBe(true)
  }
)

it.each(['abort', 'deadline'] as const)(
  'releases a direct range read on %s and ignores its late payload',
  async (mode) => {
    const f = ranged(),
      source = await f.io.openRead('large.bin')
    vi.useFakeTimers()
    const late = deferred<{ data: string }>(),
      abort = new AbortController()
    f.files.readFile.mockImplementationOnce(() => late.promise)
    const decode = vi.spyOn(globalThis, 'atob')
    let failure: unknown
    const reading = source.read(0, 4, abort.signal).catch((error) => {
      failure = error
    })
    if (mode === 'abort') abort.abort(new Error('sample cancelled'))
    else await vi.advanceTimersByTimeAsync(15000)
    await vi.advanceTimersByTimeAsync(0)
    expect(failure).toMatchObject(
      mode === 'abort' ? { message: 'sample cancelled' } : { code: 'offline', retryable: true }
    )
    await reading
    late.resolve({ data: btoa('late') })
    await vi.advanceTimersByTimeAsync(0)
    expect(decode).not.toHaveBeenCalled()
    expect(f.adapter.readBinary).not.toHaveBeenCalled()
    await source.close()
  }
)

it('cancels opening while a shared capability probe is waiting without cancelling its cleanup', async () => {
  vi.useFakeTimers()
  const f = ranged(),
    late = deferred<{ size: number }>(),
    abort = new AbortController()
  f.files.stat.mockImplementationOnce(() => late.promise)
  let failure: unknown
  const opening = f.io.openUploadRead('large.bin', undefined, abort.signal).catch((error) => {
    failure = error
  })
  await vi.waitFor(() => expect(f.files.stat).toHaveBeenCalled())
  abort.abort(new Error('sample cancelled'))
  await vi.advanceTimersByTimeAsync(0)
  await Promise.resolve()
  expect(failure).toMatchObject({ message: 'sample cancelled' })
  await opening
  late.resolve({ size: 4 })
  await vi.waitFor(() => expect(f.probes.size).toBe(0))
  expect(await f.io.canReplayStage()).toBe(true)
})

it('bounds a direct callback bridge which never acknowledges or delivers a chunk', async () => {
  vi.useFakeTimers()
  const f = ranged(),
    chunks = vi.fn(() => new Promise<string>(() => {}))
  Reflect.set(f.files, 'readFileInChunks', chunks)
  let failure: unknown
  const probing = f.io.canReplayStage().catch((error) => {
    failure = error
  })
  await vi.waitFor(() => expect(chunks).toHaveBeenCalled())
  await vi.advanceTimersByTimeAsync(15000)
  expect(failure).toMatchObject({ code: 'offline', retryable: true })
  await probing
  expect(f.probes.size).toBe(0)
})

it('cancels a callback reader waiting for a replay without waiting for the old stream to end', async () => {
  const f = ranged()
  let end: ((chunk: { data: string | null }) => void) | undefined
  Reflect.set(
    f.files,
    'readFileInChunks',
    async (
      options: { path: string; chunkSize: number },
      callback: (chunk: { data: string | null }) => void
    ) => {
      const probe = f.probes.get(options.path.slice('file:///sample/'.length))
      if (probe) {
        for (let at = 0; at < probe.length; at += options.chunkSize)
          callback({ data: btoa(String.fromCharCode(...probe.slice(at, at + options.chunkSize))) })
        callback({ data: '' })
      } else {
        end = callback
        callback({ data: btoa('sample live data') })
      }
      return 'sample-callback'
    }
  )
  const source = await f.io.openRead('large.bin')
  vi.useFakeTimers()
  await source.read(10, 4)
  const abort = new AbortController()
  let failure: unknown
  const replay = source.read(0, 4, abort.signal).catch((error) => {
    failure = error
  })
  abort.abort(new Error('sample cancelled'))
  await vi.advanceTimersByTimeAsync(0)
  try {
    expect(failure).toMatchObject({ message: 'sample cancelled' })
  } finally {
    end?.({ data: '' })
    await replay
    end?.({ data: '' })
    await source.close()
  }
})

it.each(['readdir', 'stat', 'getUri'] as const)(
  'bounds a lost cache %s read and cleans its owned alias',
  async (method) => {
    const f = mobileRangeCacheFixture(8 * 1024 * 1024)
    vi.useFakeTimers()
    const files = Reflect.get(window, 'Capacitor').Plugins.Filesystem
    const called = vi.spyOn(files, method).mockImplementationOnce(() => new Promise(() => {}))
    let failure: unknown
    const cache = cachedResourceRanges(f.adapter, f.fetcher, '.abele-sync-work')!
    const reading = cache.response('sample.bin', f.size).catch((error) => {
      failure = error
    })
    await vi.waitFor(() => expect(called).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(15000)
    expect(failure).toMatchObject({ code: 'offline', retryable: true })
    await reading
    expect(f.cache.size).toBe(0)
    expect(f.readBinary).not.toHaveBeenCalled()
    const retry = await cache.response('sample.bin', f.size)
    await retry.body!.cancel()
  }
)
