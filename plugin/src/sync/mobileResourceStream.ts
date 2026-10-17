import type { DataAdapter } from 'obsidian'
import { EngineError, MAX_CHUNK_BYTES } from '@abele/sync-core'
import { resourceUrl } from './mobileResourceRanges'
import { mobileReadMeter } from './mobileReadDiagnostics'
import { stagingDirectory, reserveStagingPath } from './stagingDirectory'
import { makeParents } from './vaultFolders'
import type { ProbeEvent } from './mobileSequentialSource'

/** Retain one bridge delivery and a bounded output; never prefetch another delivery. */
export function resourceStream(
  adapter: DataAdapter,
  fetcher: typeof fetch,
  path: string,
  size: number,
  assertOwned: () => void = () => {}
) {
  const meter = mobileReadMeter()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let controller: AbortController | undefined
  let pendingChunk: Uint8Array | undefined,
    cursor = 0,
    used = 0,
    output = 0
  let closed = false,
    started = false,
    tail = Promise.resolve()
  const gauge = () => meter.hold((pendingChunk?.buffer.byteLength ?? 0) + output)
  const dispose = async () => {
    controller?.abort()
    controller = undefined
    const previous = reader
    reader = undefined
    pendingChunk = undefined
    gauge()
    try {
      await previous?.cancel()
    } catch {
      /* Preserve the original read/close outcome. */
    }
    try {
      previous?.releaseLock()
    } catch {
      /* A cancelled reader may already be detached. */
    }
    meter.closed()
  }
  const wait = async <T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    signal?.throwIfAborted()
    const control = controller
    control.signal.throwIfAborted()
    let rejectAbort: (error: unknown) => void = () => {}
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject
    })
    const abort = () => rejectAbort(control.signal.reason)
    const forward = () => control.abort(signal?.reason)
    control.signal.addEventListener('abort', abort, { once: true })
    signal?.addEventListener('abort', forward, { once: true })
    // Cancel stalled I/O with the owning window timer.
    const timeout = window.setTimeout(
      () => control.abort(new EngineError('io', 'Local file stream stalled')),
      30000
    )
    try {
      return await Promise.race([work(), aborted])
    } finally {
      window.clearTimeout(timeout)
      control.signal.removeEventListener('abort', abort)
      signal?.removeEventListener('abort', forward)
    }
  }
  const open = async (signal?: AbortSignal) => {
    assertOwned()
    controller = new AbortController()
    const requestSignal = controller.signal
    const response = await wait(async () => {
      const response = await fetcher(resourceUrl(adapter, path), {
        cache: 'no-store',
        signal: requestSignal,
      })
      if (requestSignal.aborted) {
        try {
          await response.body?.cancel()
        } catch {
          /* Preserve cancellation. */
        }
        requestSignal.throwIfAborted()
      }
      return response
    }, signal)
    try {
      assertOwned()
      if (closed) throw new EngineError('io', 'Local stream closed')
      // Custom-scheme resources may have status zero and absent/stale headers.
      // resourceUrl already confines this fetch to the local resource bridge.
      if ((response.status !== 200 && response.status !== 0) || !response.body)
        throw new EngineError('io', 'Local file streaming response is invalid')
      reader = response.body.getReader()
    } catch (error) {
      try {
        await response.body?.cancel()
      } catch {
        /* Preserve ownership/header refusal. */
      }
      throw error
    }
    meter.opened()
    cursor = 0
    used = 0
    started = true
  }
  const next = async (signal?: AbortSignal) => {
    pendingChunk = undefined
    used = 0
    gauge()
    const result = await wait(() => reader.read(), signal)
    assertOwned()
    if (result.done) throw new EngineError('io', 'Truncated local file stream')
    const bytes = result.value
    meter.chunk(bytes.byteLength, bytes.buffer.byteLength, MAX_CHUNK_BYTES)
    pendingChunk = bytes
    gauge()
    if (!bytes.byteLength || cursor + bytes.byteLength > size)
      throw new EngineError('io', 'Invalid local file stream chunk')
  }
  const read = async (offset: number, length: number, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    assertOwned()
    if (
      closed ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      length > MAX_CHUNK_BYTES ||
      offset + length > size
    )
      throw new EngineError('io', 'Invalid local stream read')
    if (!length) return new Uint8Array()
    try {
      if (!reader || offset < cursor) {
        if (started) meter.restart()
        await dispose()
        if (closed) throw new EngineError('io', 'Local stream closed')
        await open(signal)
      }
      const bytes = new Uint8Array(length)
      output = length
      meter.output(length)
      gauge()
      let filled = 0
      while (cursor < offset + length) {
        if (!pendingChunk || used === pendingChunk.length) await next(signal)
        signal?.throwIfAborted()
        const skip = cursor < offset
        const take = Math.min(
          MAX_CHUNK_BYTES,
          pendingChunk.length - used,
          (skip ? offset : offset + length) - cursor
        )
        if (skip) meter.skip(take)
        else {
          bytes.set(pendingChunk.subarray(used, used + take), filled)
          filled += take
        }
        used += take
        cursor += take
        if (used === pendingChunk.length) {
          pendingChunk = undefined
          gauge()
        }
      }
      // Consume EOF as evidence too: reject a body longer than the statted source.
      if (cursor === size) {
        pendingChunk = undefined
        gauge()
        const end = await wait(() => reader.read(), signal)
        assertOwned()
        if (!end.done) {
          meter.chunk(end.value.byteLength, end.value.buffer.byteLength, MAX_CHUNK_BYTES)
          meter.hold(output + end.value.buffer.byteLength)
          throw new EngineError('io', 'Local file stream exceeded its size')
        }
        await dispose()
      }
      assertOwned()
      return bytes
    } catch (error) {
      await dispose()
      throw error
    } finally {
      output = 0
      gauge()
    }
  }
  return {
    read(offset: number, length: number, signal?: AbortSignal) {
      const pending = tail.then(() => read(offset, length, signal))
      tail = pending.then(
        () => {},
        () => {}
      )
      return pending
    },
    async close() {
      closed = true
      await dispose()
      await tail
      meter.hold(0)
    },
  }
}

