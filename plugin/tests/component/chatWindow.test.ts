/**
 * How much of a conversation the chat mounts.
 *
 * The window itself is settled in `tests/unit/useTailPagedList.test.ts`. What is asserted here
 * is that the chat actually uses it — that a long conversation puts a bounded number of
 * messages in the DOM, says how many it is holding back, and reveals them when the reader
 * scrolls to the top. Mounting every message is exactly the cost this exists to avoid, so a
 * regression here is invisible to every other test and obvious to anyone opening a long chat.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
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
import { useFakeClock } from '../helpers/fakeClock'
const advance = useFakeClock()

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

// Initial-state assertions are read-only scenarios: keep their independent test names but
// mount each conversation only once. Interaction cases continue to get a fresh profile.
let initial: { count: number; wrapper: ReturnType<typeof mount> | null } | null = null
const ordinary: Array<ReturnType<typeof mount>> = []
const mountChat = () => {
  const wrapper = mount(AiChat)
  ordinary.push(wrapper)
  return wrapper
}
function initialConversation(count: number) {
  beforeAll(() => {
    initial = { count, wrapper: null }
  })
  afterAll(() => {
    for (const wrapper of ordinary.splice(0)) wrapper.unmount()
    initial = null
    vi.restoreAllMocks()
  })
}

beforeEach(() => {
  if (initial?.wrapper) return
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  messages.value = []
  streaming.value = ''
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
    value: fakeChatSession({ messages, kind: 'chat', overrides: { streamingContent: streaming } }),
  } as never)
  if (initial) {
    messages.value = conversation(initial.count)
    initial.wrapper = mountChat()
  }
})

afterEach(() => {
  if (initial) return
  for (const wrapper of ordinary.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})

/** How many messages the chat put in the DOM. */
const mounted = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAllComponents(AiChatMessage).length

it('keeps expanded tool details when paging away and back', async () => {
  messages.value = conversation(120)
  messages.value[119] = {
    ...messages.value[119],
    role: 'tool-call',
    content: '',
    toolName: 'read',
    toolParams: { path: 'Samples/tool.md' },
    toolStatus: 'approved',
    toolResult: 'Sample long tool result.\n'.repeat(80),
  }
  const wrapper = mountChat()
  await nextTick()
  await wrapper.get('.abele-chat-run > .tree-item-self').trigger('click')
  const details = () => wrapper.get('.abele-chat-msg[data-message-id="m120"] .abele-chat-msg__icon')
  await details().trigger('click')
  expect(details().attributes('aria-expanded')).toBe('true')
  for (let i = 0; i < 3; i++) {
    await wrapper.get('.abele-ai-chat__older button').trigger('click')
    await advance(80)
  }
  expect(wrapper.find('.abele-chat-msg[data-message-id="m120"]').exists()).toBe(false)
  await wrapper.get('.abele-ai-chat__messages').trigger('keydown', { key: 'End' })
  await advance(80)
  expect(details().attributes('aria-expanded')).toBe('true')
})

describe('a conversation longer than a page', () => {
  const LENGTH = DEFAULT_TAIL_PAGE_SIZE * 3
  initialConversation(LENGTH)

  it('mounts one page of it rather than all of it', () => {
    expect(mounted(initial!.wrapper!)).toBe(DEFAULT_TAIL_PAGE_SIZE)
  })

  it('mounts the end of it — the part being read', () => {
    const rendered = initial!.wrapper!.findAllComponents(AiChatMessage)

    expect(rendered.at(-1)?.props('message').id).toBe(`m${LENGTH}`)
  })

  it('says how many it is holding back', () => {
    expect(initial!.wrapper!.find('.abele-ai-chat__older').text()).toContain(
      `${LENGTH - DEFAULT_TAIL_PAGE_SIZE} earlier messages`
    )
  })
})

describe('a conversation that fits', () => {
  initialConversation(5)

  it('mounts all of it', () => {
    expect(mounted(initial!.wrapper!)).toBe(5)
  })

  it('says nothing about earlier messages', () => {
    expect(initial!.wrapper!.find('.abele-ai-chat__older').exists()).toBe(false)
  })
})

