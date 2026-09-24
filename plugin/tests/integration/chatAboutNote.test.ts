/**
 * A chat opened about a note, followed past the menu: the access it was given has to outlive
 * the tab, and the link it starts with has to lead the agent to that note.
 *
 * The model is faked — only what it is handed matters — and storage is caught at the edge, the
 * way `chatSessionPersistence` does it, so a save can be loaded back into a fresh session.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { chatAboutNote } from '@/commands/chatAboutNote'
import { ChatService } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentLoop } from '@/ai/client/AgentLoop'
import type { Message } from '@/ai/client'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  DEFAULT_AI_SETTINGS,
  type AiProvider,
  type ChatMessage,
  type ChatMetadata,
} from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const NOTE = 'Projects/Budget.md'
const HIDDEN = 'Private/Salary.md'

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [{ id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false }],
}

const FAKE_FILE = { path: 'AI/Chats/about.abchat', basename: 'about' } as TFile

let app: FakeApp
let service: ChatService
let savedMetadata: ChatMetadata | null = null
let savedMessages: ChatMessage[] = []
/** What the model was handed on its last turn. */
let handed: Message[] = []

beforeEach(() => {
  app = useVault([
    { path: NOTE, content: 'Numbers' },
    { path: HIDDEN, content: 'Secret' },
    { path: 'Journal/2026-09-24.md', content: 'A day' },
  ])
  ;(app.fileManager as unknown as Record<string, unknown>).generateMarkdownLink = (f: TFile) =>
    `[[${f.basename}]]`

  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
  }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Default',
    providerId: 'p1',
    modelId: 'big',
    scope: [{ type: 'folder', path: 'Journal' }],
  })
  registry.setDefault(agent.id)
  ;(ChatService as unknown as { instance: ChatService | null }).instance = null
  service = ChatService.getInstance()
  vi.spyOn(service, 'saveTabs').mockImplementation(() => {})
  vi.spyOn(service, 'revealSidebar').mockResolvedValue(undefined)
  vi.spyOn(service, 'getSystemPrompt').mockResolvedValue('')

  savedMetadata = null
  savedMessages = []
  handed = []
  const storage = ChatStorage.getInstance()
  vi.spyOn(storage, 'saveChat').mockImplementation(async (snapshot) => {
    savedMetadata = snapshot.metadata
    savedMessages = snapshot.messages
    return FAKE_FILE
  })
  vi.spyOn(storage, 'loadChat').mockImplementation(async () => ({
    metadata: savedMetadata,
    messages: savedMessages,
  }))

  vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (opts) => {
    handed = [...opts.messages]
    return {
      messages: [
        ...opts.messages,
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' },
      ] as unknown as Message[],
    }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Sends, with the chat's background model work out of the way. */
async function send(session: ChatSession, text: string) {
  const summarizer = (session as unknown as { summarizer: Record<string, () => Promise<void>> })
    .summarizer
  for (const name of ['generateTitle', 'generateSummary', 'autoCompactIfNeeded', 'generateRecap'])
    vi.spyOn(summarizer, name).mockResolvedValue(undefined)
  await session.sendMessage(text)
}

const lastUserText = () => {
  const user = [...handed].reverse().find((m) => m.role === 'user')!
  return typeof user.content === 'string'
    ? user.content
    : (user.content as Array<{ type: string; text?: string }>).map((p) => p.text ?? '').join('')
}

describe('the access a chat about a note was given', () => {
  it('is still there when the chat is opened again', async () => {
    await chatAboutNote(app.vault.getAbstractFileByPath(NOTE) as TFile)
    const session = service.activeSession.value!
    await send(session, '[[Budget]] what is left?')

    expect(savedMetadata?.overrides?.scope).toContainEqual({ type: 'file', path: NOTE })

    const reopened = new ChatSession(service)
    await reopened.load(FAKE_FILE)
    expect(reopened.scopeResolver.isInScope(NOTE)).toBe(true)
    // Exactly that note: the rest of what the agent could not see stays out of reach.
    expect(reopened.scopeResolver.isInScope(HIDDEN)).toBe(false)
  })
})

describe('the link the chat starts with', () => {
  it('reaches the model with the path it resolves to', async () => {
    await chatAboutNote(app.vault.getAbstractFileByPath(NOTE) as TFile)
    const session = service.activeSession.value!

    await send(session, '[[Budget]] what is left?')

    expect(lastUserText()).toContain('[[Budget]] what is left?')
    expect(lastUserText()).toContain(`"Budget" is ${NOTE}`)
  })

  it('is left as typed in what the person sees', async () => {
    await chatAboutNote(app.vault.getAbstractFileByPath(NOTE) as TFile)
    const session = service.activeSession.value!

    await send(session, '[[Budget]] what is left?')

    const bubble = session.allMessages.value.find((m) => m.role === 'user')!
    expect(bubble.content).toBe('[[Budget]] what is left?')
  })

  it('names nothing outside what the chat can reach', async () => {
    await chatAboutNote(app.vault.getAbstractFileByPath(NOTE) as TFile)
    const session = service.activeSession.value!

    await send(session, '[[Budget]] compare with [[Salary]]')

    expect(lastUserText()).toContain(NOTE)
    expect(lastUserText()).not.toContain(HIDDEN)
  })
})
