import { EngineError } from '@abele/sync-sdk/core'

/** Only the authenticated connection response's literal true enables browser parts. */
export function supportsBrowserUploads(
  connection: unknown,
  consumeExtension?: (protocol: Record<string, unknown>) => void
): boolean {
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) return false
  const { browserUploads: capability, ...protocol } = connection as Record<string, unknown>
  // The pinned SDK validates connection replies strictly. Remove only this
  // transport extension; all other fields still reach its normal validation.
  if (Object.hasOwn(connection, 'browserUploads')) consumeExtension?.(protocol)
  return capability === true
}

const partPath = /^\/v2\/uploads\/[a-f0-9]{64}\/[A-Za-z0-9_-]+\/(?:0|[1-9][0-9]*)$/
const maxPartBytes = 1024 * 1024
const memory = { requests: 0, completed: 0, activeBytes: 0, peakBytes: 0, submittedBytes: 0 }
export const browserUploadSnapshot = () => ({ ...memory })

/** The supplied browser port must be the original fetch, never Capacitor's patched
 * mutation port. Native remains responsible for discovering server capabilities. */
export function browserUploadTransport(native: typeof fetch, browser?: typeof fetch): typeof fetch {
  const capabilities = new Map<string, { generation: number; allowed: boolean }>()
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    )
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    // Capability discovery must not authorize a different connection or principal.
    // Keys stay in memory and are never included in diagnostic output.
    const key = JSON.stringify([
      url.origin,
      headers.get('authorization'),
      headers.get('abele-scope-item'),
    ])
    if (method === 'GET' && url.pathname === '/v2/connection') {
      const entry = capabilities.get(key) ?? { generation: 0, allowed: false }
      capabilities.set(key, entry)
      const generation = ++entry.generation
      const requested = headers.get('abele-client-capabilities')
      if (!requested?.split(',').some((token) => token.trim() === 'browserUploads'))
        headers.set(
          'abele-client-capabilities',
          requested ? `${requested}, browserUploads` : 'browserUploads'
        )
      const response = await native(input, { ...init, headers })
      let result = response
      let allowed = false
      if (response.ok) {
        try {
          allowed = supportsBrowserUploads(await response.clone().json(), (protocol) => {
            const headers = new Headers(response.headers)
            headers.delete('content-length')
            result = new Response(JSON.stringify(protocol), {
              status: response.status,
              statusText: response.statusText,
              headers,
            })
          })
        } catch {
          // Preserve the original response for the SDK's protocol diagnosis.
        }
      }
      if (generation === entry.generation) entry.allowed = allowed
      signal?.throwIfAborted()
      return result
    }
    if (!browser) return native(input, init)
    const body = init?.body
    const binary = body instanceof ArrayBuffer || ArrayBuffer.isView(body)
    const bytes = binary ? body.byteLength : 0
    if (
      method !== 'PUT' ||
      !partPath.test(url.pathname) ||
      !binary ||
      bytes < 1 ||
      bytes > maxPartBytes ||
      (ArrayBuffer.isView(body) && body.buffer.byteLength > maxPartBytes) ||
      !capabilities.get(key)?.allowed
    )
      return native(input, init)

    signal?.throwIfAborted()
    let response: Response
    memory.requests++
    memory.activeBytes += bytes
    memory.submittedBytes += bytes
    memory.peakBytes = Math.max(memory.peakBytes, memory.activeBytes)
    try {
      response = await browser(url.href, {
        ...init,
        method,
        headers,
        signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        mode: 'cors',
      })
    } catch (cause) {
      signal?.throwIfAborted()
      // A rejected fetch may already have delivered the part. The SDK reconciles
      // its idempotent upload session; never retry via another transport here.
      throw new EngineError('offline', 'Browser upload interrupted', cause)
    } finally {
      memory.activeBytes -= bytes
      memory.completed++
    }
    signal?.throwIfAborted()
    if (
      response.url !== url.href ||
      response.redirected ||
      response.type === 'opaqueredirect' ||
      (response.status >= 300 && response.status < 400)
    ) {
      await response.body?.cancel().catch(() => {})
      throw new EngineError('io', 'Browser upload refused a redirect or unexpected response URL')
    }
    return response
  }
}