describe('scrolling back', () => {
  it('preserves touch travel when page layout arrives one input step after mounting', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mountChat()
    const container = wrapper.find('.abele-ai-chat__messages')
    const el = container.element as HTMLElement
    Object.defineProperties(el, {
      scrollTop: { value: 1450, writable: true, configurable: true },
      clientHeight: { value: 600, configurable: true },
      scrollHeight: { value: 6000, configurable: true },
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      const top = this === el ? 0 : 2000 - el.scrollTop
      return { top, bottom: top + 100 } as DOMRect
    })
    await container.trigger('touchstart', { touches: [{ clientY: 100 }] })
    let pagePending = false
    let pageApplied = false
    let travelled = 0
    for (let step = 1; step <= 6; step++) {
      // Native input continues without scroll events. Model its lower bound and
      // initial touch slop; a page cannot recover travel already clamped away.
      const event = new Event('touchmove', { bubbles: true })
      Object.defineProperty(event, 'touches', { value: [{ clientY: 100 + step * 300 }] })
      el.dispatchEvent(event)
      const distance = step === 1 ? 284 : 300
      const movement = Math.min(el.scrollTop, distance)
      el.scrollTop -= movement
      travelled += movement
      // Simulate asynchronous page layout one native step after Vue mounts it.
      // This isolates prefetch timing from the separately tested anchor correction.
      if (pagePending) {
        el.scrollTop += 3000
        pagePending = false
        pageApplied = true
      }
      await nextTick()
      if (!pageApplied && mounted(wrapper) > DEFAULT_TAIL_PAGE_SIZE) pagePending = true
    }
    expect(pageApplied).toBe(true)
    expect(travelled).toBe(1800 - 16)
  })

  it('prefetches a viewport ahead from touch input before its coalesced scroll event arrives', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mountChat()
    const container = wrapper.find('.abele-ai-chat__messages')
    Object.defineProperties(container.element, {
      scrollTop: { value: 828, writable: true, configurable: true },
      clientHeight: { value: 562, configurable: true },
      scrollHeight: { value: 3000, configurable: true },
    })
    await container.trigger('touchstart', { touches: [{ clientY: 200 }] })
    await container.trigger('touchmove', { touches: [{ clientY: 481 }] })
    await nextTick()
    // The input handler must use the same viewport lead as the scroll handler.
    // Waiting for a later event at 266px lets a 281px native step clamp at zero.
    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE * 2)
  })

  it('reveals the previous page when the reader reaches the top', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mountChat()
    const container = wrapper.find('.abele-ai-chat__messages')

    // happy-dom lays nothing out, so the scroll position is set rather than performed.
    Object.defineProperty(container.element, 'scrollTop', { value: 0, writable: true })
    Object.defineProperties(container.element, {
      clientHeight: { value: 800, configurable: true },
      scrollHeight: { value: 3000, configurable: true },
    })
    container.element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }))
    await container.trigger('scroll')
    await nextTick()

    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE * 2)
  })

  it('does not reveal anything while the reader is in the middle', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mountChat()
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
    const wrapper = mountChat()

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
    await advance(50)
    model.setHeights(100)
    await advance(80)

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
    await advance(60)

    expect(model.container.scrollTop).toBe(1500)
  })

  // Every way a reader starts scrolling for themselves: the wheel, a finger, the keys, and
  // taking hold of the scrollbar, which is a press on the container and nothing else.
  it.each(['wheel', 'touchstart', 'touchmove', 'keydown', 'mousedown'])(
    'lets the reader scroll away with the %s while the revealed messages are still growing',
    async (input) => {
      messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
      const wrapper = mountAttached()
      const model = layoutModel(wrapper)
      const container = wrapper.find('.abele-ai-chat__messages')

      model.setHeights(100)
      if (input === 'touchmove') {
        model.scrollTo(1000)
        await container.trigger('touchstart')
      }
      model.scrollTo(0)
      await container.trigger('scroll')
      await nextTick()

      // The revealed page takes up room, and the hold answers by scrolling to keep the reader's
      // message where it was. From here on it is correcting every frame.
      model.setHeights(100)
      await advance(60)

      /*
       * The reader scrolls up into what was just revealed. Their scroll and the correction that
       * answers it happen in the same frame, and the container reports one scroll event for
       * both, reading exactly the position the hold put it back to — so the scroll event cannot
       * say who moved it. Their wheel can, and nothing else in the page turns one.
       */
      model.scrollTo(2000)
      await container.trigger(input)
      await advance(100)

      expect(model.container.scrollTop).toBe(2000)
    }
  )

  it.each(['wheel', 'keydown', 'touchmove'])(
    'accepts %s over the earlier-messages marker while a page hold is active',
    async (input) => {
      messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
      const wrapper = mountAttached()
      const model = layoutModel(wrapper)
      const container = wrapper.get('.abele-ai-chat__messages')
      model.setHeights(100)
      model.scrollTo(0)
      await container.trigger('scroll')
      await nextTick()
      model.setHeights(100)
      await advance(60)
      const marker = wrapper.get('.abele-ai-chat__older button')
      if (input === 'touchmove') await marker.trigger('touchstart')
      model.scrollTo(2000)
      await marker.trigger(input, input === 'wheel' ? { deltaY: -100 } : { key: 'PageUp' })
      await advance(100)
      expect(model.container.scrollTop).toBe(2000)
      if (input === 'touchmove') {
        await marker.trigger('touchend')
        await container.trigger('keydown', { key: 'End' })
        await advance(80)
        expect(model.container.scrollTop).toBeGreaterThan(2000)
      }
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
    await advance(60)

    // The browser reports the correction, as it reports every scroll. Reading that as the
    // reader having taken over would end the hold at the first thing it did, and the messages
    // still rendering below would push the view around for the rest of their arrival.
    await container.trigger('scroll')
    model.setHeights(150)
    await advance(80)

    // 30 messages of 150px above the one being read, which is still where it was.
    expect(model.container.scrollTop).toBe(DEFAULT_TAIL_PAGE_SIZE * 150)
  })
})

