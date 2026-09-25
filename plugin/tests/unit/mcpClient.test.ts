// @vitest-environment node
/**
 * The MCP client against a real server on a local port, in both shapes Streamable HTTP takes.
 *
 * The client's request function is what Obsidian's `requestUrl` would be; here it is `node:http`,
 * which has no CORS to get in the way either. Everything else — the probe, the fallback,
 * the session, the headers — is the code that runs in the plugin.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { McpClient, McpError, type McpRequest } from '@/ai/mcp/McpClient'
import { startMcpTestServer, nodeRequestUrl, type McpTestServer } from '../helpers/mcpTestServer'

const nodeRequest: McpRequest = (request) => nodeRequestUrl(request)

let server: McpTestServer | null = null

afterEach(async () => {
  await server?.close()
  server = null
})

const clientFor = (s: McpTestServer, headers: Record<string, string> = {}) =>
  new McpClient({ url: s.url, headers, request: nodeRequest })

const methods = (s: McpTestServer) => s.requests.map((r) => r.body?.method)

describe('a modern server (2026-07-28)', () => {
  it('lists tools without a handshake, the version on every request', async () => {
    server = await startMcpTestServer({ mode: 'modern' })
    const client = clientFor(server)

    const tools = await client.listTools()

    expect(tools.map((t) => t.name)).toContain('echo')
    expect(client.era).toBe('modern')
    expect(methods(server)).not.toContain('initialize')
    for (const request of server.requests) {
      expect(request.headers['mcp-protocol-version']).toBe('2026-07-28')
      expect(request.headers['mcp-method']).toBe(request.body.method)
      expect(request.headers.accept).toContain('application/json')
      expect(request.headers.accept).toContain('text/event-stream')
      expect(request.body.params._meta['io.modelcontextprotocol/protocolVersion']).toBe(
        '2026-07-28'
      )
    }
  })

  it('leaves out a tool whose header annotation is invalid, keeping the rest', async () => {
    server = await startMcpTestServer({ mode: 'modern' })

    const tools = await clientFor(server).listTools()

    expect(tools.map((t) => t.name)).not.toContain('bad-header')
    expect(tools.map((t) => t.name)).toContain('regional')
  })

  it('calls a tool, naming it in a header', async () => {
    server = await startMcpTestServer({ mode: 'modern' })

    const result = await clientFor(server).callTool('echo', { text: 'hi' })

    expect(result.content).toEqual([{ type: 'text', text: 'echo: hi' }])
    const call = server.requests.find((r) => r.body?.method === 'tools/call')!
    expect(call.headers['mcp-name']).toBe('echo')
  })

  it('mirrors a parameter the tool marks with x-mcp-header, encoding what is not plain ASCII', async () => {
    server = await startMcpTestServer({ mode: 'modern' })
    const client = clientFor(server)
    await client.listTools()

    const plain = await client.callTool('regional', { region: 'us-west1' })
    const wide = await client.callTool('regional', { region: 'Мир' })

    expect(plain.content[0]).toEqual({ type: 'text', text: 'region header: us-west1' })
    const encoded = `=?base64?${Buffer.from('Мир').toString('base64')}?=`
    expect(wide.content[0]).toEqual({ type: 'text', text: `region header: ${encoded}` })
  })
})

describe('a legacy server (initialize and a session)', () => {
  it('falls back to initialize when the modern probe is refused, then keeps the session', async () => {
    server = await startMcpTestServer({ mode: 'legacy' })
    const client = clientFor(server)

    await client.listTools()
    await client.callTool('echo', { text: 'again' })

    expect(client.era).toBe('legacy')
    expect(methods(server)).toEqual([
      'server/discover',
      'initialize',
      'notifications/initialized',
      'tools/list',
      'tools/call',
    ])
    const after = server.requests.slice(2)
    for (const request of after) {
      expect(request.headers['mcp-session-id']).toBe('s1')
      expect(request.headers['mcp-protocol-version']).toBe('2025-06-18')
    }
  })

  it('reads answers sent as an event stream, past the notifications before them', async () => {
    server = await startMcpTestServer({ mode: 'legacy', sse: true })

    const result = await clientFor(server).callTool('add', { a: 2, b: 3 })

    expect(result.content).toEqual([{ type: 'text', text: '5' }])
  })

  it('starts a new session once when the server has forgotten the old one', async () => {
    server = await startMcpTestServer({ mode: 'legacy' })
    const client = clientFor(server)
    await client.listTools()
    server.dropSessions()

    const result = await client.callTool('echo', { text: 'still here' })

    expect(result.content[0]).toEqual({ type: 'text', text: 'echo: still here' })
    expect(methods(server).filter((m) => m === 'initialize')).toHaveLength(2)
  })

  it('tells the server a call was stopped', async () => {
    server = await startMcpTestServer({ mode: 'legacy' })
    const client = clientFor(server)
    await client.listTools()
    const controller = new AbortController()

    const call = client.callTool('slow', { ms: 1500 }, controller.signal)
    setTimeout(() => controller.abort(), 50)

    await expect(call).rejects.toThrow(/stopped/i)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const cancelled = server.requests.find((r) => r.body?.method === 'notifications/cancelled')
    expect(cancelled?.body.params.requestId).toBeDefined()
  })
})

describe('either kind', () => {
  it('follows the cursor until every tool is listed', async () => {
    server = await startMcpTestServer({ mode: 'modern', pageSize: 2 })

    const tools = await clientFor(server).listTools()

    expect(tools.map((t) => t.name)).toEqual([
      'echo',
      'add',
      'picture',
      'broken',
      'slow',
      'regional',
    ])
  })

  it('sends the headers it was configured with', async () => {
    server = await startMcpTestServer({ mode: 'modern', token: 'sekret' })

    const tools = await clientFor(server, { Authorization: 'Bearer sekret' }).listTools()

    expect(tools.length).toBeGreaterThan(0)
  })

  it('says what the server answered when it refuses', async () => {
    server = await startMcpTestServer({ mode: 'modern', token: 'sekret' })

    const error = await clientFor(server)
      .listTools()
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(McpError)
    expect((error as McpError).status).toBe(401)
    expect((error as Error).message).toMatch(/401/)
  })

  it('passes a JSON-RPC error on as the message', async () => {
    server = await startMcpTestServer({ mode: 'modern' })

    await expect(clientFor(server).callTool('nope', {})).rejects.toThrow(/Unknown tool: nope/)
  })

  it('returns a tool that failed as a result marked so', async () => {
    server = await startMcpTestServer({ mode: 'legacy', sse: true })

    const result = await clientFor(server).callTool('broken', {})

    expect(result.isError).toBe(true)
    expect(result.content[0]).toEqual({ type: 'text', text: 'it broke' })
  })

  it('says plainly that a URL answers with no MCP at all', async () => {
    const error = await new McpClient({
      url: 'http://127.0.0.1:1/mcp',
      headers: {},
      request: nodeRequest,
    })
      .listTools()
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
  })
})
