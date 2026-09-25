/**
 * A small MCP server on `node:http`, for the client's tests and the e2e tier.
 *
 * It speaks Streamable HTTP in the two shapes found in the wild:
 * - `modern` — revision 2026-07-28: every request carries its version in `_meta` and in
 *   `MCP-Protocol-Version`, no `initialize`, no session;
 * - `legacy` — 2025-03-26 … 2025-11-25: `initialize` first, then `Mcp-Session-Id` on every
 *   request. `sse` answers each request as an event stream instead of plain JSON.
 *
 * It records what it was sent so a test can ask what the client did, not only what it got.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type McpServerMode = 'modern' | 'legacy'

export interface McpTestServerOptions {
  mode: McpServerMode
  /** Answer requests as `text/event-stream` rather than `application/json`. */
  sse?: boolean
  /** Tools per `tools/list` page; the rest come after a cursor. */
  pageSize?: number
  /** A bearer token every request must carry. */
  token?: string
}

export interface RecordedRequest {
  method: string
  headers: http.IncomingHttpHeaders
  body: any
}

export interface McpTestServer {
  url: string
  requests: RecordedRequest[]
  /** Forget every session, as a restarted legacy server would. */
  dropSessions(): void
  close(): Promise<void>
}

const MODERN = '2026-07-28'

export const TEST_TOOLS = [
  {
    name: 'echo',
    title: 'Echo',
    description: 'Says back the text it is given.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'add',
    description: 'Adds two numbers.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
    },
  },
  {
    name: 'picture',
    description: 'Returns a one-pixel picture.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'broken',
    description: 'Always fails.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'slow',
    description: 'Answers after a while.',
    inputSchema: { type: 'object', properties: { ms: { type: 'number' } } },
  },
  {
    name: 'regional',
    description: 'Runs in a region, mirrored into a header.',
    inputSchema: {
      type: 'object',
      properties: { region: { type: 'string', 'x-mcp-header': 'Region' } },
    },
  },
  {
    name: 'bad-header',
    description: 'Declares a header on a parameter it may not.',
    inputSchema: {
      type: 'object',
      properties: { list: { type: 'array', items: { type: 'string', 'x-mcp-header': 'Item' } } },
    },
  },
]

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

async function callTool(
  name: string,
  args: Record<string, any>,
  headers: http.IncomingHttpHeaders
) {
  switch (name) {
    case 'echo':
      return { content: [{ type: 'text', text: `echo: ${args.text}` }] }
    case 'add':
      return {
        content: [{ type: 'text', text: String(Number(args.a) + Number(args.b)) }],
        structuredContent: { sum: Number(args.a) + Number(args.b) },
      }
    case 'picture':
      return {
        content: [
          { type: 'text', text: 'here it is' },
          { type: 'image', data: PIXEL, mimeType: 'image/png' },
        ],
      }
    case 'broken':
      return { content: [{ type: 'text', text: 'it broke' }], isError: true }
    case 'slow':
      await new Promise((resolve) => setTimeout(resolve, Number(args.ms) || 200))
      return { content: [{ type: 'text', text: 'done at last' }] }
    case 'regional':
      return { content: [{ type: 'text', text: `region header: ${headers['mcp-param-region']}` }] }
    default:
      return null
  }
}