/**
 * The marker above the oldest mounted message, and a page that does not fill the box.
 *
 * Revealing used to wait for a scroll event near the top, and that is all it waited for. A page
 * of an agent's work is mostly calls folded into a few runs, so thirty messages can draw shorter
 * than the box: there is nothing to scroll, no scroll event ever comes, and the marker saying how
 * many are held back was the only thing on screen about them — not something to press.
 */
describe('reaching the messages held back', () => {
  it('keeps both ends of a physically short collapsed tool history mounted', async () => {
    messages.value = conversation(122).map((message, index) =>
      index > 0 && index < 121
        ? {
            ...message,
            role: 'tool-call',
            content: '',
            toolName: 'read',
            toolParams: { path: 'Samples/shared.md' },
            toolStatus: 'approved',
            toolResult: 'Sample result',
          }
        : message
    ) as ChatMessage[]
    const wrapper = mountAttached()
    const model = layoutModel(wrapper)
    model.setHeights(10)
    await advance(500)
    model.setHeights(10)
    await advance(300)
    expect(wrapper.find('[data-message-id="m1"]').exists()).toBe(true)
    expect(wrapper.find('.abele-ai-chat__older').exists()).toBe(false)
    expect(wrapper.find('[data-message-id="m122"]').exists()).toBe(true)
    expect(wrapper.findAllComponents({ name: 'ChatToolImage' })).toHaveLength(0)
    expect(wrapper.findAllComponents(AiChatMessage).length).toBeLessThan(5)
  })

  it('reveals the previous page from the marker, which is a button', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mountAttached()
    const marker = wrapper.find('.abele-ai-chat__older button')

    expect(marker.exists()).toBe(true)
    expect(marker.attributes('aria-label')).toContain('earlier messages')
    await marker.trigger('click')
    await nextTick()

    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE * 2)
  })

  it('counts rapid marker presses, including their mouse and touch input, one page per press', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 5)
    const wrapper = mountAttached()
    const marker = wrapper.find('.abele-ai-chat__older button')
    await marker.trigger('mousedown')
    await marker.trigger('click')
    await marker.trigger('touchstart')
    await marker.trigger('touchend')
    await marker.trigger('click')
    await marker.trigger('mousedown')
    await marker.trigger('click')
    await advance(300)

    expect(wrapper.findAllComponents(AiChatMessage)[0].props('message').id).toBe('m31')
    expect(wrapper.find('.abele-ai-chat__older').text()).toContain('30 earlier messages')
    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE * 3)
  })

  it('reveals earlier pages by itself while the conversation is too short to scroll, up to its start', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mountAttached()
    const model = layoutModel(wrapper)
    // Thirty short rows: 300px in an 800px box, nothing to scroll.
    model.setHeights(10)
    await advance(60)
    await nextTick()
    model.setHeights(10)
    await advance(60)
    await nextTick()

    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE * 3)
    expect(wrapper.find('.abele-ai-chat__older').exists()).toBe(false)
  })

  it('reveals nothing by itself once the page fills the box', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mountAttached()
    const model = layoutModel(wrapper)
    model.setHeights(100)
    model.scrollTo(2200)
    await advance(60)
    await nextTick()

    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE)
  })

  it('reveals the previous page on a turn of the wheel up at the very top, where nothing scrolls', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE * 3)
    const wrapper = mountAttached()
    const model = layoutModel(wrapper)
    model.setHeights(100)
    await advance(60)
    // Already at the top, the event for getting there spent: the wheel is all that comes now.
    model.scrollTo(0)

    await wrapper.find('.abele-ai-chat__messages').trigger('wheel', { deltaY: -40 })
    await nextTick()

    expect(mounted(wrapper)).toBe(DEFAULT_TAIL_PAGE_SIZE * 2)
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

