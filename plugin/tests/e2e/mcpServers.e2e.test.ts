/**
 * MCP servers from inside the running app: the settings' fetch and an agent's call going out
 * through Obsidian's own `requestUrl`, to a server on a local port — both shapes of the
 * protocol, one of them answering as an event stream.
 *
 * What happy-dom cannot say and this can: that Electron's request function reaches the server
 * at all, what `Origin` it arrives with (a local server has to check it and may refuse the app),
 * and that the answer comes back whole. The servers' settings are put into memory only and
 * taken out again; nothing is saved. Requires Obsidian with the development build.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { startLiveMcpServer, type LiveMcpServer } from './helpers/mcpLive'

const available = isObsidianRunning() && hasTestApi()

interface Outcome {
  error?: string
  names?: string[]
  echo?: string
  sum?: string
  picture?: boolean
  failure?: string
}

/** Fetches the server's tools as the settings do, then calls three of them as an agent would. */
const probe = (url: string, name: string) => `(async () => {
  const t = window.__abeleTest
  const config = t.AbeleConfig.getInstance()
  const before = config.ai.mcpServers
  const out = {}
  try {
    const server = { id: 'e2e-' + ${JSON.stringify(name)}, name: ${JSON.stringify(name)},
      url: ${JSON.stringify(url)}, enabled: true, keyId: '', headers: {}, tools: [] }
    t.McpService.getInstance().reset()
    server.tools = await t.McpService.getInstance().fetchTools(server)
    server.fetchedAt = new Date().toISOString()
    config.ai = { ...config.ai, mcpServers: [server] }
    const tools = t.createAgentTools().filter((x) => x.name.startsWith('mcp_'))
    out.names = tools.map((x) => x.name)
    const tool = (n) => tools.find((x) => x.name === 'mcp_${name}_' + n)
    out.echo = (await tool('echo').execute('e1', { text: 'from Obsidian' })).content[0].text
    out.sum = (await tool('add').execute('e2', { a: 20, b: 22 })).content[0].text
    const pic = await tool('picture').execute('e3', {})
    out.picture = !!pic.injectMessages?.[0]?.content?.some?.((p) => p.image_url?.url?.startsWith('data:image/png'))
    try { await tool('broken').execute('e4', {}) } catch (e) { out.failure = e.message }
  } catch (e) {
    out.error = e && e.message ? e.message : String(e)
  } finally {
    config.ai = { ...config.ai, mcpServers: before }
    t.McpService.getInstance().reset()
  }
  return out
})()`

for (const shape of [
  { mode: 'modern' as const, sse: false, name: 'modern' },
  { mode: 'legacy' as const, sse: true, name: 'legacy' },
]) {
  describe.skipIf(!available)(`an MCP server in the app (${shape.name})`, () => {
    let server: LiveMcpServer
    let outcome: Outcome

    beforeAll(async () => {
      server = await startLiveMcpServer(shape.mode, shape.sse)
      outcome = evalAsync<Outcome>(probe(server.url, shape.name), 60_000)
      // The server's log is read only while the worker is free, which it is not during an eval.
      await new Promise((resolve) => setTimeout(resolve, 500))
    }, 90_000)

    afterAll(() => server?.stop())

    it('hands its tools to the agent tool list, under the server name', () => {
      expect(outcome.error).toBeUndefined()
      expect(outcome.names).toEqual(
        expect.arrayContaining([`mcp_${shape.name}_echo`, `mcp_${shape.name}_add`])
      )
    })

    it('calls them and brings back what they answered', () => {
      expect(outcome.echo).toContain('echo: from Obsidian')
      expect(outcome.sum).toContain('42')
      expect(outcome.picture).toBe(true)
      expect(outcome.failure).toContain('it broke')
    })

    it('goes out through the app, and says what Origin a local server sees', () => {
      const requests = server.requests()
      const methods = requests.map((r) => r.method)
      expect(methods).toContain('tools/call')
      if (shape.mode === 'legacy') expect(methods).toContain('initialize')
      const origins = [...new Set(requests.map((r) => r.origin))]
      console.info(
        `\n  ${shape.name}: Origin ${JSON.stringify(origins)}, UA ${requests[0]?.userAgent}\n`
      )
    })
  })
}
