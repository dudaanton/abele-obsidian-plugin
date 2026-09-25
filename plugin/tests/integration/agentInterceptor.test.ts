/**
 * An agent's own reviewer: the interceptor a chat gets from its agent unless it chose one.
 *
 * The rules asserted here are the whole feature. A chat follows its agent's reviewer; a choice
 * made in the chat — another reviewer, or Off — is its own and outlives both an edit to the
 * agent and a switch to another agent; a chat saved with a reviewer before agents had one keeps
 * it. Delegated runs never review, and a reviewer's own reviewer is never consulted.
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
import type { Message, ModelConfig } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

const streamed: Array<{ system: string; messages: Message[] }> = []

vi.mock('@/ai/client/OpenAIClient', () => {
  class OpenAIClient {
    async *stream(_model: ModelConfig, system: string, messages: Message[]) {
      streamed.push({ system, messages })
      yield { type: 'text_delta' as const, delta: 'Looks fine.' }
    }
  }
  return { OpenAIClient }
})

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [{ id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false }],
}

let savedMetadata: ChatMetadata | null = null
let storedChat: { metadata: ChatMetadata | null; messages: ChatMessage[] } = {
  metadata: null,
  messages: [],
}
const FAKE_FILE = { path: 'AI/Chats/test.abchat', basename: 'test' } as TFile

const registry = () => AgentRegistry.getInstance()

function agent(name: string, overrides = {}) {
  return registry().create({ name, providerId: 'p1', modelId: 'big', ...overrides })
}

/** A main agent reviewed by `Reviewer`, and a second main agent with no reviewer. */
function seed() {
  const reviewer = agent('Reviewer', {
    utility: true,
    prompts: [{ type: 'text', value: 'Review it.' }],
  })
  const writer = agent('Writer', { interceptorAgentId: reviewer.id, interceptorContextDepth: 4 })
  const plain = agent('Plain')
  registry().setDefault(writer.id)
  return { reviewer, writer, plain }
}

const chat = () => new ChatSession(ChatService.getInstance())

async function saveWithOneMessage(session: ChatSession): Promise<void> {
  ;(session as unknown as { allChatMessages: ChatMessage[] }).allChatMessages = [
    { id: 'm1', role: 'user', content: 'hello', timestamp: 1 },
  ]
  await session.save()
}

destroyChatsAfterEach()

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  streamed.length = 0
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

describe('a new chat', () => {
  it("gets its agent's reviewer and context", () => {
    const { reviewer } = seed()
    const session = chat()

    expect(session.interceptor.agentId.value).toBe(reviewer.id)
    expect(session.interceptor.contextDepth.value).toBe(4)
    expect(session.interceptor.followsAgent).toBe(true)
    expect(session.interceptor.isActive).toBe(true)
  })

  it('follows an edit to the agent while it has chosen nothing', () => {
    const { writer } = seed()
    const session = chat()

    registry().update(writer.id, { interceptorAgentId: '' })

    expect(session.interceptor.isActive).toBe(false)
  })

  it('turns the draft over to the reviewer instead of the main agent', async () => {
    seed()
    const session = chat()

    await session.sendMessage('Please do it')

    const draft = session.messages.value.find((m) => m.draft)
    expect(draft?.interceptorName).toBe('Reviewer')
    expect(streamed).toHaveLength(1)
    expect(streamed[0].system).toBe('Review it.')
  })
})

describe('the chat overriding it', () => {
  it('can pick another reviewer', () => {
    const { plain } = seed()
    const session = chat()

    session.interceptor.agentId.value = plain.id

    expect(session.interceptor.agentId.value).toBe(plain.id)
    expect(session.interceptor.followsAgent).toBe(false)
    // The context chosen so far carries over rather than resetting.
    expect(session.interceptor.contextDepth.value).toBe(4)
  })

  it('can turn review off, and Off stays off when the agent changes its reviewer', () => {
    const { writer, plain } = seed()
    const session = chat()

    session.interceptor.agentId.value = ''
    registry().update(writer.id, { interceptorAgentId: plain.id })

    expect(session.interceptor.isActive).toBe(false)
  })

  it('goes back to the agent when asked', () => {
    const { reviewer } = seed()
    const session = chat()
    session.interceptor.agentId.value = ''

    session.interceptor.followAgent()

    expect(session.interceptor.agentId.value).toBe(reviewer.id)
  })
})

