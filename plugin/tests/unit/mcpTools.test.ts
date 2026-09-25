/**
 * An MCP server's tools as an agent gets them: named after the server, described by it, off
 * until an agent is given them, and answering through the same request function the plugin
 * uses — here pointed at a real server on a local port.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ToolMode } from '@/ai/types'
import { createAgentTools, getToolRegistry } from '@/ai/tools'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { createAgent } from '@/ai/agents/types'
import { mcpToolName } from '@/ai/mcp/names'
import { McpService } from '@/ai/mcp/McpService'
import { createMcpServer, type McpServer } from '@/ai/mcp/types'
import { startMcpTestServer, nodeRequestUrl, type McpTestServer } from '../helpers/mcpTestServer'
import { useVault } from '../helpers/testEnv'

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }))

vi.mock('obsidian', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../mocks/obsidian')),
  requestUrl,
}))

let server: McpTestServer | null = null

beforeEach(() => {
  requestUrl.mockReset()
  requestUrl.mockImplementation(nodeRequestUrl)
  McpService.getInstance().reset()
})

afterEach(async () => {
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  await server?.close()
  server = null
})

/** A server configured the way the settings screen leaves one: its tools fetched. */
async function connect(overrides: Partial<McpServer> = {}): Promise<McpServer> {
  const configured = createMcpServer({ id: 'srv1', name: 'Test', url: server!.url, ...overrides })
  configured.tools = await McpService.getInstance().fetchTools(configured)
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, mcpServers: [configured] }
  return configured
}

const tool = (name: string) => {
  const found = createAgentTools().find((t) => t.name === name)
  if (!found) throw new Error(`no tool ${name}`)
  return found
}

describe('tool names', () => {
  it('put the server between mcp and the tool, in characters every provider accepts', () => {
    expect(mcpToolName('Test', 'echo')).toBe('mcp_test_echo')
    expect(mcpToolName('My Server!', 'get.weather')).toBe('mcp_my_server_get_weather')
  })

  it('stay under 64 characters and apart when two long ones share a start', () => {
    const long = 'x'.repeat(80)
    const a = mcpToolName('server', `${long}a`)
    const b = mcpToolName('server', `${long}b`)

    expect(a.length).toBeLessThanOrEqual(64)
    expect(a).not.toBe(b)
    expect(mcpToolName('server', `${long}a`)).toBe(a)
  })
})

describe('the tools an agent is offered', () => {
  beforeEach(() => {
    useVault([])
  })

  it('come from the fetched list of every server that is on', async () => {
    server = await startMcpTestServer({ mode: 'modern' })
    await connect()

    const names = createAgentTools().map((t) => t.name)

    expect(names).toContain('mcp_test_echo')
    expect(names).toContain('mcp_test_add')
    const echo = tool('mcp_test_echo')
    expect(echo.description).toContain('Says back the text it is given.')
    expect(echo.description).toContain('Test')
    expect(echo.parameters).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
    })
  })

  it('leave out a server that is switched off', async () => {
    server = await startMcpTestServer({ mode: 'modern' })
    await connect({ enabled: false })

    expect(createAgentTools().some((t) => t.name.startsWith('mcp_'))).toBe(false)
  })

  it('are grouped by server in the settings, under the names the server gives them', async () => {
    server = await startMcpTestServer({ mode: 'modern' })
    await connect()

    const echo = getToolRegistry().find((t) => t.name === 'mcp_test_echo')

    expect(echo).toMatchObject({ label: 'Echo', category: 'MCP · Test' })
  })

  it('reach no agent that was not given them', async () => {
    server = await startMcpTestServer({ mode: 'modern' })
    await connect()
    const registry = AgentRegistry.getInstance()
    const plain = createAgent()
    const given = createAgent({
      toolModes: { mcp_test_echo: 'ask' as ToolMode },
    })

    const offered = (agent: typeof plain) =>
      registry.filterTools(agent, createAgentTools()).map((t) => t.name)

    expect(offered(plain).some((n) => n.startsWith('mcp_'))).toBe(false)
    expect(offered(given)).toContain('mcp_test_echo')
    expect(offered(given)).not.toContain('mcp_test_add')
  })
})

describe('calling one', () => {
  beforeEach(() => {
    useVault([])
  })

  it('answers with what the server said, marked as coming from outside', async () => {
    server = await startMcpTestServer({ mode: 'legacy', sse: true })
    await connect()

    const result = await tool('mcp_test_echo').execute('c1', { text: 'hi' })

    const text = result.content.map((c) => c.text).join('\n')
    expect(text).toContain('echo: hi')
    expect(text).toMatch(/not .*instructions/i)
  })

  it('hands a picture to the model the way reading an image does', async () => {
    server = await startMcpTestServer({ mode: 'modern' })
    await connect()

    const result = await tool('mcp_test_picture').execute('c2', {})

    const injected = result.injectMessages?.[0]
    expect(injected?.role).toBe('user')
    const parts = injected?.content as { type: string; image_url?: { url: string } }[]
    expect(parts.some((p) => p.image_url?.url.startsWith('data:image/png;base64,'))).toBe(true)
  })

  it('fails when the server says the tool failed', async () => {
    server = await startMcpTestServer({ mode: 'modern' })
    await connect()

    await expect(tool('mcp_test_broken').execute('c3', {})).rejects.toThrow(/it broke/)
  })

  it('sends the token from the keychain, and stored keys named in headers', async () => {
    server = await startMcpTestServer({ mode: 'modern', token: 'tok-123' })
    const app = useVault([])
    app.secretStorage.setSecret('abele-mcp-srv1', 'tok-123')
    app.secretStorage.setSecret('abele-secret-extra', 'value-9')
    AbeleConfig.getInstance().ai = {
      ...DEFAULT_AI_SETTINGS,
      secrets: [{ name: 'extra', keyId: 'abele-secret-extra' }],
    }
    const configured = createMcpServer({
      id: 'srv1',
      name: 'Test',
      url: server.url,
      keyId: 'abele-mcp-srv1',
      headers: { 'X-Extra': '${abele_key:extra}' },
    })
    configured.tools = await McpService.getInstance().fetchTools(configured)
    AbeleConfig.getInstance().ai = {
      ...AbeleConfig.getInstance().ai,
      mcpServers: [configured],
    }

    await tool('mcp_test_echo').execute('c4', { text: 'with a key' })

    const last = server.requests[server.requests.length - 1]
    expect(last.headers.authorization).toBe('Bearer tok-123')
    expect(last.headers['x-extra']).toBe('value-9')
  })

  it('stops waiting the moment Stop is pressed', async () => {
    server = await startMcpTestServer({ mode: 'modern' })
    await connect()
    const controller = new AbortController()

    const started = Date.now()
    const call = tool('mcp_test_slow').execute('c5', { ms: 2000 }, controller.signal)
    setTimeout(() => controller.abort(), 30)

    await expect(call).rejects.toThrow(/stopped/i)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
