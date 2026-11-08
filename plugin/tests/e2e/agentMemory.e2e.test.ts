/**
 * Agent memory in the running app: the chat's own `remember` reaches its own agent, the prompt
 * that chat sends carries it, and another agent's prompt does not. Then the same item is
 * changed through `remember`'s `replace` and dropped with `forget`, and the prompt follows.
 *
 * No model is asked — a fake provider captures the request, and the tool is taken from the live session exactly as a turn would get it
 * and called directly, so this runs without a key. What it proves that the unit tests cannot is
 * the wiring in the bundle: the session binding, the registry the settings screen reads, and
 * the save. Every item it adds is removed again, and the agents' memory is put back as found.
 *
 * Requires Obsidian running with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw } from './helpers/obsidianCli'

interface Report {
  error?: string
  chatAgent: string
  otherAgent: string
  offered: boolean
  toolResult: string
  chatMemory: string[]
  otherMemory: string[]
  promptHasItem: boolean
  requestHasSnapshot: boolean
  basePromptHasItem: boolean
  otherPromptHasItem: boolean
  tooLong: string
  forgetOffered: boolean
  changedResult: string
  afterChange: string[]
  promptHasChanged: boolean
  forgetResult: string
  afterForget: string[]
  promptAfterForget: boolean
  restored: boolean
}

const MARK = 'e2e memory probe item'
const CHANGED = 'e2e memory probe changed'

const script = `(async () => {
  const t = window.__abeleTest
  const registry = t.AgentRegistry.getInstance()
  const service = t.ChatService.getInstance()
  service.ensureInitialized()
  // Use a disposable session so the provider probe never changes an existing conversation.
  const priorTab = service.activeTabId.value
  const ownTab = await service.newTab()
  if (!ownTab) throw Error('No disposable chat available')
  const session = service.activeSession.value
  if (!session) return JSON.stringify({ error: 'no active chat session' })

  const chatAgent = session.agent.value
  const other = registry.list({ includeUtility: true }).find((a) => a.id !== chatAgent.id)
  const before = new Map(registry.list({ includeUtility: true }).map((a) => [a.id, JSON.stringify(a.memory || [])]))

  const realFetch = window.fetch
  const requests = []
  const FAKE = 'https://sample-memory-provider.invalid/v1'
  window.fetch = async (url, init) => {
    if (typeof url !== 'string' || !url.startsWith(FAKE)) return realFetch(url, init)
    requests.push(JSON.parse(init.body).messages)
    const chunk = { choices: [{ delta: { content: 'Remembered.' }, finish_reason: 'stop' }] }
    return new Response('data: ' + JSON.stringify(chunk) + '\\n\\ndata: [DONE]\\n\\n', { headers: { 'Content-Type': 'text/event-stream' } })
  }
  session.resolveModel = () => ({ id: 'fake', name: 'Fake', baseUrl: FAKE, apiKey: 'none', contextWindow: 100000, maxTokens: 100, supportsReasoning: false })
  for (const key of ['generateTitle', 'generateSummary', 'generateRecap', 'autoCompactIfNeeded']) session.summarizer[key] = async () => undefined
  const report = { chatAgent: chatAgent.name, otherAgent: other ? other.name : '' }
  try {
    // By section, memory is offered as its section until the agent opens it; the tools
    // themselves are taken bound to this chat's agent, so the chat's branch is not changed.
    const offered = (name) => session.getTools().some((x) =>
      x.name === name || (x.name === 'open_memory' && x.description.includes(name)))
    const bound = t.createAgentTools({ session, agentId: chatAgent.id })
    const tool = offered('remember') ? bound.find((x) => x.name === 'remember') : undefined
    report.offered = !!tool
    if (tool) {
      const result = await tool.execute('e2e', { text: '${MARK}' })
      report.toolResult = result.content[0].text
      try {
        await tool.execute('e2e', { text: 'x'.repeat(260) })
        report.tooLong = 'accepted'
      } catch (err) {
        report.tooLong = String(err && err.message || err)
      }
    }
    report.chatMemory = (registry.get(chatAgent.id).memory || []).map((m) => m.text)
    report.otherMemory = other ? (registry.get(other.id).memory || []).map((m) => m.text) : []
    report.promptHasItem = (await service.getTurnContext(session)).includes('${MARK}')
    report.otherPromptHasItem = other ? registry.memoryPrompt(other).includes('${MARK}') : false

    report.basePromptHasItem = (await service.getSystemPrompt(session)).includes('${MARK}')
    await session.sendMessage('Check the sample memory')
    if (session.error.value) throw Error(session.error.value)
    const messages = requests[0] || []
    const user = messages.findIndex(message => message.role === 'user' && message.content === 'Check the sample memory')
    const snapshot = messages.findIndex(message => message.role === 'system' && typeof message.content === 'string' && message.content.startsWith('Current context snapshot') && message.content.includes('${MARK}'))
    report.requestHasSnapshot = user >= 0 && snapshot > user

    const forget = offered('forget') ? bound.find((x) => x.name === 'forget') : undefined
    report.forgetOffered = !!forget
    if (tool && forget) {
      const changed = await tool.execute('e2e', { text: '${CHANGED}', replace: 'probe item' })
      report.changedResult = changed.content[0].text
      report.afterChange = (registry.get(chatAgent.id).memory || []).map((m) => m.text)
      const prompt = await service.getTurnContext(session)
      report.promptHasChanged = prompt.includes('${CHANGED}') && !prompt.includes('${MARK}')
      const gone = await forget.execute('e2e', { text: '${CHANGED}' })
      report.forgetResult = gone.content[0].text
      report.afterForget = (registry.get(chatAgent.id).memory || []).map((m) => m.text)
      report.promptAfterForget = (await service.getTurnContext(session)).includes('${CHANGED}')
    }
  } finally {
    window.fetch = realFetch
    for (const agent of registry.list({ includeUtility: true })) {
      const was = before.get(agent.id)
      if (was !== undefined) agent.memory = JSON.parse(was)
    }
    await t.AbeleConfig.getInstance().saveSettings()
    report.restored = registry.list({ includeUtility: true }).every(
      (a) => JSON.stringify(a.memory || []) === before.get(a.id)
    )
    if (ownTab) await service.deleteChat(ownTab)
    if (priorTab) service.activeTabId.value = priorTab
  }
  return JSON.stringify(report)
})()`

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('agent memory in the running app', () => {
  let report: Report

  beforeAll(() => {
    report = JSON.parse(evalRaw(script, 60_000)) as Report
  }, 90_000)

  it('reached a chat', () => {
    expect(report.error).toBeUndefined()
  })

  it('offers remember to the chat by default', () => {
    expect(report.offered).toBe(true)
  })

  it('stores the item on the chat agent, and only there', () => {
    expect(report.toolResult).toContain(MARK)
    expect(report.chatMemory).toContain(MARK)
    expect(report.otherMemory).not.toContain(MARK)
  })

  it('puts it in that chat prompt and not in another agent prompt', () => {
    expect(report.promptHasItem).toBe(true)
    expect(report.basePromptHasItem).toBe(false)
    expect(report.requestHasSnapshot).toBe(true)
    expect(report.otherPromptHasItem).toBe(false)
  })

  it('refuses a long item', () => {
    expect(report.tooLong).toMatch(/shorten/i)
  })

  it('offers forget to the chat by default', () => {
    expect(report.forgetOffered).toBe(true)
  })

  it('changes the item in place, and the prompt shows the new line only', () => {
    expect(report.changedResult).toContain(CHANGED)
    expect(report.afterChange).toContain(CHANGED)
    expect(report.afterChange).not.toContain(MARK)
    expect(report.promptHasChanged).toBe(true)
  })

  it('forgets the item, and the prompt no longer carries it', () => {
    expect(report.forgetResult).toContain(CHANGED)
    expect(report.afterForget).not.toContain(CHANGED)
    expect(report.promptAfterForget).toBe(false)
  })

  it('leaves every agent memory as it found it', () => {
    expect(report.restored).toBe(true)
  })
})