/**
 * The reader starting to scroll up while a reply arrives.
 *
 * A scroll event says where the box is only once the frame is drawn, and a piece of the reply
 * landing before that put a reader still near the end back at the end — a short flick up, or a
 * finger dragging slowly, was pulled back down, again and again. What the reader does with the
 * wheel, a key or a finger says it at once.
 */
describe('the reader starting to scroll up while a reply streams', () => {
  const atTheEnd = async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE)
    const wrapper = mountAttached()
    const model = layoutModel(wrapper)
    model.setHeights(100)
    streaming.value = 'The answer'
    await nextTick()
    await nextTick()
    expect(model.container.scrollTop).toBe(3000)
    return { wrapper, model, container: wrapper.find('.abele-ai-chat__messages') }
  }

  const more = async (text: string) => {
    streaming.value = text
    await nextTick()
    await nextTick()
  }

  it('stops following on a turn of the wheel up, before any scroll is reported', async () => {
    const { model, container } = await atTheEnd()
    await container.trigger('wheel', { deltaY: -40 })
    model.scrollTo(2960)

    await more('The answer, at greater length')

    expect(model.container.scrollTop).toBe(2960)
  })

  it('keeps following on a turn of the wheel down', async () => {
    const { model, container } = await atTheEnd()
    await container.trigger('wheel', { deltaY: 40 })

    await more('The answer, at greater length')

    expect(model.container.scrollTop).toBe(3000)
  })

  it('leaves the text alone under a finger on the screen', async () => {
    const { model, container } = await atTheEnd()
    await container.trigger('touchstart')
    model.scrollTo(2970)

    await more('The answer, at greater length')
    expect(model.container.scrollTop).toBe(2970)

    // Let go still at the end: following again.
    model.scrollTo(3000)
    await container.trigger('touchend')
    await more('The answer, at greater length still')
    expect(model.container.scrollTop).toBe(3000)
  })

  it('stays where the finger left the text, even before any scroll is reported', async () => {
    const { model, container } = await atTheEnd()
    await container.trigger('touchstart')
    model.scrollTo(1000)
    await container.trigger('touchend')

    await more('The answer, at greater length')

    expect(model.container.scrollTop).toBe(1000)
  })

  it('stops following on a key that scrolls up', async () => {
    const { model, container } = await atTheEnd()
    await container.trigger('keydown', { key: 'PageUp' })
    model.scrollTo(2300)

    await more('The answer, at greater length')

    expect(model.container.scrollTop).toBe(2300)
  })
})

