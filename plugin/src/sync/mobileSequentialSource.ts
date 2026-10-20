import { guardedVaultAdapter } from './vaultPathLinks'
import { nativeChunkPort } from './vaultPathLinks'
import type { DataAdapter } from 'obsidian'
import { stagingDirectory, reserveStagingPath } from './stagingDirectory'
import { makeParents } from './vaultFolders'
import { EngineError, MAX_CHUNK_BYTES, type ChunkSource } from '@abele/sync-sdk/core'

export interface MobilePath {
  path: string
  directory?: 'DOCUMENTS'
}
export interface SequentialFiles {
  stat(options: MobilePath): Promise<{ size: number }>
  readFileInChunks?(
    options: MobilePath & { chunkSize: number },
    callback: (result: { data: string | null } | null, error?: { message: string } | string) => void
  ): Promise<string>
}
export type ProbeEvent = { step: string; [key: string]: unknown }
export function mobilePaths(
  adapter: DataAdapter,
  path: string,
  trace: (event: ProbeEvent) => void = () => {}
) {
  adapter = guardedVaultAdapter(adapter)
  const raw = nativeChunkPort(adapter)
  const paths: MobilePath[] = []
  const add = (value: string) => {
    const url = value.startsWith('/') ? new URL(value, 'file://') : new URL(value)
    let pathname = url.pathname
    const prefix = '/_capacitor_file_'
    if (pathname.startsWith(prefix + '/')) pathname = pathname.slice(prefix.length)
    else if (url.protocol !== 'file:') throw new Error('Unrecognized native resource URL')
    paths.push({ path: new URL(pathname, 'file://').href }, { path: decodeURIComponent(pathname) })
    const documents = pathname.indexOf('/Documents/')
    if (documents >= 0)
      paths.push({
        path: decodeURIComponent(pathname.slice(documents + '/Documents/'.length)),
        directory: 'DOCUMENTS',
      })
  }
  try {
    if (raw.fullPath) {
      const result = raw.fullPath(path)
      trace({ step: 'path', method: 'getFullPath', result })
      add(result)
    }
  } catch (error) {
    trace({ step: 'error', method: 'getFullPath', message: String(error) })
  }
  try {
    const result = adapter.getResourcePath(path)
    trace({ step: 'path', method: 'getResourcePath', result })
    add(result)
  } catch (error) {
    trace({ step: 'error', method: 'getResourcePath', message: String(error) })
  }
  return paths.filter(
    (value, index) =>
      paths.findIndex((one) => JSON.stringify(one) === JSON.stringify(value)) === index
  )
}
function decoded(data: string, limit: number): Uint8Array {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  if (data.length % 4 || (data.length / 4) * 3 - padding > limit)
    throw new EngineError('io', 'Oversized native filesystem chunk')
  const text = atob(data),
    bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes
}

/** A push bridge has no pause API. Keep one read-ahead chunk; skip overflow and replay
 * from the beginning if a slow consumer missed its next offset. Never queue a file's chunks. */
