/**
 * The chat history: one card per chat, its whole title, a short summary under it and the date
 * under that. A chat made before summaries existed gets one when its card comes on screen —
 * and only then, one request at a time, so opening the list does not ask the model about every
 * conversation ever had.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import AiChatHistory from '@/components/AiChatHistory.vue'
import Card from '@/components/obsidian/Card.vue'
import { ChatService } from '@/ai/ChatService'
import { ChatStorage } from '@/ai/ChatStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { parseChatMetadata, serializeChat } from '@/ai/ChatLog'
import { DEFAULT_AI_SETTINGS, type ChatMessage, type ChatMetadata } from '@/ai/types'
import type { Message } from '@/ai/client'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))

const prompts: string[] = []
vi.mock('@/ai/client/OpenAIClient', () => {
  class OpenAIClient {
    async *stream(_model: unknown, _system: string, messages: Message[]) {
      prompts.push(JSON.stringify(messages))
      yield { type: 'text_delta' as const, delta: 'Choosing a laptop for travel.' }
    }
  }
  return { OpenAIClient }
})

const LONG_TITLE = 'Comparing three lightweight laptops for a month of travel with a very long name'
const SECRET = 'TOOL-OUTPUT-NEVER-SUMMARISED'
const OLD = 'AI/Chats/Old.abchat'
const NEW = 'AI/Chats/New.abchat'

let app: FakeApp
let wrapper: VueWrapper | null = null

function chatFile(title: string, extra: Partial<ChatMetadata> = {}): string {
  const messages: ChatMessage[] = [
    { id: 'u', role: 'user', content: 'Which laptop should I take?', timestamp: 1 },
    {
      id: 't',
      parentId: 'u',
      role: 'tool-call',
      content: 'Calling read',
      toolName: 'read',
      toolResult: SECRET,
      timestamp: 2,
    },
    { id: 'a', parentId: 't', role: 'assistant', content: 'The lightest one.', timestamp: 3 },
  ]
  return serializeChat({
    metadata: {
      type: 'abele-chat',
      providerId: 'p',
      modelId: 'm',
      created: '2026-09-01',
      title,
      ...extra,
    },
    messages,
    internalMessages: [
      {
        role: 'toolResult',
        toolCallId: 't',
        toolName: 'read',
        content: [{ type: 'text', text: SECRET }],
        isError: false,
        timestamp: 2,
      } as unknown as Message,
    ],
  })
}

async function open(): Promise<VueWrapper> {
  wrapper = mount(AiChatHistory, {
    global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
  })
  await flushPromises()
  return wrapper
}

const cardOf = (view: VueWrapper, path: string) =>
  view.findAllComponents(Card).find((c) => c.attributes('data-path') === path)!

beforeEach(() => {
  prompts.length = 0
  resetFakeIntersectionObservers()
  installFakeIntersectionObserver()
  app = useVault([
    { path: OLD, content: chatFile(LONG_TITLE) },
    { path: NEW, content: chatFile('New', { summary: 'Already summarised.' }) },
  ])
  AgentRegistry.destroy()
  ChatStorage.destroy()
  ChatService.getInstance().destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    enabled: true,
    agents: [],
    defaultAgentId: '',
    chatFolder: 'AI/Chats/{{name}}',
    chatHistory: [
      { path: OLD, title: LONG_TITLE, created: '2026-09-01' },
      { path: NEW, title: 'New', created: '2026-09-02', summary: 'Already summarised.' },
    ],
  }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  vi.spyOn(ChatService.getInstance(), 'getAuxiliaryModelConfig').mockReturnValue({
    id: 'aux',
    name: 'Aux',
    baseUrl: 'http://localhost/v1',
    apiKey: '',
    contextWindow: 1000,
    maxTokens: 100,
    supportsReasoning: false,
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('a card in the chat history', () => {
  it('shows the whole title, the summary and the date', async () => {
    const card = cardOf(await open(), NEW)

    expect(card.props('title')).toBe('New')
    expect(card.props('description')).toBe('Already summarised.')
    expect(card.props('meta')).toHaveLength(1)
    // The title is never cut to fit a line: the kit's card wraps it.
    expect(card.props('clampDescription')).toBe(false)
    expect(cardOf(wrapper!, OLD).props('title')).toBe(LONG_TITLE)
  })

  it('falls back to the recap for a chat with no summary yet', async () => {
    await app.vault.modify(
      app.vault.getFileByPath(OLD)!,
      chatFile(LONG_TITLE, { recap: 'Edited the packing list.' })
    )
    expect(cardOf(await open(), OLD).props('description')).toBe('Edited the packing list.')
  })
})

describe('a chat listed without a summary', () => {
  it('is summarised once its card comes on screen, and not before', async () => {
    const view = await open()
    expect(prompts).toHaveLength(0)

    expect(scrollIntoView(cardOf(view, OLD).element)).toBe(1)
    await flushPromises()

    expect(prompts).toHaveLength(1)
    expect(cardOf(view, OLD).props('description')).toBe('Choosing a laptop for travel.')
    // The file is the source of truth; the index is its copy.
    expect(parseChatMetadata(await app.vault.read(app.vault.getFileByPath(OLD)!))?.summary).toBe(
      'Choosing a laptop for travel.'
    )
    expect(AbeleConfig.getInstance().ai.chatHistory[0].summary).toBe(
      'Choosing a laptop for travel.'
    )
  })

  it('is summarised from what was said, never from what a tool returned', async () => {
    const view = await open()
    scrollIntoView(cardOf(view, OLD).element)
    await flushPromises()

    expect(prompts[0]).toContain('Which laptop should I take?')
    expect(prompts[0]).not.toContain(SECRET)
  })

  it('does not ask for a chat that has one', async () => {
    const view = await open()
    expect(scrollIntoView(cardOf(view, NEW).element)).toBe(0)
  })

  it('asks for nothing while the agent feature is off', async () => {
    AbeleConfig.getInstance().ai.enabled = false
    const view = await open()
    expect(scrollIntoView(cardOf(view, OLD).element)).toBe(0)
  })
})