export async function startMcpTestServer(options: McpTestServerOptions): Promise<McpTestServer> {
  const requests: RecordedRequest[] = []
  const sessions = new Set<string>()
  let nextSession = 1

  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      void handle(req, res, raw)
    })
  })

  const send = (res: http.ServerResponse, status: number, body: unknown, extra = {}) => {
    if (options.sse && status === 200) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', ...extra })
      // A progress notification first, as a real server may send: the client must skip it.
      res.write(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\n`
      )
      res.write(`: keep-alive\n\n`)
      res.end(`event: message\nid: 1\ndata: ${JSON.stringify(body)}\n\n`)
      return
    }
    res.writeHead(status, { 'Content-Type': 'application/json', ...extra })
    res.end(JSON.stringify(body))
  }

  const error = (id: unknown, code: number, message: string, data?: unknown) => ({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data ? { data } : {}) },
  })

  async function handle(req: http.IncomingMessage, res: http.ServerResponse, raw: string) {
    let body: any = null
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      // Recorded as null; answered below.
    }
    requests.push({ method: req.method ?? '', headers: req.headers, body })

    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (options.token && req.headers.authorization !== `Bearer ${options.token}`) {
      res.writeHead(401, { 'Content-Type': 'text/plain' })
      res.end('unauthorized')
      return
    }
    if (!body || body.jsonrpc !== '2.0') {
      send(res, 400, error(null, -32700, 'Parse error'))
      return
    }

    const { id, method, params } = body
    const isNotification = id === undefined

    if (options.mode === 'modern') {
      const version = req.headers['mcp-protocol-version']
      if (
        version !== MODERN ||
        params?._meta?.['io.modelcontextprotocol/protocolVersion'] !== MODERN
      ) {
        send(
          res,
          400,
          error(id, -32022, 'Unsupported protocol version', {
            supported: [MODERN],
            requested: version,
          })
        )
        return
      }
      if (req.headers['mcp-method'] !== method) {
        send(res, 400, error(id, -32020, 'Header mismatch: Mcp-Method'))
        return
      }
      if (method === 'tools/call' && req.headers['mcp-name'] !== params?.name) {
        send(res, 400, error(id, -32020, 'Header mismatch: Mcp-Name'))
        return
      }
      if (method === 'server/discover') {
        send(res, 200, {
          jsonrpc: '2.0',
          id,
          result: {
            supportedVersions: [MODERN],
            capabilities: { tools: {} },
            serverInfo: { name: 'test-modern', version: '1.0.0' },
          },
        })
        return
      }
    } else {
      if (method === 'initialize') {
        const session = `s${nextSession++}`
        sessions.add(session)
        send(
          res,
          200,
          {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'test-legacy', version: '1.0.0' },
            },
          },
          { 'Mcp-Session-Id': session }
        )
        return
      }
      const session = req.headers['mcp-session-id'] as string | undefined
      if (!session) {
        // What the official SDK answers to anything before `initialize`.
        send(res, 400, error(id, -32000, 'Bad Request: No valid session ID provided'))
        return
      }
      if (!sessions.has(session)) {
        send(res, 404, error(id, -32001, 'Session not found'))
        return
      }
      if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
        res.writeHead(202)
        res.end()
        return
      }
    }

    if (isNotification) {
      res.writeHead(202)
      res.end()
      return
    }

    if (method === 'tools/list') {
      const size = options.pageSize ?? TEST_TOOLS.length
      const start = params?.cursor ? Number(params.cursor) : 0
      const page = TEST_TOOLS.slice(start, start + size)
      const next = start + size < TEST_TOOLS.length ? String(start + size) : undefined
      send(res, 200, {
        jsonrpc: '2.0',
        id,
        result: { tools: page, ...(next ? { nextCursor: next } : {}) },
      })
      return
    }

    if (method === 'tools/call') {
      const result = await callTool(params?.name, params?.arguments ?? {}, req.headers)
      if (!result) {
        send(res, 200, error(id, -32602, `Unknown tool: ${params?.name}`))
        return
      }
      if (!res.writableEnded && !res.destroyed) send(res, 200, { jsonrpc: '2.0', id, result })
      return
    }

    send(res, options.mode === 'modern' ? 404 : 200, error(id, -32601, 'Method not found'))
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    requests,
    dropSessions: () => sessions.clear(),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

/**
 * A request as Obsidian's `requestUrl` makes it, done with `node:http`: no CORS, the whole body
 * at once. For tests that mock `requestUrl` onto the test server — happy-dom's own `fetch`
 * would hold them to the browser's rules.
 */
export function nodeRequestUrl(params: {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}): Promise<{ status: number; headers: Record<string, string>; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      params.url,
      { method: params.method ?? 'GET', headers: params.headers },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (text += chunk))
        res.on('end', () => {
          const headers: Record<string, string> = {}
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') headers[key] = value
          }
          resolve({ status: res.statusCode ?? 0, headers, text })
        })
      }
    )
    req.on('error', reject)
    if (params.body) req.write(params.body)
    req.end()
  })
}