/** Verify the stream against tiny owned bytes before using a large local resource. */
export async function probeResourceStream(
  adapter: DataAdapter,
  fetcher: typeof fetch,
  trace: (event: ProbeEvent) => void,
  configDir?: string,
  privateRoot?: string,
  assertOwned: () => void = () => {}
) {
  const name = `${stagingDirectory(configDir, privateRoot)}/.abele-sync-${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}.tmp`
  let created = false
  const release = reserveStagingPath(name)
  let source: ReturnType<typeof resourceStream> | undefined
  try {
    resourceUrl(adapter, name)
    if (await adapter.exists(name)) return null
    assertOwned()
    await makeParents(adapter, name)
    const bytes = Uint8Array.from({ length: 20480 }, (_, i) => i % 251)
    assertOwned()
    await adapter.writeBinary(name, bytes.buffer)
    created = true
    source = resourceStream(adapter, fetcher, name, bytes.length, assertOwned)
    const actual = await source.read(0, bytes.length)
    if (actual.some((byte, i) => byte !== bytes[i]))
      throw new EngineError('io', 'Local stream probe content mismatch')
    trace({ step: 'verified', mode: 'webview-stream' })
    return {
      open: (path: string, size: number) =>
        resourceStream(adapter, fetcher, path, size, assertOwned),
    }
  } catch (error) {
    trace({
      step: 'error',
      method: 'fetch-stream',
      message: error instanceof Error ? error.message : String(error),
    })
    return null
  } finally {
    await source?.close()
    try {
      if (created) {
        assertOwned()
        await adapter.remove(name)
      }
    } finally {
      release()
    }
  }
}