/**
 * A box that changes height while it is being read — a phone's keyboard opening under it.
 *
 * Modelled with a scroll position that the browser would clamp: a box shorter than its
 * content cannot be scrolled past the end, which is the whole of what makes a shrink move the
 * reader. `ResizeObserver` is stubbed, and the test says when it fires.
 */
function resizableModel(wrapper: ReturnType<typeof mount>, contentHeight: number) {
  const container = wrapper.find('.abele-ai-chat__messages').element as HTMLElement
  let clientHeight = 800
  let scrollTop = 0
  const clamp = (v: number) => Math.max(0, Math.min(v, contentHeight - clientHeight))

  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = clamp(v)
    },
  })
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => contentHeight })
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => clientHeight })

  return {
    container,
    scrollTo: (v: number) => (scrollTop = clamp(v)),
    grow: (height: number) => {
      contentHeight = height
    },
    resize: (height: number) => {
      clientHeight = height
      scrollTop = clamp(scrollTop)
    },
  }
}

describe('the box shrinking under the reader, as it does when a keyboard opens', () => {
  const observers: Array<{ targets: Set<Element>; fire: () => void }> = []

  beforeEach(() => {
    observers.length = 0
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private entry = { targets: new Set<Element>(), fire: () => this.cb([]) }
        constructor(private cb: (entries: ResizeObserverEntry[]) => void) {
          observers.push(this.entry)
        }
        observe(target: Element) {
          this.entry.targets.add(target)
        }
        unobserve(target: Element) {
          this.entry.targets.delete(target)
        }
        disconnect() {
          this.entry.targets.clear()
        }
      }
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  const boxObserver = (container: Element) =>
    observers.find((o) => o.targets.has(container)) ?? null

  const settle = async () => {
    await nextTick()
    await nextTick()
  }

  it('watches the box it is reading in', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE)
    const wrapper = mountAttached()
    const model = resizableModel(wrapper, 2000)
    await nextTick()

    expect(boxObserver(model.container)).not.toBeNull()
  })

  it('keeps the end of the conversation in view when the reader was at it', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE)
    const wrapper = mountAttached()
    const model = resizableModel(wrapper, 2000)
    const container = wrapper.find('.abele-ai-chat__messages')
    await settle()
    model.scrollTo(1200)
    await container.trigger('scroll')

    model.resize(400)
    boxObserver(model.container)?.fire()
    await settle()

    expect(model.container.scrollTop).toBe(1600)
  })

  it('keeps the distance to the end when the reader was somewhere above it', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE)
    const wrapper = mountAttached()
    const model = resizableModel(wrapper, 2000)
    const container = wrapper.find('.abele-ai-chat__messages')
    await settle()
    model.scrollTo(1000)
    await container.trigger('scroll')

    // The browser clamps the position to the new box and says so before it reports the
    // resize; the clamp is not the reader moving.
    model.resize(400)
    await container.trigger('scroll')
    boxObserver(model.container)?.fire()
    await settle()
    expect(model.container.scrollTop).toBe(1400)

    // And back, when the keyboard goes: 1400 is past the end of an 800px box, so the browser
    // clamps it to 1200 first, and the reader is still put back 200 above the end.
    model.resize(800)
    await container.trigger('scroll')
    boxObserver(model.container)?.fire()
    await settle()
    expect(model.container.scrollTop).toBe(1000)
  })

  it('keeps the distance to the end as it is when the box changes, after a reply grew under the reader', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE)
    const isStreaming = ref(true)
    vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
      value: fakeChatSession({
        messages,
        kind: 'chat',
        overrides: { streamingContent: streaming, isStreaming },
      }),
    } as never)
    const wrapper = mountAttached()
    const model = resizableModel(wrapper, 2000)
    const container = wrapper.find('.abele-ai-chat__messages')
    await settle()
    streaming.value = 'The answer'
    await settle()
    model.scrollTo(1000)
    await container.trigger('scroll')

    // The reply goes on streaming in below the reader: 400px more of it, and no scroll.
    model.grow(2400)
    streaming.value = 'The answer, at much greater length'
    await settle()
    await advance()

    // Then the box under the conversation gets a little shorter, as a row appears below it.
    model.resize(784)
    boxObserver(model.container)?.fire()
    await settle()
    expect(model.container.scrollTop).toBe(1016)
  })
})

