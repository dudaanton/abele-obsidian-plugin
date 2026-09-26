/**
 * A chat records what its tools change, under the message whose turn it was.
 *
 * The model is faked: its "turn" calls the real `write` and `create` tools the chat hands it,
 * through the same wrapper every tool call of a chat goes through. What is checked is that
 * the changes land in the chat's log under the right user message, and that a rewind from
 * that message puts the vault back.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { Message } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [{ id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false }],
}

const reply = (text: string): Message =>
  ({
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
    timestamp: 1,
  }) as unknown as Message

let app: App
let tracker: ChangeTracker
let session: ChatSession

/** Each turn of the fake model runs these tool calls, then answers. */
function modelCalls(calls: { name: string; args: Record<string, unknown> }[][]) {
  let turn = 0
  vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
    for (const call of calls[turn++] ?? []) {
      const tool = opts.tools.find((t) => t.name === call.name)
      if (!tool) throw new Error(`no tool ${call.name}`)
      await tool.execute(`call-${turn}`, call.args)
    }
    return { messages: [...opts.messages, reply('done')] }
  })
}

const read = (path: string) => app.vault.read(app.vault.getAbstractFileByPath(path) as TFile)

destroyChatsAfterEach()

beforeEach(() => {
  app = useVault([{ path: 'Notes/Plan.md', content: 'first draft' }]) as unknown as App
  tracker = ChangeTracker.install(app)
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    permissionMode: 'allow-all',
  }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Default', providerId: 'p1', modelId: 'big' })
  registry.setDefault(agent.id)

  session = new ChatSession(ChatService.getInstance())
  session.scopeResolver.fullVaultAccess.value = true
  vi.spyOn(session, 'save').mockResolvedValue(undefined)
  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue(undefined)
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue(undefined)
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
  // Titles, summaries and recaps go to the network; none of them is the subject.
  vi.spyOn(session as unknown as { afterTurn: () => Promise<void> }, 'afterTurn').mockResolvedValue(
    undefined
  )
  // The write tool refuses a file the conversation has not read; that guard is not the subject.
  vi.spyOn(
    (session as unknown as { readGuard: { check: () => Promise<null> } }).readGuard,
    'check'
  ).mockResolvedValue(null)
})

afterEach(() => {
  tracker.uninstall()
  vi.restoreAllMocks()
})

describe('a chat’s turns and the files they change', () => {
  it('keeps each change under the message that asked for it', async () => {
    modelCalls([
      [{ name: 'edit', args: { path: 'Notes/Plan.md', old_string: 'first', new_string: 'second' } }],
      [{ name: 'create', args: { path: 'Notes/New.md', content: 'made up' } }],
    ])
    await session.sendMessage('rewrite the plan')
    await session.sendMessage('and add a note')

    const [first, second] = session.messages.value.filter((m) => m.role === 'user')
    const entries = session.rewind.entries.value
    expect(entries.map((e) => [e.turn, e.tool])).toEqual([
      [first.id, 'edit'],
      [second.id, 'create'],
    ])
  })

  it('rewinds from a message: everything since it is put back', async () => {
    modelCalls([
      [{ name: 'edit', args: { path: 'Notes/Plan.md', old_string: 'first', new_string: 'second' } }],
      [{ name: 'create', args: { path: 'Notes/New.md', content: 'made up' } }],
    ])
    await session.sendMessage('rewrite the plan')
    await session.sendMessage('and add a note')

    const [first] = session.messages.value.filter((m) => m.role === 'user')
    const plan = await session.rewind.planSince(first.timestamp)
    expect(plan.items.map((i) => [i.path, i.action])).toEqual([
      ['Notes/New.md', 'remove'],
      ['Notes/Plan.md', 'rewrite'],
    ])
    await session.rewind.apply(plan, {})

    expect(await read('Notes/Plan.md')).toBe('first draft')
    expect(app.vault.getAbstractFileByPath('Notes/New.md')).toBeNull()
  })
})
