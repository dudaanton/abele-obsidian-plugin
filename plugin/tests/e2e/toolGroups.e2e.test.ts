import { beforeAll, describe, expect, it } from 'vitest'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

interface Report {
  error?: string
  requests: { name: string; description: string; parameters: unknown }[][]
  result?: string
  early?: string
  opened?: string
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
    // A new agent as the settings make one: sections are its default.
    agent = registry.create({ name: 'Sample discovery',
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
      // First a tool of a closed section, then the section, then the tool again.
      const calls = ['chart_docs', 'open_docs', 'chart_docs']
      const delta = n <= calls.length ? { tool_calls: [{ index: 0, id: 'sample-call-' + n,
        type: 'function', function: { name: calls[n - 1], arguments: '{}' } }] }
        : { content: 'Sample section opened and chart reference read.' }
      const chunks = [{ choices: [{ delta }] },
        { choices: [{ delta: {}, finish_reason: n <= calls.length ? 'tool_calls' : 'stop' }] }]
      const enc = new TextEncoder()
      return new Response(new ReadableStream({ start(controller) {
        for (const chunk of chunks) controller.enqueue(enc.encode('data: ' + JSON.stringify(chunk) + '\\n\\n'))
        controller.enqueue(enc.encode('data: [DONE]\\n\\n'))
        controller.close()
      } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }
    await session.sendMessage('Read the chart reference with the tools in its group.')
    if (session.error.value) throw new Error(session.error.value)
    const results = (name) => session.allMessages.value
      .filter((m) => m.toolName === name).map((m) => m.toolResult || m.content)
    ;[out.early, out.result] = results('chart_docs')
    out.opened = results('open_docs')[0]
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
  'tool sections in a real chat with a fake provider',
  () => {
    let report: Report
    beforeAll(() => {
      report = evalAsync<Report>(script, 60_000)
    }, 90_000)

    it('opens a section, advertises its schemas, and executes a tool from it', () => {
      expect(report.error).toBeUndefined()
      expect(report.requests).toHaveLength(4)
      const names = report.requests.map((request) => request.map((t) => t.name))
      expect(names[0]).toContain('open_docs')
      expect(names[0]).not.toContain('chart_docs')
      expect(report.early).toContain('Call open_docs first')
      expect(names[1]).not.toContain('chart_docs')
      expect(report.opened).toContain('chart_docs')
      expect(report.opened).toContain('template_docs (asks the person first)')
      expect(names[2]).toContain('chart_docs')
      expect(names[2]).toContain('template_docs')
      for (const list of names) expect(list).not.toContain('script_api_docs')
      expect(report.result).toContain('abele-chart Codeblock Reference')
      expect(report.restored).toEqual(names[3])
      expect(report.fresh).not.toContain('chart_docs')
      expect(report.fresh).toContain('open_docs')
    })

    it('preserves the schema prefix on open and the entire list on ordinary turns', () => {
      expect(report.error).toBeUndefined()
      expect(report.requests[2].slice(0, report.requests[0].length)).toEqual(report.requests[0])
      expect(report.requests[1]).toEqual(report.requests[0])
      expect(report.requests[3]).toEqual(report.requests[2])
    })
  }
)
