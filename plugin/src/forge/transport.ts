/** Plain single-hop HTTP boundary; host adapters own native APIs and redirect handling. */
export interface HttpRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | ArrayBuffer
  contentType?: string
  throw?: boolean
}
export interface HttpResponse {
  status: number
  headers: Record<string, string>
  text: string
  arrayBuffer: ArrayBuffer
  readonly json: unknown
}
export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>

export interface CredentialSession {
  readonly connectionId: string
  readonly generation: string
  readonly signal?: AbortSignal
  assertCurrent(): void
}

/** Check both sides of every async boundary, including cache and secondary reads. */
export async function checkedRead<T>(
  session: CredentialSession,
  read: () => Promise<T>
): Promise<T> {
  session.assertCurrent()
  session.signal?.throwIfAborted()
  const value = await read()
  session.assertCurrent()
  session.signal?.throwIfAborted()
  return value
}

const privateHeaders = new Set([
  'authorization',
  'private-token',
  'job-token',
  'deploy-token',
  'cookie',
  'proxy-authorization',
  'if-none-match',
])
export function withoutCredentials(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !privateHeaders.has(name.toLowerCase()))
  )
}
