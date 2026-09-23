/**
 * Going back to a chat puts the reader where they left it.
 *
 * All the tabs share one scroll container, and switching tabs used to send every chat to its
 * end — so someone reading back through one conversation lost their place the moment they
 * looked at another. The place is remembered as a message and its distance from the top, not
 * as a pixel offset: the messages mount again on the way back and render their markdown late,
 * so a pixel offset would land on whatever happened to be there before they had grown.
 *
 * A reader who was at the end is taken to the end, and that includes the replies that arrived
 * while they were elsewhere: at the end of a chat is where a messenger leaves you too.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, ref, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { DEFAULT_TAIL_PAGE_SIZE } from '@/composables/useTailPagedList'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'

const HEIGHT = 100
const BOX = 800

function conversation(prefix: string, count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i + 1}`,
    timestamp: i + 1,
  })) as ChatMessage[]
}

const chats = {
  a: ref<ChatMessage[]>([]),
  b: ref<ChatMessage[]>([]),
}

let wrapper: ReturnType<typeof mount> | null = null

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  chats.a.value = conversation('a', DEFAULT_TAIL_PAGE_SIZE * 3)
  chats.b.value = conversation('b', 20)
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  const sessions = {
    a: fakeChatSession({ messages: chats.a, kind: 'chat', overrides: { id: 'a' } }),
    b: fakeChatSession({ messages: chats.b, kind: 'chat', overrides: { id: 'b' } }),
  }
  const active = computed(() => sessions[service.activeTabId.value as 'a' | 'b'] ?? null)
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue(active as never)
  service.tabOrder.value = ['a', 'b']
  service.activeTabId.value = 'a'
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.replaceChildren()
  const service = ChatService.getInstance()
  service.tabOrder.value = []
  service.activeTabId.value = null
  vi.restoreAllMocks()
})

/**
 * happy-dom lays nothing out, so the layout is modelled: every message is 100px, the box is
 * 800px, and an element's rectangle follows from what is above it and where the box is
 * scrolled. Heights are handed out as messages appear, a little late, the way markdown makes
 * them grow.
 */
function layoutModel(container: HTMLElement) {
  let scrollTop = 0
  const messagesIn = () => [...container.querySelectorAll<HTMLElement>('.abele-chat-msg')]
  const clamp = (v: number) =>
    Math.max(0, Math.min(v, Math.max(0, messagesIn().length * HEIGHT - BOX)))
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = clamp(v)
    },
  })
  Object.defineProperty(container, 'scrollHeight', {
    configurable: true,
    get: () => messagesIn().length * HEIGHT,
  })
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => BOX })
  container.getBoundingClientRect = () => ({ top: 0, bottom: BOX, height: BOX }) as DOMRect

  const relayout = () => {
    messagesIn().forEach((el, i) => {
      Object.defineProperty(el, 'getBoundingClientRect', {
        configurable: true,
        value: () =>
          ({
            top: i * HEIGHT - scrollTop,
            bottom: (i + 1) * HEIGHT - scrollTop,
            height: HEIGHT,
          }) as DOMRect,
      })
    })
  }
  return {
    relayout,
    scrollTo: (v: number) => {
      scrollTop = clamp(v)
      relayout()
    },
    get scrollTop() {
      return scrollTop
    },
    /** The id of the message at the top of the box, and how far it sits from it. */
    topMessage() {
      relayout()
      const el = messagesIn().find((m) => m.getBoundingClientRect().bottom > 0)
      return el && { id: el.dataset.messageId, offset: el.getBoundingClientRect().top }
    },
  }
}

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await nextTick()
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function open() {
  wrapper = mount(AiChat, { attachTo: document.body })
  const container = wrapper.find('.abele-ai-chat__messages')
  const model = layoutModel(container.element as HTMLElement)
  await settle()
  return { container, model }
}

async function switchTo(id: 'a' | 'b', model: ReturnType<typeof layoutModel>) {
  ChatService.getInstance().activeTabId.value = id
  // The messages of the tab mount now; give them their heights as they arrive.
  for (let i = 0; i < 6; i++) {
    await nextTick()
    model.relayout()
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('coming back to a chat the reader had scrolled up in', () => {
  it('shows the message they were reading, where it was', async () => {
    const { container, model } = await open()
    // 30 messages rendered; the reader is at message a40 with 30px of it above the box.
    model.scrollTo(9 * HEIGHT + 30)
    await container.trigger('scroll')
    const before = model.topMessage()
    expect(before?.id).toBe('a70')

    await switchTo('b', model)
    await switchTo('a', model)

    expect(model.topMessage()).toEqual(before)
  })

  it('reveals the older messages they had scrolled back into', async () => {
    const { container, model } = await open()
    // To the top, which reveals the page above; then settle on something in it.
    model.scrollTo(0)
    await container.trigger('scroll')
    await settle()
    model.scrollTo(5 * HEIGHT)
    await container.trigger('scroll')
    const before = model.topMessage()
    expect(before?.id).toBe('a36')

    await switchTo('b', model)
    await switchTo('a', model)

    expect(model.topMessage()).toEqual(before)
  })

  it('keeps that place even when replies arrived while they were away', async () => {
    const { container, model } = await open()
    model.scrollTo(4 * HEIGHT)
    await container.trigger('scroll')
    const before = model.topMessage()

    await switchTo('b', model)
    chats.a.value = [...chats.a.value, ...conversation('late', 3)]
    await switchTo('a', model)

    expect(before?.id).toBeTruthy()
    expect(model.topMessage()).toEqual(before)
  })
})

describe('coming back to a chat the reader was at the end of', () => {
  it('shows the end, with whatever arrived meanwhile', async () => {
    const { container, model } = await open()
    await switchTo('b', model)
    chats.a.value = [...chats.a.value, ...conversation('late', 3)]
    await switchTo('a', model)

    const el = container.element as HTMLElement
    expect(model.scrollTop).toBe(el.scrollHeight - BOX)
    expect(container.text()).toContain('Message 3')
    expect(
      [...el.querySelectorAll<HTMLElement>('[data-message-id]')].at(-1)?.dataset.messageId
    ).toBe('late3')
  })
})

describe('a chat opened for the first time', () => {
  it('opens at its end', async () => {
    const { container, model } = await open()
    model.scrollTo(3 * HEIGHT)
    await container.trigger('scroll')

    await switchTo('b', model)

    expect(model.scrollTop).toBe(20 * HEIGHT - BOX)
  })
})

describe('a card in a note asking for one of its messages', () => {
  it('brings that message to the top, however far back it is, and flashes it', async () => {
    const { model } = await open()

    ChatService.getInstance().pendingReveal.value = 'a5'
    for (let i = 0; i < 6; i++) {
      await nextTick()
      model.relayout()
      await new Promise((r) => setTimeout(r, 20))
    }

    // The message 16px below the top, with the one before it showing in that gap.
    expect(model.topMessage()).toEqual({ id: 'a4', offset: -84 })
    const el = document.querySelector('[data-message-id="a5"]')
    expect(el?.classList.contains('abele-footnote-flash')).toBe(true)
    expect(ChatService.getInstance().pendingReveal.value).toBeNull()
  })
})