describe('coming back from a tab a delegated run was holding', () => {
  it('follows a message that grows after it is mounted, as it did before leaving', async () => {
    messages.value = conversation(DEFAULT_TAIL_PAGE_SIZE)
    const service = ChatService.getInstance()
    const run = ref<unknown>(null)
    vi.spyOn(service, 'activeRun', 'get').mockImplementation(() => run.value as never)
    const wrapper = mount(AiChat, {
      attachTo: document.body,
      global: { stubs: { AiRunView: true } },
    })
    attached = wrapper
    await nextTick()

    run.value = { id: 'r1' }
    await nextTick()
    expect(wrapper.find('.abele-ai-chat__messages').exists()).toBe(false)
    run.value = null
    await nextTick()

    // The container is a new element. A message rendering its markdown late changes the
    // subtree and grows the conversation, and the chat should still be at its end after.
    const model = layoutModel(wrapper)
    model.setHeights(100)
    model.scrollTo(0)
    const last = model.container.querySelector('.abele-chat-msg:last-of-type')!
    last.appendChild(document.createElement('p'))
    await advance()
    await nextTick()

    expect(model.container.scrollTop).toBe(DEFAULT_TAIL_PAGE_SIZE * 100)
  })
})

describe('bounded bidirectional history', () => {
  it('keeps the visible reading anchor when either edge is evicted', async () => {
    messages.value = conversation(2000)
    const wrapper = mountAttached()
    const container = wrapper.find('.abele-ai-chat__messages')
    const el = container.element as HTMLElement
    let top = 0
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => {
        top = value
      },
    })
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 800 })
    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: () => el.querySelectorAll('.abele-chat-msg').length * 100,
    })
    el.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800 }) as DOMRect
    const measure = () => {
      Array.from(el.querySelectorAll<HTMLElement>('.abele-chat-msg')).forEach((message, index) => {
        message.getBoundingClientRect = () =>
          ({
            top: index * 100 - top,
            bottom: (index + 1) * 100 - top,
            height: 100,
          }) as DOMRect
      })
    }
    const move = async (position: number) => {
      await container.trigger('wheel')
      top = position
      measure()
      await container.trigger('scroll')
      await nextTick()
      measure()
      await advance(80)
    }
    measure()
    await move(0)
    await move(0)
    expect(mounted(wrapper)).toBe(90)
    const oldestBefore = el.querySelector<HTMLElement>('.abele-chat-msg')!
    await move(0)
    expect(mounted(wrapper)).toBe(90)
    expect(oldestBefore.isConnected).toBe(true)
    expect(oldestBefore.getBoundingClientRect().top).toBe(0)

    // Now read near the lower edge: the first mounted row is offscreen and will be evicted.
    top = el.scrollHeight - 850
    measure()
    const anchor = Array.from(el.querySelectorAll<HTMLElement>('.abele-chat-msg')).find(
      (message) => message.getBoundingClientRect().bottom > 0
    )!
    const offset = anchor.getBoundingClientRect().top
    await move(top)
    expect(mounted(wrapper)).toBe(90)
    expect(anchor.isConnected).toBe(true)
    expect(anchor.getBoundingClientRect().top).toBe(offset)

    // New arrivals must not drag this historical reading window to the latest turn.
    const ids = wrapper.findAllComponents(AiChatMessage).map((row) => row.props('message').id)
    messages.value.push(
      ...conversation(100).map((message) => ({ ...message, id: `new-${message.id}` }))
    )
    await nextTick()
    expect(wrapper.findAllComponents(AiChatMessage).map((row) => row.props('message').id)).toEqual(
      ids
    )
  })
})