function sequentialSource(
  files: SequentialFiles,
  options: MobilePath,
  size: number,
  chunkSize = MAX_CHUNK_BYTES,
  trace?: (event: ProbeEvent) => void
): ChunkSource {
  let closed = false,
    failure: Error | null = null,
    position = 0,
    running = false,
    reading = false,
    generation = 0
  let cache: { offset: number; bytes: Uint8Array } | null = null
  let pending: {
    offset: number
    bytes: Uint8Array
    filled: number
    resolve(): void
    reject(error: Error): void
  } | null = null
  let completion = Promise.resolve(),
    finish = () => {},
    timer: number | undefined
  const stop = (error?: Error) => {
    window.clearTimeout(timer)
    running = false
    if (error) {
      failure = error
      cache = null
      pending?.reject(error)
      pending = null
    } else if (pending) {
      pending.reject(new EngineError('io', 'Truncated native filesystem stream'))
      pending = null
    }
    finish()
  }
  const start = () => {
    running = true
    position = 0
    cache = null
    const pass = ++generation
    completion = new Promise<void>((resolve) => {
      finish = resolve
    })
    const heartbeat = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(
        () => stop(new EngineError('io', 'Native filesystem stream did not finish')),
        30000
      )
    }
    heartbeat()
    const request = { ...options, chunkSize }
    trace?.({ step: 'call', method: 'readFileInChunks', options: request })
    try {
      void Promise.resolve(
        files.readFileInChunks(request, (result, error) => {
          if (!running || pass !== generation) return
          heartbeat()
          try {
            if (error) {
              trace?.({ step: 'callback-error', result, error })
              throw new Error(typeof error === 'string' ? error : error.message)
            }
            if (result === null || result.data === null || result.data === '') {
              trace?.({ step: 'end', result })
              stop()
              return
            }
            if (typeof result.data !== 'string')
              throw new Error('Invalid native filesystem callback')
            const data = result.data
            const length =
              (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
            if (data.length % 4 || length > chunkSize)
              throw new EngineError('io', 'Oversized native filesystem chunk')
            trace?.({ step: 'chunk', bytes: length, result })
            const at = position
            position += length
            if (position > size)
              throw new EngineError('io', 'Native filesystem stream exceeded its file size')
            const want = pending
            if (want && at <= want.offset + want.filled && position > want.offset + want.filled) {
              const bytes = decoded(data, chunkSize),
                begin = want.offset + want.filled - at
              const count = Math.min(bytes.length - begin, want.bytes.length - want.filled)
              want.bytes.set(bytes.subarray(begin, begin + count), want.filled)
              want.filled += count
              if (want.filled === want.bytes.length) {
                pending = null
                want.resolve()
                if (begin + count < bytes.length)
                  cache = { offset: at + begin + count, bytes: bytes.subarray(begin + count) }
              }
            } else if (!want && !cache && !closed)
              cache = { offset: at, bytes: decoded(data, chunkSize) }
          } catch (error) {
            trace?.({
              step: 'error',
              message: error instanceof Error ? error.message : String(error),
            })
            stop(error instanceof Error ? error : new Error(String(error)))
          }
        })
      ).catch((error) => {
        if (pass !== generation) return
        trace?.({ step: 'error', message: String(error) })
        stop(error instanceof Error ? error : new Error(String(error)))
      })
    } catch (error) {
      stop(error instanceof Error ? error : new Error(String(error)))
    }
  }
  const read: ChunkSource['read'] = async (offset, length, signal) => {
    signal?.throwIfAborted()
    if (
      closed ||
      pending ||
      offset < 0 ||
      length < 0 ||
      length > MAX_CHUNK_BYTES ||
      offset + length > size ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length)
    )
      throw new EngineError('io', 'Invalid sequential source read')
    if (failure) throw failure
    const bytes = new Uint8Array(length)
    let filled = 0
    if (cache && cache.offset <= offset && offset < cache.offset + cache.bytes.length) {
      const from = offset - cache.offset,
        count = Math.min(length, cache.bytes.length - from)
      bytes.set(cache.bytes.subarray(from, from + count))
      filled = count
      cache =
        from + count < cache.bytes.length
          ? { offset: offset + count, bytes: cache.bytes.subarray(from + count) }
          : null
    }
    if (filled === length) return bytes
    if (running && position > offset + filled) await completion
    signal?.throwIfAborted()
    if (closed || failure) throw failure ?? new EngineError('io', 'Sequential source closed')
    const reading = new Promise<void>((resolve, reject) => {
      pending = { offset, bytes, filled, resolve, reject }
    })
    const abort = () => {
      pending?.reject(signal.reason instanceof Error ? signal.reason : new Error('cancelled'))
      pending = null
      cache = null
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (!running) start()
    try {
      await reading
      return bytes
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }
  return {
    size,
    read: async (offset, length, signal) => {
      if (reading) throw new EngineError('io', 'Sequential source is busy')
      reading = true
      try {
        return await read(offset, length, signal)
      } finally {
        reading = false
      }
    },
    assertUnchanged: async () => {
      if (failure) throw failure
      if (!running && position !== size)
        throw new EngineError('io', 'Truncated native filesystem stream')
    },
    close: async () => {
      closed = true
      cache = null
      pending?.reject(new EngineError('io', 'Sequential source closed'))
      pending = null
      await completion
    },
  }
}

export async function probeSequentialFiles(
  adapter: DataAdapter,
  files: SequentialFiles,
  trace: (event: ProbeEvent) => void = () => {},
  configDir?: string,
  privateRoot?: string
) {
  adapter = guardedVaultAdapter(adapter)
  if (!files.readFileInChunks) return null
  const name = `${stagingDirectory(configDir, privateRoot)}/.abele-sync-${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}.tmp`
  const bytes = new Uint8Array(20 * 1024)
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
  if (await adapter.exists(name)) return null
  const release = reserveStagingPath(name)
  let created = false
  try {
    await makeParents(adapter, name)
    trace({ step: 'create', path: name, bytes: bytes.length })
    await adapter.writeBinary(name, bytes.buffer)
    created = true
    const paths = mobilePaths(adapter, name, trace)
    trace({ step: 'paths', options: paths })
    for (let index = 0; index < paths.length; index++) {
      let source: ChunkSource | undefined
      try {
        const options = paths[index]
        trace({ step: 'call', method: 'stat', options })
        const result = await files.stat(options)
        trace({ step: 'result', method: 'stat', result })
        if (result.size !== bytes.length) throw new Error('Native path size mismatch')
        source = sequentialSource(files, options, bytes.length, 4096, trace)
        const actual = await source.read(0, bytes.length)
        await source.close()
        await source.assertUnchanged()
        if (actual.length !== bytes.length || actual.some((byte, i) => byte !== bytes[i]))
          throw new Error('Native path content mismatch')
        trace({ step: 'verified', mode: 'sequential', options })
        return {
          open: (path: string, size: number) =>
            sequentialSource(files, mobilePaths(adapter, path)[index], size),
        }
      } catch (error) {
        trace({ step: 'error', message: error instanceof Error ? error.message : String(error) })
      } finally {
        await source?.close()
      }
    }
    return null
  } catch (error) {
    trace({ step: 'error', message: error instanceof Error ? error.message : String(error) })
    return null
  } finally {
    try {
      if (created) {
        await adapter.remove(name)
        trace({ step: 'delete', path: name })
      }
    } finally {
      release()
    }
  }
}
