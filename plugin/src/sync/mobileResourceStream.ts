import { trackMobileAllocation } from './mobileAllocationEvidence'
import type { DataAdapter } from 'obsidian'
import { EngineError, MAX_CHUNK_BYTES, type ChunkSource } from '@abele/sync-sdk/core'
import { resourceUrl } from './mobileResourceRanges'
import { mobileReadMeter } from './mobileReadDiagnostics'
import { stagingDirectory, reserveStagingPath } from './stagingDirectory'
import { makeParents } from './vaultFolders'
import type { ProbeEvent } from './mobileSequentialSource'
import { SyncTaskBudget } from './syncTaskBudget'
import { cachedResourceRanges } from './mobileCachedRanges'
import { NativeReadTimeout } from './nativeReadDeadline'

/** Consume the bounded producer supplied by cachedResourceRanges. A plain host
 * response stream alone does not prove bounded native memory. Keep one input
 * chunk and one requested output; never materialize the whole resource. */
export function openResourceStream(
  adapter: DataAdapter,
  fetcher: typeof fetch,
  path: string,
  size: number
): ChunkSource {
  const meter = mobileReadMeter()
  const budget = new SyncTaskBudget()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let request: AbortController | undefined
  let tail: Uint8Array | undefined
  let tailAt = 0,
    position = 0,
    closed = false
  let serial: Promise<void> = Promise.resolve()
  const discard = async () => {
    const active = reader
    reader = undefined
    request?.abort()
    request = undefined
    tail = undefined
    tailAt = 0
    meter.hold(0)
    meter.closed()
    try {
      await active?.cancel()
    } catch {
      /* The abort may already have closed it. */
    }
    active?.releaseLock()
  }
  const current = (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (closed) throw new EngineError('io', 'Local resource stream is closed')
  }
  const read = async (offset: number, length: number, signal?: AbortSignal) => {
    current(signal)
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      length > MAX_CHUNK_BYTES ||
      offset + length > size
    )
      throw new EngineError('io', 'Invalid local resource stream read')
    if (!length) return new Uint8Array()
    if (offset < position) {
      await discard()
      position = 0
      meter.restart()
    }
    const abort = () => {
      request?.abort(signal?.reason)
      void reader?.cancel(signal?.reason).catch(() => {})
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      if (!reader) {
        request = new AbortController()
        if (signal?.aborted) abort()
        const response = await fetcher(resourceUrl(adapter, path), {
          cache: 'no-store',
          signal: request.signal,
        })
        if (response.status !== 200 || !response.body?.getReader) {
          await response.body?.cancel()
          throw new EngineError('io', 'Local resource streaming is unavailable')
        }
        reader = response.body.getReader()
        meter.opened()
      }
      const output = new Uint8Array(length)
      trackMobileAllocation(output.buffer)
      meter.hold((tail?.buffer.byteLength ?? 0) + output.byteLength)
      let copied = 0
      while (copied < length) {
        current(signal)
        if (!tail || tailAt === tail.length) {
          tail = undefined
          tailAt = 0
          meter.hold(output.byteLength)
          const next = await reader.read()
          current(signal)
          if (next.done) throw new EngineError('io', 'Truncated local resource stream')
          if (!next.value.byteLength) continue
          meter.chunk(next.value.length, next.value.buffer.byteLength, MAX_CHUNK_BYTES)
          meter.hold(next.value.buffer.byteLength + output.byteLength)
          if (next.value.buffer.byteLength > MAX_CHUNK_BYTES || position + next.value.length > size)
            throw new EngineError('io', 'Local resource stream exceeded its bounded chunk')
          tail = next.value
          await budget.account(tail.length, signal)
        }
        if (position < offset) {
          const skipped = Math.min(offset - position, tail.length - tailAt)
          tailAt += skipped
          position += skipped
          meter.skip(skipped)
        } else {
          const taken = Math.min(length - copied, tail.length - tailAt)
          output.set(tail.subarray(tailAt, tailAt + taken), copied)
          tailAt += taken
          copied += taken
          position += taken
        }
      }
      if (tailAt === tail?.length) {
        tail = undefined
        tailAt = 0
      }
      meter.output(output.length)
      meter.hold(tail?.buffer.byteLength ?? 0)
      return output
    } catch (error) {
      await discard()
      position = 0
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }
  return {
    size,
    read: (offset, length, signal) => {
      const next = serial.then(() => read(offset, length, signal))
      serial = next.then(
        () => {},
        () => {}
      )
      return next
    },
    assertUnchanged: async () => {
      // The owning BoundedVaultIo source supplies its adapter stat/generation check.
      current()
    },
    close: async () => {
      if (closed) return
      closed = true
      await discard()
      await serial
    },
  }
}

export async function probeResourceStream(
  adapter: DataAdapter,
  fetcher: typeof fetch,
  trace: (event: ProbeEvent) => void = () => {},
  configDir?: string,
  privateRoot?: string
) {
  const cache = cachedResourceRanges(adapter, fetcher, stagingDirectory(configDir, privateRoot))
  if (!cache) return null
  const open = (path: string, size: number) =>
    openResourceStream(
      adapter,
      (_url, init) => cache.response(path, size, init?.signal),
      path,
      size
    )
  const path = `${stagingDirectory(configDir, privateRoot)}/.abele-sync-${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}.tmp`
  const release = reserveStagingPath(path)
  let created = false
  let source: ChunkSource | undefined
  const cancellation = new AbortController()
  const timer = window.setTimeout(
    () => cancellation.abort(new Error('Local resource stream discovery timed out')),
    30000
  )
  try {
    resourceUrl(adapter, path)
    if (await adapter.exists(path)) return null
    await makeParents(adapter, path)
    await adapter.writeBinary(path, new Uint8Array([11, 37, 89, 143]).buffer)
    created = true
    source = open(path, 4)
    const bytes = await source.read(0, 4, cancellation.signal)
    if (bytes.some((byte, index) => byte !== [11, 37, 89, 143][index])) return null
    trace({ step: 'verified', mode: 'cached-native-ranges' })
    return { open }
  } catch (error) {
    trace({ step: 'error', method: 'resource-stream', message: String(error) })
    if (error instanceof NativeReadTimeout) throw error
    return null
  } finally {
    window.clearTimeout(timer)
    try {
      try {
        await source?.close()
      } finally {
        if (created) await adapter.remove(path)
      }
    } finally {
      release()
    }
  }
}