describe('switching the main agent', () => {
  it("takes the new agent's reviewer when the chat chose none", () => {
    const { plain } = seed()
    const session = chat()

    session.switchAgent(plain.id)

    expect(session.interceptor.isActive).toBe(false)
  })

  it("keeps the chat's own choice", () => {
    const { plain, reviewer } = seed()
    const session = chat()
    session.interceptor.agentId.value = reviewer.id

    session.switchAgent(plain.id)

    expect(session.interceptor.agentId.value).toBe(reviewer.id)
    expect(session.interceptor.isActive).toBe(true)
  })
})

describe('saving and reopening', () => {
  it('writes nothing for a chat that follows its agent', async () => {
    seed()
    await saveWithOneMessage(chat())

    expect(savedMetadata?.interceptorAgentId).toBeUndefined()
    expect(savedMetadata?.interceptorContextDepth).toBeUndefined()
  })

  it('writes an explicit Off, and reads it back as Off', async () => {
    const { writer } = seed()
    const session = chat()
    session.interceptor.agentId.value = ''
    await saveWithOneMessage(session)

    expect(savedMetadata?.interceptorAgentId).toBe('')

    storedChat = {
      metadata: { ...savedMetadata!, agentId: writer.id },
      messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: 1 }],
    }
    const reopened = chat()
    await reopened.load(FAKE_FILE)

    expect(reopened.interceptor.isActive).toBe(false)
    expect(reopened.interceptor.followsAgent).toBe(false)
  })

  it('keeps a reviewer an older chat saved, as its own choice', async () => {
    const { writer, plain } = seed()
    storedChat = {
      metadata: {
        type: 'abele-chat',
        agentId: writer.id,
        interceptorAgentId: plain.id,
        interceptorContextDepth: -1,
      },
      messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: 1 }],
    }

    const session = chat()
    await session.load(FAKE_FILE)

    expect(session.interceptor.agentId.value).toBe(plain.id)
    expect(session.interceptor.contextDepth.value).toBe(-1)
    expect(session.interceptor.followsAgent).toBe(false)
  })

  it("lets an older chat that saved none follow its agent's reviewer", async () => {
    const { writer, reviewer } = seed()
    storedChat = {
      metadata: { type: 'abele-chat', agentId: writer.id },
      messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: 1 }],
    }

    const session = chat()
    await session.load(FAKE_FILE)

    expect(session.interceptor.agentId.value).toBe(reviewer.id)
    expect(session.interceptor.followsAgent).toBe(true)
  })
})

describe('where the reviewer never applies', () => {
  it('is never used by a delegated run', () => {
    const { writer } = seed()
    const run = new ChatSession(ChatService.getInstance(), undefined, {
      kind: 'run',
      agentId: writer.id,
    })

    expect(run.interceptor.isActive).toBe(false)
  })

  it('never reviews itself', () => {
    const { writer } = seed()
    // Bypassing the normalisation that would have cleared it, as a hand-edited file could.
    ;(writer as { interceptorAgentId: string }).interceptorAgentId = writer.id

    expect(chat().interceptor.isActive).toBe(false)
  })

  /** Interceptors never chain: the reviewer's own reviewer is not asked about the draft. */
  it("does not run the reviewer's own reviewer", async () => {
    const { reviewer } = seed()
    const second = agent('Second', { prompts: [{ type: 'text', value: 'Second opinion.' }] })
    registry().update(reviewer.id, { interceptorAgentId: second.id })
    const session = chat()

    await session.sendMessage('Please do it')

    expect(streamed.map((call) => call.system)).toEqual(['Review it.'])
  })

  it('forgets a reviewer that is deleted', () => {
    const { writer, reviewer } = seed()

    registry().remove(reviewer.id)

    expect(registry().get(writer.id)?.interceptorAgentId).toBe('')
  })
})
