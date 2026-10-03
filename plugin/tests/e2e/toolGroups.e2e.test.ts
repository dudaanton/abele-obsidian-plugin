import { beforeAll, describe, expect, it } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

interface Report {
  error?: string
  requests: { name: string; description: string; parameters: unknown }[][]
  result?: string
  restored?: string[]
  fresh?: string[]
}

const script = `(async () => {
  const t = window.__abeleTest
  const chats = t.ChatService.getInstance()
  const registry = t.AgentRegistry.getInstance()
  const config = t.AbeleConfig.getInstance()
  const realFetch = window.fetch
  const oldSave = config.saveSettings
  const previousTab = chats.activeTabId.value
  const sidebarClosed = app.workspace.rightSplit.collapsed
  const FAKE = 'https://sample-tool-provider.invalid/v1'
  const DIR = 'Sample tool discovery'
  const CHAT = DIR + '/sample.abchat'
  const get = (path) => app.vault.getAbstractFileByPath(path)
  const out = { requests: [] }
  let session, agent, created = false
  try {
    config.saveSettings = async () => {}
    agent = registry.create({ name: 'Sample discovery', toolDiscovery: 'by-group',
      toolModes: { chart_docs: 'auto', template_docs: 'ask', script_api_docs: 'off' } })
    if (get(DIR)) throw new Error('sample fixture directory already exists')
    await app.vault.createFolder(DIR)
    created = true
    await chats.openChatFile(await app.vault.create(CHAT, JSON.stringify({
      v: 2, k: 'meta', type: 'abele-chat', agentId: agent.id,
      providerId: '', modelId: '', title: 'Sample discovery', created: '2026-01-01'
    }) + '\\n'))
    await chats.revealSidebar()
    session = chats.getSessionByFile(CHAT)
    session.resolveModel = () => ({ id: 'sample', name: 'Sample', baseUrl: FAKE, apiKey: 'none',
      contextWindow: 100000, maxTokens: 1000, supportsReasoning: false })
    for (const key of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded'])
      session.summarizer[key] = async () => {}
    window.fetch = async (url, init) => {
      if (typeof url !== 'string' || !url.startsWith(FAKE)) return realFetch(url, init)
      const body = JSON.parse(init.body)
      out.requests.push((body.tools || []).map((tool) => tool.function))
      const n = out.requests.length
      const delta = n < 3 ? { tool_calls: [{ index: 0, id: 'sample-call-' + n,
        type: 'function', function: { name: n === 1 ? 'enable_tools' : 'chart_docs',
        arguments: n === 1 ? JSON.stringify({ group: 'Docs' }) : '{}' } }] }
        : { content: 'Sample group revealed and chart reference read.' }
      const chunks = [{ choices: [{ delta }] },
        { choices: [{ delta: {}, finish_reason: n < 3 ? 'tool_calls' : 'stop' }] }]
      const enc = new TextEncoder()
      return new Response(new ReadableStream({ start(controller) {
        for (const chunk of chunks) controller.enqueue(enc.encode('data: ' + JSON.stringify(chunk) + '\\n\\n'))
        controller.enqueue(enc.encode('data: [DONE]\\n\\n'))
        controller.close()
      } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    await session.sendMessage('Read the chart reference with the tools in its group.')
    if (session.error.value) throw new Error(session.error.value)
    out.result = session.allMessages.value.find((m) => m.toolName === 'chart_docs')?.toolResult
    await session.save()
    await chats.closeTab(session.id)
    session = null
    await chats.openChatFile(get(CHAT))
    session = chats.getSessionByFile(CHAT)
    out.restored = session.getTools().map((tool) => tool.name)
    await session.reset()
    session.switchAgent(agent.id)
    out.fresh = session.getTools().map((tool) => tool.name)
  } catch (error) {
    out.error = String(error.stack || error)
  } finally {
    window.fetch = realFetch
    if (session) { session.abort(); await chats.closeTab(session.id) }
    if (created && get(CHAT)) await t.ChatStorage.getInstance().deleteChat(CHAT)
    if (created && get(DIR)) await app.vault.delete(get(DIR), true)
    if (agent) registry.remove(agent.id)
    config.saveSettings = oldSave
    if (previousTab) chats.switchTab(previousTab)
    if (sidebarClosed) app.workspace.rightSplit.collapse()
  }
  return out
})()`

describe.skipIf(!isObsidianRunning() || !hasTestApi())(
  'tool discovery in a real chat with a fake provider',
  () => {
    let report: Report
    beforeAll(() => {
      report = evalAsync<Report>(script, 60_000)
    }, 90_000)

    it('reveals a group, advertises new schemas, and executes a tool from that group', () => {
      expect(report.error).toBeUndefined()
      expect(report.requests).toHaveLength(3)
      const names = report.requests.map((request) => request.map((t) => t.name))
      expect(names[0]).toContain('enable_tools')
      expect(names[0]).not.toContain('chart_docs')
      expect(names[1]).toContain('chart_docs')
      expect(names[1]).toContain('template_docs')
      for (const list of names) expect(list).not.toContain('script_api_docs')
      expect(report.result).toContain('abele-chart Codeblock Reference')
      expect(report.restored).toEqual(names[2])
      expect(report.fresh).not.toContain('chart_docs')
    })

    it('preserves the schema prefix on reveal and the entire list on ordinary turns', () => {
      expect(report.error).toBeUndefined()
      expect(report.requests[1].slice(0, report.requests[0].length)).toEqual(report.requests[0])
      expect(report.requests[2]).toEqual(report.requests[1])
    })
  }
)
