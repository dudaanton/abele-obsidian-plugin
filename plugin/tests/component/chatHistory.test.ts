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
import { ChatSearchIndex } from '@/ai/ChatSearchIndex'
import dayjs from 'dayjs'
import { DISPLAY_DATE_FORMAT } from '@/constants/dates'
import Icon from '@/components/obsidian/Icon.vue'
import { confirmAction } from '@/modal/confirm'

vi.mock('@/modal/confirm', () => ({ confirmAction: vi.fn() }))

vi.mock('@/editor/CommentPlugin', () => ({
  dispatchCommentsChanged: vi.fn(),
  setCommentInfoSource: vi.fn(),
}))

import { useFakeClock } from '../helpers/fakeClock'
const advance = useFakeClock()

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
    global: { stubs: { ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' } } },
  })
  await flushPromises()
  return wrapper
}

const cardOf = (view: VueWrapper, path: string) =>
  view.findAllComponents(Card).find((c) => c.attributes('data-path') === path)!

beforeEach(() => {
  vi.mocked(confirmAction).mockResolvedValue(false)
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
  ChatSearchIndex.destroy()
  vi.restoreAllMocks()
})

describe('a card in the chat history', () => {
  it('asks before deleting a chat and leaves it intact on cancel', async () => {
    const remove = vi.spyOn(ChatStorage.getInstance(), 'deleteChat')
    const card = cardOf(await open(), NEW)
    await card
      .findAllComponents(Icon)
      .find((icon) => icon.props('icon') === 'trash')!
      .vm.$emit('click')
    await flushPromises()
    expect(confirmAction).toHaveBeenCalledOnce()
    expect(remove).not.toHaveBeenCalled()
    expect(app.vault.getFileByPath(NEW)).not.toBeNull()
  })

  it('closes a live tab before deleting its file after confirmation', async () => {
    vi.mocked(confirmAction).mockResolvedValue(true)
    const service = ChatService.getInstance()
    const id = service.createTab()
    const session = service.getSession(id)!
    session.currentChatFile.value = app.vault.getFileByPath(NEW)
    const card = cardOf(await open(), NEW)
    await card
      .findAllComponents(Icon)
      .find((icon) => icon.props('icon') === 'trash')!
      .vm.$emit('click')
    await flushPromises()
    expect(service.getSession(id)).toBeNull()
    expect(app.vault.getFileByPath(NEW)).toBeNull()
    expect(cardOf(wrapper!, NEW)).toBeUndefined()
  })

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

describe('searching the messages of every chat', () => {
  beforeEach(() => app.saveLocalStorage('abele-chat-history-content', true))

  const type = async (view: VueWrapper, words: string) => {
    const field = view.find('.abele-chat-history__search')
    await field.setValue(words)
    // The search waits for typing to pause, then reads the chats.
    await advance(260)
    await flushPromises()
  }

  it('finds a chat by what was said in it, with the words and a few around them', async () => {
    const view = await open()
    await type(view, 'LIGHTEST')

    const cards = view.findAllComponents(Card)
    expect(cards.map((c) => c.attributes('data-path')).sort()).toEqual([NEW, OLD])
    const snippet = cardOf(view, OLD).find('.abele-chat-history__snippet')
    expect(snippet.text()).toBe('The lightest one.')
    expect(snippet.find('.search-result-file-matched-text').text()).toBe('lightest')
    expect(cardOf(view, OLD).props('meta')).toContain('1 match')
  })

  it('does not find what a tool returned', async () => {
    const view = await open()
    await type(view, SECRET)
    expect(view.findAllComponents(Card)).toHaveLength(0)
    expect(view.find('.abele-chat-history__empty').text()).toBe('No matches')
  })

  it('opens a result at the message it was found in, with the words to find there', async () => {
    const view = await open()
    await type(view, 'laptop should')
    await cardOf(view, OLD).trigger('click')

    const [file, found] = view.emitted('select')![0] as [{ path: string }, unknown]
    expect(file.path).toBe(OLD)
    expect(found).toEqual({ query: 'laptop should', messageId: 'u' })
  })

  it('reads each chat once however much is typed, and again once it changes', async () => {
    const view = await open()
    const read = vi.spyOn(app.vault, 'cachedRead')
    await type(view, 'light')
    await type(view, 'lightest')
    expect(read).toHaveBeenCalledTimes(2)

    const changed = app.vault.getFileByPath(NEW)!
    await app.vault.modify(changed, chatFile('New'))
    // The fake vault keeps no clock; Obsidian moves `mtime` with every write.
    changed.stat = { ...changed.stat, mtime: (changed.stat?.mtime ?? 0) + 1000 }
    await type(view, 'lightes')
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('still finds by title alone for a single letter, without reading any chat', async () => {
    const view = await open()
    const read = vi.spyOn(app.vault, 'cachedRead')
    await type(view, 'n')
    expect(read).not.toHaveBeenCalled()
    expect(view.findAllComponents(Card).map((c) => c.attributes('data-path'))).toContain(NEW)
  })
})

describe('optional content search', () => {
  const type = async (view: VueWrapper, words: string) => {
    await view.find('.abele-chat-history__search').setValue(words)
    await advance(260)
    await flushPromises()
  }
  const toggle = (view: VueWrapper) => view.find('[role="switch"]')

  it('defaults to titles and descriptions without preparing the message index', async () => {
    const view = await open()
    const prepare = vi.spyOn(ChatSearchIndex.getInstance(), 'prepare')
    expect(toggle(view).attributes('aria-checked')).toBe('false')
    await type(view, 'lightest')
    expect(view.findAllComponents(Card)).toHaveLength(0)
    expect(prepare).not.toHaveBeenCalled()
    await type(view, 'travel')
    expect(view.findAllComponents(Card).map((c) => c.attributes('data-path'))).toEqual([OLD])
    await type(view, 'summarised')
    expect(view.findAllComponents(Card).map((c) => c.attributes('data-path'))).toEqual([NEW])
    await type(view, 'AI/Chats')
    expect(view.findAllComponents(Card)).toHaveLength(0)
  })

  it('searches the recap when it is the displayed description', async () => {
    await app.vault.modify(
      app.vault.getFileByPath(OLD)!,
      chatFile(LONG_TITLE, { recap: 'Sample packing list' })
    )
    const view = await open()
    await type(view, 'packing')
    expect(view.findAllComponents(Card).map((c) => c.attributes('data-path'))).toEqual([OLD])
  })

  it('searches the current words when enabled, clears hits when disabled, and remembers both choices', async () => {
    const view = await open()
    await type(view, 'lightest')
    await toggle(view).trigger('click')
    await advance(260)
    await flushPromises()
    expect(view.findAllComponents(Card)).toHaveLength(2)
    expect(view.find('.abele-chat-history__snippet').exists()).toBe(true)
    expect(app.loadLocalStorage('abele-chat-history-content')).toBe(true)
    view.unmount()
    wrapper = null
    const reopened = await open()
    expect(toggle(reopened).attributes('aria-checked')).toBe('true')
    await type(reopened, 'lightest')
    await toggle(reopened).trigger('keydown', { key: ' ' })
    expect(reopened.findAllComponents(Card)).toHaveLength(0)
    expect(reopened.find('.abele-chat-history__snippet').exists()).toBe(false)
    expect(app.loadLocalStorage('abele-chat-history-content')).toBe(false)
    reopened.unmount()
    wrapper = null
    expect(toggle(await open()).attributes('aria-checked')).toBe('false')
  })

  it('does not publish an in-flight content search after it is switched off', async () => {
    const view = await open()
    let complete!: () => void
    let stopped!: () => boolean
    vi.spyOn(ChatSearchIndex.getInstance(), 'prepare').mockImplementation(
      async (_app, _files, progress, cancel) => {
        stopped = cancel!
        progress?.({ done: 0, total: 10 })
        await new Promise<void>((resolve) => {
          complete = resolve
        })
      }
    )
    await toggle(view).trigger('click')
    await type(view, 'lightest')
    expect(view.find('.abele-chat-history__status').exists()).toBe(true)
    await toggle(view).trigger('click')
    expect(stopped()).toBe(true)
    complete()
    await flushPromises()
    expect(view.findAllComponents(Card)).toHaveLength(0)
    expect(view.find('.abele-chat-history__status').exists()).toBe(false)
  })
})

describe('the order of the history', () => {
  const HOUR = 3_600_000
  // Three chats: Garden started first but was written in last; Pond started second, written in
  // second; Trip started last, written in once. Days apart, so each lands in a day of its own.
  const DAY = 24 * HOUR
  const T0 = new Date(2026, 0, 10, 9).getTime()
  const chats = {
    'AI/Chats/Garden.abchat': { title: 'Garden', first: T0, last: T0 + 5 * DAY },
    'AI/Chats/Pond.abchat': { title: 'Pond', first: T0 + DAY, last: T0 + 3 * DAY },
    'AI/Chats/Trip.abchat': { title: 'Trip', first: T0 + 2 * DAY, last: T0 + 2 * DAY + HOUR },
  }
  const file = (title: string, first: number, last: number) =>
    serializeChat({
      metadata: { type: 'abele-chat', providerId: 'p', modelId: 'm', created: '2026-01-01', title },
      messages: [
        {
          id: 'u',
          role: 'user',
          content: `About the ${title.toLowerCase()} plan`,
          timestamp: first,
        },
        { id: 'a', parentId: 'u', role: 'assistant', content: 'Noted.', timestamp: last },
      ],
      internalMessages: [],
    })

  beforeEach(() => {
    app = useVault(
      Object.entries(chats).map(([path, c]) => ({ path, raw: file(c.title, c.first, c.last) }))
    )
    // The files' own times say the opposite: Trip touched last (a summary, sync), Garden first.
    const mtimes: Record<string, number> = {
      'AI/Chats/Garden.abchat': 1000,
      'AI/Chats/Pond.abchat': 2000,
      'AI/Chats/Trip.abchat': 9000,
    }
    for (const [path, mtime] of Object.entries(mtimes)) {
      const f = app.vault.getFileByPath(path)!
      f.stat = { ...f.stat, mtime, ctime: mtime }
    }
    ChatStorage.destroy()
    AbeleConfig.getInstance().ai.chatHistory = []
  })

  const titles = (view: VueWrapper) =>
    view.findAllComponents(Card).map((c) => c.props('title') as string)
  const days = (view: VueWrapper) =>
    view.findAll('.abele-chat-history .abele-date-divider').map((d) => d.text())
  const choose = async (view: VueWrapper, order: string) => {
    await view.find('.abele-chat-history__order select').setValue(order)
    await flushPromises()
  }

  it('is by the last message by default, whatever touched the files since', async () => {
    const view = await open()
    expect(titles(view)).toEqual(['Garden', 'Pond', 'Trip'])
  })

  it('can be by when each chat was started', async () => {
    const view = await open()
    await choose(view, 'created')
    expect(titles(view)).toEqual(['Trip', 'Pond', 'Garden'])
  })

  it('puts a day over the chats of that day, by the date the list is ordered by', async () => {
    const day = (d: number) => dayjs(new Date(2026, 0, d)).format(DISPLAY_DATE_FORMAT)
    const view = await open()
    expect(days(view)).toEqual([day(15), day(13), day(12)])
    await choose(view, 'created')
    expect(days(view)).toEqual([day(12), day(11), day(10)])
  })

  it('remembers the order chosen on this device', async () => {
    const view = await open()
    await choose(view, 'created')
    view.unmount()
    wrapper = null
    expect(app.loadLocalStorage('abele-chat-history-order')).toBe('created')
    expect(titles(await open())).toEqual(['Trip', 'Pond', 'Garden'])
  })

  it('keeps the same order for what a search finds', async () => {
    app.saveLocalStorage('abele-chat-history-content', true)
    const view = await open()
    await view.find('.abele-chat-history__search').setValue('plan')
    await advance(260)
    await flushPromises()
    expect(titles(view)).toEqual(['Garden', 'Pond', 'Trip'])
    await choose(view, 'created')
    expect(titles(view)).toEqual(['Trip', 'Pond', 'Garden'])
  })
})
