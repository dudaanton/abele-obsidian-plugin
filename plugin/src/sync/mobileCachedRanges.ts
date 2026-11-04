import { EngineError, MAX_CHUNK_BYTES } from '@abele/sync-sdk/core'
import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import type { DataAdapter } from 'obsidian'
import { resourceUrl } from './mobileResourceRanges'
import { mobileReadMeter } from './mobileReadDiagnostics'

interface CacheFiles {
  mkdir(options: { path: string; directory: 'CACHE'; recursive: boolean }): Promise<unknown>
  readdir(options: {
    path: string
    directory: 'CACHE'
  }): Promise<{ files: (string | { name: string })[] }>
  stat(options: { path: string; directory: 'CACHE' }): Promise<{ size: number; type?: string }>
  copy(options: { from: string; to: string; toDirectory: 'CACHE' }): Promise<unknown>
  getUri(options: { path: string; directory: 'CACHE' }): Promise<{ uri: string }>
  deleteFile(options: { path: string; directory: 'CACHE' }): Promise<unknown>
}
const SLOT = Symbol.for('abele.sync.mobile-read-cache-v1')
const fileName = /^read-[0-9a-f]{32}\.mp4$/
/** A derived read cache is never authoritative recovery data. Native cache copies avoid
 * moving user files or putting disposable bytes in the vault's recovery namespace. */
export function readCacheNamespace(adapter: DataAdapter, anchor: string): string {
  const root = resourceUrl(adapter, anchor)
  return 'abele-sync-read-v1/' + bytesToHex(sha256(new TextEncoder().encode(root)))
}
export function cachedResourceRanges(adapter: DataAdapter, fetcher: typeof fetch, anchor: string) {
  const files = (window as unknown as { Capacitor?: { Plugins?: { Filesystem?: CacheFiles } } })
    .Capacitor?.Plugins?.Filesystem
  if (
    !files ||
    ['mkdir', 'readdir', 'stat', 'copy', 'getUri', 'deleteFile'].some(
      (method) => typeof Reflect.get(files, method) !== 'function'
    )
  )
    return null
  let namespace: string
  try {
    namespace = readCacheNamespace(adapter, anchor)
  } catch {
    return null
  }
  let active = Reflect.get(window, SLOT) as Set<string> | undefined
  if (!active) {
    active = new Set<string>()
    Reflect.set(window, SLOT, active)
  }
  const owned = active
  const remove = async (path: string) => {
    try {
      await files.deleteFile({ path, directory: 'CACHE' })
    } catch {
      console.debug('[abele-sync] disposable read cache cleanup deferred')
    }
  }
  let prepared: Promise<void> | undefined
  const prepare = () =>
    (prepared ??= (async () => {
      try {
        await files.mkdir({ path: namespace, directory: 'CACHE', recursive: true })
      } catch (error) {
        if ((await files.stat({ path: namespace, directory: 'CACHE' })).type !== 'directory')
          throw error
      }
      const inventory = await files.readdir({ path: namespace, directory: 'CACHE' })
      for (const entry of inventory.files) {
        const name = typeof entry === 'string' ? entry : entry.name
        if (!fileName.test(name)) continue
        const path = namespace + '/' + name
        if (!owned.has(path)) await remove(path)
      }
    })())
  return {
    response: async (path: string, size: number, signal?: AbortSignal | null) => {
      signal?.throwIfAborted()
      await prepare()
      const id = bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
      const alias = namespace + '/read-' + id + '.mp4'
      owned.add(alias)
      let retiring: Promise<void> | undefined
      const cleanup = () =>
        (retiring ??= (async () => {
          try {
            await remove(alias)
          } finally {
            owned.delete(alias)
          }
        })())
      const controller = new AbortController()
      const abort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
      let flight: Promise<void> = Promise.resolve()
      try {
        signal?.throwIfAborted()
        // Only a host-provided local URI reaches the native copy API.
        const original = new URL(resourceUrl(adapter, path))
        const nativePath = original.pathname.slice('/_capacitor_file_'.length)
        const meter = mobileReadMeter()
        let copied = false
        meter.copyStarted()
        try {
          await files.copy({
            from: new URL(nativePath, 'file://').href,
            to: alias,
            toDirectory: 'CACHE',
          })
          copied = true
        } finally {
          meter.copyFinished(copied ? size : 0)
        }
        signal?.throwIfAborted()
        if ((await files.stat({ path: alias, directory: 'CACHE' })).size !== size)
          throw new EngineError('conflict', 'Disposable read copy changed size')
        const uri = new URL((await files.getUri({ path: alias, directory: 'CACHE' })).uri)
        if (uri.protocol !== 'file:') throw new EngineError('io', 'Local cache URI unavailable')
        const resource = new URL(resourceUrl(adapter, path))
        resource.pathname = '/_capacitor_file_' + uri.pathname
        resource.search = resource.hash = ''
        let at = 0
        const finish = async () => {
          signal?.removeEventListener('abort', abort)
          await cleanup()
        }
        const body = new ReadableStream<Uint8Array>(
          {
            pull: (output) => {
              flight = (async () => {
                try {
                  controller.signal.throwIfAborted()
                  if (at === size) {
                    output.close()
                    await finish()
                    return
                  }
                  const length = Math.min(MAX_CHUNK_BYTES, size - at)
                  const response = await fetcher(resource.href, {
                    cache: 'no-store',
                    signal: controller.signal,
                    headers: { Range: `bytes=${at}-${at + length - 1}` },
                  })
                  // Refuse a full-body response before asking the bridge to materialize it.
                  if (
                    response.status !== 206 ||
                    response.headers.get('Content-Range') !==
                      `bytes ${at}-${at + length - 1}/${size}`
                  ) {
                    await response.body?.cancel()
                    throw new EngineError('io', 'Native cache range response is invalid')
                  }
                  const bytes = new Uint8Array(await response.arrayBuffer())
                  controller.signal.throwIfAborted()
                  if (bytes.length !== length)
                    throw new EngineError('io', 'Truncated native cache range')
                  meter.resourceRange(bytes.length)
                  at += length
                  output.enqueue(bytes)
                  if (at === size) await finish()
                } catch (error) {
                  await finish()
                  output.error(error)
                }
              })()
              return flight
            },
            cancel: async () => {
              controller.abort()
              await flight.catch(() => {})
              await finish()
            },
          },
          { highWaterMark: 0 }
        )
        return new Response(body, { status: 200 })
      } catch (error) {
        controller.abort()
        signal?.removeEventListener('abort', abort)
        await cleanup()
        throw error
      }
    },
  }
}
