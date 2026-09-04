/**
 * How much of a conversation the chat mounts.
 *
 * The window itself is settled in `tests/unit/useTailPagedList.test.ts`. What is asserted here
 * is that the chat actually uses it — that a long conversation puts a bounded number of
 * messages in the DOM, says how many it is holding back, and reveals them when the reader
 * scrolls to the top. Mounting every message is exactly the cost this exists to avoid, so a
 * regression here is invisible to every other test and obvious to anyone opening a long chat.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { DEFAULT_TAIL_PAGE_SIZE } from '@/composables/useTailPagedList'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'

function conversation(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i + 1}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i + 1}`,
    timestamp: i + 1,
  })) as ChatMessage[]
}

const messages = ref<ChatMessage[]>([])
/** What the assistant is saying right now — the chat follows it while it grows. */
const streaming = ref('')

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  messages.value = []
  streaming.value = ''
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
    value: fakeChatSession({ messages, kind: 'chat', overrides: { streamingContent: streaming } }),
  } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** How many messages the chat put in the DOM. */
const mounted = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAllComponents(AiChatMessage).length

describe('a conversation longer than a page', () => {
  const LENGTH = DEFAULT_TAIL_PAGE_SIZE * 3

  it('mounts one page of it rather than all of it', () => {
    messages.value = conversation(LENGTH)

    const wrapper = mount(AiChat)

    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE)
  })

  it('mounts the end of it — the part being read', () => {
    messages.value = conversation(LENGTH)

    const wrapper = mount(AiChat)
    const rendered = wrapper.findAllComponents(AiChatMessage)

    expect(rendered.at(-1)?.props('message').id).toBe(`m${LENGTH}`)
  })

  it('says how many it is holding back', () => {
    messages.value = conversation(LENGTH)

    const wrapper = mount(AiChat)

    expect(wrapper.find('.abele-ai-chat__older').text()).toContain(
      `${LENGTH - DEFAULT_TAIL_PAGE_SIZE} earlier messages`
    )
  })
})

describe('a conversation that fits', () => {
  it('mounts all of it', () => {
    messages.value = conversation(5)

    const wrapper = mount(AiChat)

    expect(mounted(wrapper)).toBe(5)
  })

  it('says nothing about earlier messages', () => {
    messages.value = conversation(5)

    const wrapper = mount(AiChat)

    expect(wrapper.find('.abele-ai-chat__older').exists()).toBe(false)
  })
})

describe('scrolling back', () => {
  it('reveals the previous page when the reader reaches the top', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mount(AiChat)
    const container = wrapper.find('.abele-ai-chat__messages')

    // happy-dom lays nothing out, so the scroll position is set rather than performed.
    Object.defineProperty(container.element, 'scrollTop', { value: 0, writable: true })
    await container.trigger('scroll')
    await nextTick()

    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE * 2)
  })

  it('does not reveal anything while the reader is in the middle', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mount(AiChat)
    const container = wrapper.find('.abele-ai-chat__messages')

    Object.defineProperty(container.element, 'scrollTop', { value: 5000, writable: true })
    await container.trigger('scroll')
    await nextTick()

    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE)
  })
})

describe('a message arriving while the chat is open', () => {
  it('is mounted, however far back the reader has scrolled', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 2)
    const wrapper = mount(AiChat)

    messages.value = [
      ...messages.value,
      { id: 'newest', role: 'assistant', content: 'Just now', timestamp: 999 } as ChatMessage,
    ]
    await nextTick()

    const rendered = wrapper.findAllComponents(AiChatMessage)
    expect(rendered.at(-1)?.props('message').id).toBe('newest')
  })
})

/**
 * These mount into the document rather than beside it. The anchoring drops an anchor whose
 * element has left the page, and a wrapper mounted the default way is detached — so every
 * element in it reports itself disconnected and the anchor would be dropped immediately.
 */
let attached: ReturnType<typeof mount> | null = null

afterEach(() => {
  attached?.unmount()
  attached = null
  document.body.replaceChildren()
})

const mountAttached = () => {
  attached = mount(AiChat, { attachTo: document.body })
  return attached
}

/**
 * happy-dom lays nothing out, so the layout is modelled: every message has a height, the
 * container's rectangle starts at zero, and an element's rectangle follows from what is
 * above it and where the container is scrolled. That is enough to ask the only question
 * that matters — does what the reader is looking at stay where it was.
 */
function layoutModel(wrapper: ReturnType<typeof mount>) {
  const container = wrapper.find('.abele-ai-chat__messages').element as HTMLElement
  const heights = new Map<Element, number>()
  let scrollTop = 0

  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v
    },
  })
  Object.defineProperty(container, 'scrollHeight', {
    configurable: true,
    get: () => [...heights.values()].reduce((sum, h) => sum + h, 0),
  })
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => 800 })
  container.getBoundingClientRect = () => ({ top: 0, height: 800 }) as DOMRect

  /** Re-measures every message against the model. Call after mounting or resizing them. */
  const relayout = () => {
    let offset = 0
    for (const el of container.querySelectorAll('.abele-chat-msg')) {
      const top = offset
      const height = heights.get(el) ?? 0
      Object.defineProperty(el, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ top: top - scrollTop, height }) as DOMRect,
      })
      offset += height
    }
  }

  const setHeights = (height: number) => {
    for (const el of container.querySelectorAll('.abele-chat-msg')) heights.set(el, height)
    relayout()
  }

  return { container, setHeights, relayout, scrollTo: (v: number) => (scrollTop = v) }
}

