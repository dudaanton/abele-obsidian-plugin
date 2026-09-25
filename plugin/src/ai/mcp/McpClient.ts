/**
 * A client for one MCP server over Streamable HTTP.
 *
 * Hand-written rather than the official SDK: the plugin needs five calls, and the SDK brings a
 * server framework and a process launcher with it, while still needing a request function of
 * ours — its `fetch` is held to CORS, and Obsidian's `requestUrl` is not. That is the one used
 * here, on desktop and phone alike. It returns a response only once the server has finished it,
 * which suits MCP: an answer sent as an event stream ends with the response and is then closed.
 *
 * Two shapes of the protocol are spoken, told apart the way the specification says:
 * - modern (2026-07-28): no handshake, no session; every request carries its version in `_meta`
 *   and in headers. Tried first, with `server/discover`.
 * - legacy (2025-03-26 … 2025-11-25): `initialize`, then `Mcp-Session-Id` on everything. Taken
 *   when the probe is refused with anything a modern server would not say.
 * The older HTTP+SSE transport (2024-11-05) is not spoken: it is deprecated, and it needs a
 * stream held open for every answer, which `requestUrl` cannot hold.
 */
import { requestUrl } from 'obsidian'
import { parseSseData } from './sse'
import type { McpCallResult, McpToolSnapshot } from './types'

export interface McpHttpRequest {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: string
}

export interface McpHttpResponse {
  status: number
  /** Header names in lower case. */
  headers: Record<string, string>
  text: string
}

export type McpRequest = (request: McpHttpRequest) => Promise<McpHttpResponse>

export const MODERN_VERSION = '2026-07-28'
/** What `initialize` proposes; the server answers with the version it will actually speak. */
export const LEGACY_VERSION = '2025-11-25'

const CLIENT_INFO = { name: 'abele-obsidian-plugin', version: '1.0.0' }

/**
 * Errors only a modern server sends. Seeing one means the server is modern and the request was
 * wrong, not that it is an older server — so there is no falling back on them.
 */
const MODERN_ERRORS = new Set([
  -32022, // UnsupportedProtocolVersion
  -32020, // HeaderMismatch
])

export class McpError extends Error {
  constructor(
    message: string,
    /** The HTTP status, when the server answered at all. */
    readonly status?: number,
    /** The JSON-RPC error code, when there was one. */
    readonly code?: number,
    readonly data?: unknown
  ) {
    super(message)
    this.name = 'McpError'
  }
}

/** Obsidian's `requestUrl`: no CORS, on every platform. It throws only when nothing answered. */
export const obsidianRequest: McpRequest = async ({ url, method, headers, body }) => {
  const response = await requestUrl({ url, method, headers, body, throw: false })
  const lower: Record<string, string> = {}
  for (const [key, value] of Object.entries(response.headers ?? {})) {
    lower[key.toLowerCase()] = value
  }
  let text = ''
  try {
    text = response.text
  } catch {
    // A body that is not text: nothing an MCP server should send, and nothing to read.
  }
  return { status: response.status, headers: lower, text }
}

export interface McpClientOptions {
  url: string
  /** Sent with every request: authorisation and whatever else the server wants. */
  headers: Record<string, string>
  request?: McpRequest
  /** Tools already known, so a call can mirror their parameters without listing them first. */
  tools?: McpToolSnapshot[]
}

interface JsonRpcMessage {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
  result?: any
  error?: { code: number; message: string; data?: unknown }
}

export class McpClient {
  /** Which shape of the protocol the server speaks, once known. */
  era: 'modern' | 'legacy' | null = null

  private readonly url: string
  private readonly headers: Record<string, string>
  private readonly request: McpRequest
  private session: string | null = null
  private legacyVersion = LEGACY_VERSION
  private nextId = 1
  private probing: Promise<void> | null = null
  private readonly schemas = new Map<string, Record<string, unknown>>()

  constructor(options: McpClientOptions) {
    this.url = options.url
    this.headers = options.headers
    this.request = options.request ?? obsidianRequest
    for (const tool of options.tools ?? []) this.schemas.set(tool.name, tool.inputSchema)
  }

