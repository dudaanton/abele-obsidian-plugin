/**
 * What a chat file remembers about its agent.
 *
 * Two cases matter and pull in opposite directions. A chat saved by this build stores only what
 * it deliberately changed, so it keeps following its agent. A chat saved before agents existed
 * stores a full snapshot of the old global defaults, and that snapshot must be frozen as
 * overrides — it was never a deliberate choice, but making it live would change how an old
 * conversation behaves the moment it is reopened.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  DEFAULT_AI_SETTINGS,
  type AiProvider,
  type ChatMessage,
  type ChatMetadata,
} from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [
    { id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false },
    { id: 'small', name: 'Small', contextWindow: 50, maxTokens: 5, supportsReasoning: false },
  ],
}

/** The last metadata handed to storage, so a test can assert on what would hit disk. */
let savedMetadata: ChatMetadata | null = null
/** What `loadChat` should hand back. */
let storedChat: { metadata: ChatMetadata | null; messages: ChatMessage[] } = {
  metadata: null,
  messages: [],
}

const FAKE_FILE = { path: 'AI/Chats/test.abchat', basename: 'test' } as TFile

function seedAgent(overrides = {}) {
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Default',
    providerId: 'p1',
    modelId: 'big',
    permissionMode: 'allow-edit',
    toolModes: { web_search: 'auto' },
    scope: [{ type: 'folder', path: 'Notes' }],
    ...overrides,
  })
  registry.setDefault(agent.id)
  return agent
}

function newSession(): ChatSession {
  return new ChatSession(ChatService.getInstance())
}

/** Gives the session one message, since `save()` ignores an empty chat. */
async function saveWithOneMessage(session: ChatSession): Promise<void> {
  ;(session as unknown as { allChatMessages: ChatMessage[] }).allChatMessages = [
    { id: 'm1', role: 'user', content: 'hello', timestamp: 1 },
  ]
  await session.save()
}

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  savedMetadata = null
  storedChat = { metadata: null, messages: [] }

  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
  }

  const storage = ChatStorage.getInstance()
  vi.spyOn(storage, 'saveChat').mockImplementation(async (snapshot) => {
    savedMetadata = snapshot.metadata
    return FAKE_FILE
  })
  vi.spyOn(storage, 'loadChat').mockImplementation(async () => storedChat)
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
})

describe('saving', () => {
  it('records which agent the chat runs on', async () => {
    const agent = seedAgent()
    const session = newSession()

    await saveWithOneMessage(session)

    expect(savedMetadata?.agentId).toBe(agent.id)
  })

  it('writes no overrides for a chat that changed nothing', async () => {
    seedAgent()
    const session = newSession()

    await saveWithOneMessage(session)

    expect(savedMetadata?.overrides).toBeUndefined()
  })

  it('writes only the fields the chat actually changed', async () => {
    seedAgent()
    const session = newSession()
    session.permissionMode.value = 'confirm-all'

    await saveWithOneMessage(session)

    expect(savedMetadata?.overrides).toEqual({ permissionMode: 'confirm-all' })
  })
})

describe('loading a chat saved by this build', () => {
  it('restores the agent and its overrides', async () => {
    const agent = seedAgent()
    storedChat = {
      metadata: {
        type: 'abele-chat',
        agentId: agent.id,
        overrides: { modelId: 'small' },
        providerId: 'p1',
        modelId: 'small',
        created: '2026-08-01',
      },
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
    }

    const session = newSession()
    await session.load(FAKE_FILE)

    expect(session.agentId.value).toBe(agent.id)
    expect(session.activeModelId.value).toBe('small')
    expect(session.isOverridden('modelId')).toBe(true)
    // Everything else still follows the agent.
    expect(session.permissionMode.value).toBe('allow-edit')
  })

  it('keeps following the agent for fields it did not override', async () => {
    const agent = seedAgent()
    storedChat = {
      metadata: {
        type: 'abele-chat',
        agentId: agent.id,
        providerId: 'p1',
        modelId: 'big',
        created: '2026-08-01',
      },
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
    }

    const session = newSession()
    await session.load(FAKE_FILE)
    AgentRegistry.getInstance().update(agent.id, { permissionMode: 'allow-all' })

    expect(session.permissionMode.value).toBe('allow-all')
  })

  it('falls back to the default agent when the stored one was deleted', async () => {
    const fallback = seedAgent()
    storedChat = {
      metadata: {
        type: 'abele-chat',
        agentId: 'deleted-agent',
        providerId: 'p1',
        modelId: 'big',
        created: '2026-08-01',
      },
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const session = newSession()
    await session.load(FAKE_FILE)

    expect(session.agentId.value).toBe(fallback.id)
    expect(warn).toHaveBeenCalled()
  })
})

describe('loading a chat saved before agents existed', () => {
  it('freezes the stored snapshot as overrides', async () => {
    const agent = seedAgent()
    storedChat = {
      metadata: {
        type: 'abele-chat',
        providerId: 'p1',
        modelId: 'small',
        permissionMode: 'allow-all',
        toolModes: { fetch: 'ask' },
        scopeEntries: [{ type: 'folder', path: 'Archive' }],
        fullVaultAccess: false,
        created: '2026-04-01',
      },
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
    }

    const session = newSession()
    await session.load(FAKE_FILE)

    expect(session.agentId.value).toBe(agent.id)
    expect(session.activeModelId.value).toBe('small')
    expect(session.permissionMode.value).toBe('allow-all')
    expect(session.toolModes.value).toEqual({ fetch: 'ask' })
    expect(session.scopeResolver.entries.value).toEqual([{ type: 'folder', path: 'Archive' }])

    // Frozen, not tracking: editing the agent must not change how the old chat behaves.
    AgentRegistry.getInstance().update(agent.id, { permissionMode: 'confirm-all' })
    expect(session.permissionMode.value).toBe('allow-all')
  })

  it('survives a round trip, keeping the frozen values', async () => {
    seedAgent()
    storedChat = {
      metadata: {
        type: 'abele-chat',
        providerId: 'p1',
        modelId: 'small',
        permissionMode: 'allow-all',
        created: '2026-04-01',
      },
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
    }

    const session = newSession()
    await session.load(FAKE_FILE)
    await session.save()

    expect(savedMetadata?.overrides).toMatchObject({
      modelId: 'small',
      permissionMode: 'allow-all',
    })
  })

  it('leaves a chat with nothing stored following the agent entirely', async () => {
    const agent = seedAgent()
    storedChat = {
      metadata: null,
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
    }

    const session = newSession()
    await session.load(FAKE_FILE)

    expect(session.overrides.value).toEqual({})
    AgentRegistry.getInstance().update(agent.id, { modelId: 'small' })
    expect(session.activeModelId.value).toBe('small')
  })
})
