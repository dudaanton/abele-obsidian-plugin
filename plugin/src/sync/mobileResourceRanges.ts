import type { DataAdapter } from 'obsidian'
import { EngineError, MAX_CHUNK_BYTES } from '@abele/sync-sdk/core'
import type { ProbeEvent } from './mobileSequentialSource'
import { stagingDirectory, reserveStagingPath } from './stagingDirectory'
import { makeParents } from './vaultFolders'

export function resourceUrl(adapter: DataAdapter, path: string): string {
  const url = new URL(adapter.getResourcePath(path))
  if (
    url.hostname !== 'localhost' ||
    !['capacitor:', 'ionic:', 'http:', 'https:'].includes(url.protocol) ||
    !url.pathname.startsWith('/_capacitor_file_/')
  )
    throw new EngineError('io', 'Local WebView file resource URL is unavailable')
  url.search = ''
  url.hash = ''
  return url.href
}

export async function probeResourceRanges(
  adapter: DataAdapter,
  fetcher: typeof fetch,
  trace: (event: ProbeEvent) => void = () => {},
  configDir?: string,
  privateRoot?: string
) {
  const name = `${stagingDirectory(configDir, privateRoot)}/.abele-sync-${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}.tmp`
  const bytes = new Uint8Array(20 * 1024)
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
  let created = false
  const request = async (
    path: string,
    size: number,
    offset?: number,
    length?: number,
    signal?: AbortSignal,
    diagnostic = false
  ) => {
    signal?.throwIfAborted()
    const url = resourceUrl(adapter, path),
      controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const timer = window.setTimeout(
      () => controller.abort(new Error('WebView range request timed out')),
      30000
    )
    const headers = offset === undefined ? {} : { Range: `bytes=${offset}-${offset + length - 1}` }
    if (diagnostic)
      trace({
        step: 'call',
        method: 'fetch-resource',
        url,
        directory: null,
        options: { headers, cache: 'no-store' },
      })
    let response: Response | undefined,
      consumed = false
    try {
      response = await fetcher(url, { headers, signal: controller.signal, cache: 'no-store' })
      const actualHeaders: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        actualHeaders[key.toLowerCase()] = value
      })
      if (diagnostic)
        trace({ step: 'resource-headers', url, status: response.status, headers: actualHeaders })
      const contentRange =
        offset === undefined ? null : `bytes ${offset}-${offset + length - 1}/${size}`
      const valid =
        offset === undefined
          ? response.status === 200
          : response.status === 206 &&
            response.headers.get('Content-Range') === contentRange &&
            (response.headers.get('Content-Length') === null ||
              response.headers.get('Content-Length') === String(length))
      // A large ignored Range must never reach arrayBuffer(). Diagnostic input is only 20 KiB.
      if (!valid && !diagnostic)
        throw new EngineError('io', 'WebView file range response is invalid')
      let data: Uint8Array
      try {
        data = new Uint8Array(await response.arrayBuffer())
      } catch (error) {
        if (diagnostic)
          trace({
            step: 'resource-response',
            url,
            status: response.status,
            headers: actualHeaders,
            bodyBytes: null,
            message: error instanceof Error ? error.message : String(error),
          })
        throw error
      }
      consumed = true
      if (diagnostic)
        trace({
          step: 'resource-response',
          url,
          status: response.status,
          headers: actualHeaders,
          bodyBytes: data.length,
          validHeaders: valid,
        })
      if (!valid || data.length !== (offset === undefined ? size : length))
        throw new EngineError('io', 'WebView file range response is invalid')
      return data
    } finally {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (response && !consumed) {
        try {
          await response.body?.cancel()
        } catch {
          /* Header refusal still holds. */
        }
      }
    }
  }
  const release = reserveStagingPath(name)
  try {
    // Resolve first so non-resource adapters neither create files nor attempt network requests.
    const url = resourceUrl(adapter, name)
    trace({ step: 'resource-path', url, directory: null })
    if (await adapter.exists(name)) return null
    await makeParents(adapter, name)
    await adapter.writeBinary(name, bytes.buffer)
    created = true
    trace({ step: 'create', path: name, bytes: bytes.length })
    let verified = true
    for (const range of [
      { offset: 0, length: 4096 },
      { offset: 8193, length: 4096 },
      { offset: bytes.length - 7, length: 7 },
      null,
    ]) {
      try {
        const data = await request(
          name,
          bytes.length,
          range?.offset,
          range?.length,
          undefined,
          true
        )
        const start = range?.offset ?? 0
        if (data.some((byte, i) => byte !== bytes[start + i]))
          throw new Error('WebView file resource content mismatch')
      } catch (error) {
        verified = false
        trace({
          step: 'error',
          method: 'fetch-resource',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (!verified) return null
    trace({ step: 'verified', mode: 'webview-ranges' })
    return {
      read: (path: string, size: number, offset: number, length: number, signal?: AbortSignal) => {
        if (
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(length) ||
          offset < 0 ||
          length < 0 ||
          length > MAX_CHUNK_BYTES ||
          offset + length > size
        )
          throw new EngineError('io', 'Invalid WebView range read')
        if (!length) {
          signal?.throwIfAborted()
          return Promise.resolve(new Uint8Array())
        }
        return request(path, size, offset, length, signal)
      },
    }
  } catch (error) {
    trace({
      step: 'error',
      method: 'fetch-resource',
      message: error instanceof Error ? error.message : String(error),
    })
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