  /** Every tool the server offers, page by page. */
  async listTools(signal?: AbortSignal): Promise<McpToolSnapshot[]> {
    const tools: McpToolSnapshot[] = []
    let cursor: string | undefined
    // A server that hands back the same cursor forever is not allowed to hang the settings.
    for (let page = 0; page < 50; page++) {
      const result = await this.call('tools/list', cursor ? { cursor } : {}, signal)
      for (const raw of (result?.tools ?? []) as any[]) {
        if (!raw || typeof raw.name !== 'string') continue
        const inputSchema =
          raw.inputSchema && typeof raw.inputSchema === 'object'
            ? (raw.inputSchema as Record<string, unknown>)
            : { type: 'object', properties: {} }
        // The specification: a tool whose header annotations break the rules is left out,
        // so one bad definition does not take the rest of the server with it.
        if (this.era === 'modern' && headerParams(inputSchema) === null) {
          console.warn(`[abele] MCP: skipping tool ${raw.name}: invalid x-mcp-header`)
          continue
        }
        const tool: McpToolSnapshot = {
          name: raw.name,
          description: typeof raw.description === 'string' ? raw.description : '',
          inputSchema,
        }
        if (typeof raw.title === 'string' && raw.title) tool.title = raw.title
        tools.push(tool)
        this.schemas.set(tool.name, inputSchema)
      }
      cursor =
        typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined
      if (!cursor) break
    }
    return tools
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpCallResult> {
    const result = await this.call('tools/call', { name, arguments: args }, signal)
    if (result && Array.isArray(result.inputRequests)) {
      throw new McpError(
        'The server asked for more input in the middle of the call, which this plugin cannot give yet'
      )
    }
    return {
      content: Array.isArray(result?.content) ? result.content : [],
      structuredContent: result?.structuredContent,
      isError: result?.isError === true,
    }
  }

  // ── The protocol ─────────────────────────────────────────────

  private async call(method: string, params: Record<string, unknown>, signal?: AbortSignal) {
    if (signal?.aborted) throw stopped()
    await this.ensureEra()

    if (this.era === 'modern') return this.modern(method, params, signal)

    try {
      return await this.legacy(method, params, signal)
    } catch (error) {
      // A legacy server that restarted has forgotten the session: begin a new one, once.
      if (error instanceof McpError && error.status === 404 && this.session) {
        this.session = null
        await this.initialize()
        return this.legacy(method, params, signal)
      }
      throw error
    }
  }

  private ensureEra(): Promise<void> {
    if (this.era) return Promise.resolve()
    if (this.probing === null) {
      this.probing = this.probe().finally(() => {
        this.probing = null
      })
    }
    return this.probing
  }

  private async probe(): Promise<void> {
    try {
      await this.modern('server/discover', {})
      this.era = 'modern'
      return
    } catch (error) {
      if (error instanceof McpError && error.code !== undefined && MODERN_ERRORS.has(error.code)) {
        const supported = (error.data as { supported?: unknown } | undefined)?.supported
        const legacyOnly =
          error.code === -32022 &&
          Array.isArray(supported) &&
          supported.every((v) => typeof v === 'string' && v < MODERN_VERSION)
        if (!legacyOnly) throw error
      }
    }
    await this.initialize()
    this.era = 'legacy'
  }

  private async initialize(): Promise<void> {
    const id = this.nextId++
    const response = await this.post(
      {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: {
          protocolVersion: LEGACY_VERSION,
          capabilities: {},
          clientInfo: CLIENT_INFO,
        },
      },
      {}
    )
    const result = readResult(response, id)
    this.session = response.headers['mcp-session-id'] || null
    if (typeof result?.protocolVersion === 'string') this.legacyVersion = result.protocolVersion
    // Accepted with 202 and nothing else; a server that minds it missing would say so later.
    await this.post(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      this.legacyHeaders()
    ).catch((): undefined => undefined)
  }

  private legacyHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'MCP-Protocol-Version': this.legacyVersion }
    if (this.session) headers['Mcp-Session-Id'] = this.session
    return headers
  }

  private async legacy(method: string, params: Record<string, unknown>, signal?: AbortSignal) {
    const id = this.nextId++
    const response = await this.withStop(
      this.post({ jsonrpc: '2.0', id, method, params }, this.legacyHeaders()),
      signal,
      () => {
        // The legacy way to say it: a notification, answered or not.
        void this.post(
          {
            jsonrpc: '2.0',
            method: 'notifications/cancelled',
            params: { requestId: id, reason: 'Stopped by the user' },
          },
          this.legacyHeaders()
        ).catch((): undefined => undefined)
      }
    )
    return readResult(response, id)
  }

  private async modern(method: string, params: Record<string, unknown>, signal?: AbortSignal) {
    const id = this.nextId++
    const headers: Record<string, string> = {
      'MCP-Protocol-Version': MODERN_VERSION,
      'Mcp-Method': method,
    }
    const named = typeof params.name === 'string' ? params.name : undefined
    if (method === 'tools/call' && named) {
      headers['Mcp-Name'] = headerValue(named)
      const schema = this.schemas.get(named)
      const mirrored = schema ? headerParams(schema) : null
      const args = (params.arguments ?? {}) as Record<string, unknown>
      for (const { path, header } of mirrored ?? []) {
        const value = valueAt(args, path)
        if (value === null || value === undefined) continue
        // Only strings, integers and booleans can be annotated; `headerParams` holds that line.
        headers[`Mcp-Param-${header}`] = headerValue(`${value as string | number | boolean}`)
      }
    }
    const body = {
      jsonrpc: '2.0',
      id,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MODERN_VERSION,
          'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }
    // Modern servers take the end of the stream as the cancellation; `requestUrl` cannot end
    // one, so a stopped call is simply no longer waited for.
    const response = await this.withStop(this.post(body, headers), signal)
    return readResult(response, id)
  }

  private async post(message: JsonRpcMessage, extra: Record<string, string>) {
    try {
      return await this.request({
        url: this.url,
        method: 'POST',
        headers: {
          ...this.headers,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...extra,
        },
        body: JSON.stringify(message),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new McpError(`Could not reach ${this.url}: ${reason}`)
    }
  }

  /** The request, or a rejection the moment Stop is pressed — whichever comes first. */
  private withStop<T>(work: Promise<T>, signal?: AbortSignal, onStop?: () => void): Promise<T> {
    if (!signal) return work
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        onStop?.()
        reject(stopped())
      }
      if (signal.aborted) return abort()
      signal.addEventListener('abort', abort, { once: true })
      work.then(
        (value) => {
          signal.removeEventListener('abort', abort)
          resolve(value)
        },
        (error: unknown) => {
          signal.removeEventListener('abort', abort)
          reject(error instanceof Error ? error : new Error(JSON.stringify(error)))
        }
      )
    })
  }
}

