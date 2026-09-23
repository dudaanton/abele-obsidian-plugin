/**
 * Agent memory in the running app: the chat's own `remember` reaches its own agent, the prompt
 * that chat sends carries it, and another agent's prompt does not.
 *
 * No model is asked — the tool is taken from the live session exactly as a turn would get it
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
  otherPromptHasItem: boolean
  tooLong: string
  restored: boolean
}

const MARK = 'e2e memory probe item'

const script = `(async () => {
  const t = window.__abeleTest
  const registry = t.AgentRegistry.getInstance()
  const service = t.ChatService.getInstance()
  service.ensureInitialized()
  const session = service.activeSession.value
  if (!session) return JSON.stringify({ error: 'no active chat session' })

  const chatAgent = session.agent.value
  const other = registry.list({ includeUtility: true }).find((a) => a.id !== chatAgent.id)
  const before = new Map(registry.list({ includeUtility: true }).map((a) => [a.id, JSON.stringify(a.memory || [])]))

  const report = { chatAgent: chatAgent.name, otherAgent: other ? other.name : '' }
  try {
    const tool = session.getTools().find((x) => x.name === 'remember')
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
    report.promptHasItem = (await t.resolvedSystemPrompt()).includes('${MARK}')
    report.otherPromptHasItem = other ? (await registry.buildSystemPrompt(other)).includes('${MARK}') : false
  } finally {
    for (const agent of registry.list({ includeUtility: true })) {
      const was = before.get(agent.id)
      if (was !== undefined) agent.memory = JSON.parse(was)
    }
    await t.AbeleConfig.getInstance().saveSettings()
    report.restored = registry.list({ includeUtility: true }).every(
      (a) => JSON.stringify(a.memory || []) === before.get(a.id)
    )
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
    expect(report.otherPromptHasItem).toBe(false)
  })

  it('refuses a long item', () => {
    expect(report.tooLong).toMatch(/shorten/i)
  })

  it('leaves every agent memory as it found it', () => {
    expect(report.restored).toBe(true)
  })
})