describe('the view while older messages are being revealed', () => {
  it('keeps the message the reader was on where it was, after the revealed ones render', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mountAttached()
    const model = layoutModel(wrapper)

    // The page as it stands: every message rendered, the reader at the very top.
    model.setHeights(100)
    model.scrollTo(0)
    await wrapper.find('.abele-ai-chat__messages').trigger('scroll')
    await nextTick()

    // The revealed messages mount empty and stay that way for a while: markdown is rendered
    // after mounting, awaited, and queued again behind a timeout. Frames pass with nothing to
    // correct — and only then do the messages take up room. This is the moment the view
    // jumped, and a correction measured once, early, is exactly what missed it.
    await new Promise((resolve) => setTimeout(resolve, 50))
    model.setHeights(100)
    await new Promise((resolve) => setTimeout(resolve, 80))

    // A page of 30 messages, 100px each, appeared above: staying put means scrolling by that.
    expect(model.container.scrollTop).toBe(DEFAULT_TAIL_PAGE_SIZE * 100)
  })

  it('leaves the reader alone once they scroll themselves', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mountAttached()
    const model = layoutModel(wrapper)
    model.setHeights(100)
    model.scrollTo(0)
    const container = wrapper.find('.abele-ai-chat__messages')
    await container.trigger('scroll')
    await nextTick()

    // The reader scrolls away before the revealed messages have rendered. 1500 is a position
    // that exists in the page as it stands — 30 messages of 100px — and is nowhere near its
    // bottom, so nothing else has an opinion about where the view should be.
    model.scrollTo(1500)
    await container.trigger('scroll')
    model.setHeights(100)
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(model.container.scrollTop).toBe(1500)
  })

  // Every way a reader starts scrolling for themselves: the wheel, a finger, the keys, and
  // taking hold of the scrollbar, which is a press on the container and nothing else.
  it.each(['wheel', 'touchstart', 'keydown', 'mousedown'])(
    'lets the reader scroll away with the %s while the revealed messages are still growing',
    async (input) => {
      messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
      const wrapper = mountAttached()
      const model = layoutModel(wrapper)
      const container = wrapper.find('.abele-ai-chat__messages')

      model.setHeights(100)
      model.scrollTo(0)
      await container.trigger('scroll')
      await nextTick()

      // The revealed page takes up room, and the hold answers by scrolling to keep the reader's
      // message where it was. From here on it is correcting every frame.
      model.setHeights(100)
      await new Promise((resolve) => setTimeout(resolve, 60))

      /*
       * The reader scrolls up into what was just revealed. Their scroll and the correction that
       * answers it happen in the same frame, and the container reports one scroll event for
       * both, reading exactly the position the hold put it back to — so the scroll event cannot
       * say who moved it. Their wheel can, and nothing else in the page turns one.
       */
      model.scrollTo(2000)
      await container.trigger(input)
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(model.container.scrollTop).toBe(2000)
    }
  )

  it('does not mistake the correction it just made for the reader moving', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mountAttached()
    const model = layoutModel(wrapper)
    const container = wrapper.find('.abele-ai-chat__messages')

    model.setHeights(100)
    model.scrollTo(0)
    await container.trigger('scroll')
    await nextTick()

    model.setHeights(100)
    await new Promise((resolve) => setTimeout(resolve, 60))

    // The browser reports the correction, as it reports every scroll. Reading that as the
    // reader having taken over would end the hold at the first thing it did, and the messages
    // still rendering below would push the view around for the rest of their arrival.
    await container.trigger('scroll')
    model.setHeights(150)
    await new Promise((resolve) => setTimeout(resolve, 80))

    // 30 messages of 150px above the one being read, which is still where it was.
    expect(model.container.scrollTop).toBe(DEFAULT_TAIL_PAGE_SIZE * 150)
  })
})

/**
 * A chat follows the reply being streamed into it, until the reader scrolls back to read
 * something. Then it has to stay where they left it, however much more of the reply arrives.
 */
describe('the view while a reply is streaming', () => {
  it('stays where the reader scrolled to, however much more arrives', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE)
    const wrapper = mountAttached()
    const model = layoutModel(wrapper)
    const container = wrapper.find('.abele-ai-chat__messages')
    model.setHeights(100)

    // A first chunk, with the chat already at the bottom: it scrolls to where it already is,
    // which no browser reports as a scroll.
    streaming.value = 'The answer'
    await nextTick()
    await nextTick()

    model.scrollTo(1000)
    await container.trigger('scroll')

    streaming.value = 'The answer, at greater length'
    await nextTick()
    await nextTick()

    expect(model.container.scrollTop).toBe(1000)
  })

  it('follows the reply again once the reader comes back to the bottom', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE)
    const wrapper = mountAttached()
    const model = layoutModel(wrapper)
    const container = wrapper.find('.abele-ai-chat__messages')
    model.setHeights(100)

    streaming.value = 'The answer'
    await nextTick()
    await nextTick()

    model.scrollTo(1000)
    await container.trigger('scroll')

    // Back to the end of the conversation, which is the reader asking to be taken along again.
    model.scrollTo(2200)
    await container.trigger('scroll')

    streaming.value = 'The answer, at greater length'
    await nextTick()
    await nextTick()

    expect(model.container.scrollTop).toBe(3000)
  })
})