const stopped = () => new McpError('The call was stopped')

/** The response to request `id` out of a plain JSON body or an event stream. */
function readResult(response: McpHttpResponse, id: number): any {
  const type = response.headers['content-type'] ?? ''
  const messages: JsonRpcMessage[] = []
  const parse = (text: string) => {
    try {
      const value = JSON.parse(text) as JsonRpcMessage | JsonRpcMessage[]
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item && typeof item === 'object') messages.push(item)
      }
    } catch {
      // Not JSON: an HTML error page, a proxy's message. Reported by status below.
    }
  }
  if (type.includes('text/event-stream')) parseSseData(response.text).forEach(parse)
  else if (response.text) parse(response.text)

  const answer =
    messages.find((m) => m.id === id && (m.result !== undefined || m.error)) ??
    // An error the server could not tie to a request carries no id.
    messages.find((m) => (m.id === null || m.id === undefined) && m.error)

  if (answer?.error) {
    throw new McpError(
      answer.error.message || `Error ${answer.error.code}`,
      response.status,
      answer.error.code,
      answer.error.data
    )
  }
  if (response.status >= 400) {
    const snippet = response.text.trim().slice(0, 200)
    throw new McpError(
      `The server answered HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`,
      response.status
    )
  }
  if (!answer) {
    throw new McpError(
      `The server answered HTTP ${response.status} with no response to the request`,
      response.status
    )
  }
  return answer.result
}

// ── Headers mirrored from parameters (2026-07-28) ───────────────

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const SENTINEL = /^=\?base64\?.*\?=$/

/**
 * The parameters a tool asks to have mirrored into `Mcp-Param-*` headers, or `null` when its
 * annotations break the rules — which makes the whole tool unusable, per the specification.
 */
export function headerParams(
  schema: Record<string, unknown>
): { path: string[]; header: string }[] | null {
  const found: { path: string[]; header: string }[] = []
  const seen = new Set<string>()
  let valid = true

  const walk = (node: unknown, path: string[], reachable: boolean) => {
    if (!valid || !node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, path, false)
      return
    }
    const record = node as Record<string, unknown>
    if ('x-mcp-header' in record) {
      const header = record['x-mcp-header']
      const type = record.type
      if (
        !reachable ||
        path.length === 0 ||
        typeof header !== 'string' ||
        !TOKEN.test(header) ||
        seen.has(header.toLowerCase()) ||
        !['string', 'integer', 'boolean'].includes(type as string)
      ) {
        valid = false
        return
      }
      seen.add(header.toLowerCase())
      found.push({ path, header })
    }
    for (const [key, value] of Object.entries(record)) {
      if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
          walk(child, [...path, name], reachable)
        }
      } else if (value && typeof value === 'object') {
        walk(value, path, false)
      }
    }
  }

  walk(schema, [], true)
  return valid ? found : null
}

function valueAt(args: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = args
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** A header value as sent: as is when it is plain ASCII, otherwise base64 in the sentinel. */
export function headerValue(value: string): string {
  const plain = /^[\x20-\x7E\t]*$/.test(value) && value.trim() === value && !SENTINEL.test(value)
  if (plain) return value
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `=?base64?${btoa(binary)}?=`
}
