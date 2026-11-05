import { afterEach, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, onUpdated, ref } from 'vue'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useChatScroll } from '@/composables/useChatScroll'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { useFakeClock } from '../helpers/fakeClock'
import { fakeChatSession } from '../helpers/fakeChatSession'

const advance = useFakeClock()

it('keeps following when content layout reports a scroll before its resize', async () => {
  const { box, scroll, grow } = await open()
  // A folded tool row expands before its ResizeObserver callback is delivered.
  await grow(true)
  expect(scroll.shouldAutoScroll).toBe(true)
  expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight)
})

it('releases following as soon as the reader takes the scrollbar', async () => {
  const { box, scroll, grow } = await open()
  scroll.readerTakesOver(new MouseEvent('mousedown'))
  expect(scroll.shouldAutoScroll).toBe(false)
  box.scrollTop -= 20
  scroll.onMessagesScroll()
  const reading = box.scrollTop
  await grow()
  expect(box.scrollTop).toBe(reading)
})

it('resumes at the native bottom when integer geometry leaves a one-pixel gap', async () => {
  const { box, scroll, grow } = await open()
  scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -100 }))
  box.scrollTop -= 100
  scroll.onMessagesScroll()
  scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: 100 }))
  box.scrollTop = box.scrollHeight - box.clientHeight - 1
  scroll.onMessagesScroll()
  expect(scroll.shouldAutoScroll).toBe(true)
  await grow()
  expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight)
})

it('keeps the reached live end following when content grows before finger-up', async () => {
  const { box, scroll, grow } = await open()
  const touch = (type: string, clientY: number) => {
    const event = new Event(type)
    Object.defineProperty(event, 'touches', { value: [{ clientY }] })
    return event
  }
  scroll.fingerOn(touch('touchstart', 300))
  scroll.fingerOn(touch('touchmove', 200))
  scroll.onMessagesScroll()
  expect(scroll.shouldAutoScroll).toBe(true)
  await grow()
  expect(box.scrollHeight - box.clientHeight - box.scrollTop).toBeGreaterThan(0)
  scroll.fingerOn(touch('touchmove', 100))
  expect(scroll.shouldAutoScroll).toBe(true)
  scroll.fingerOff(new Event('touchend'))
  await nextTick()
  expect(scroll.shouldAutoScroll).toBe(true)
  expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight)
})

it.each(['wheel', 'mousedown'])(
  'keeps %s input released through a zero-distance layout scroll',
  async (type) => {
    const { box, scroll, grow } = await open()
    const reading = box.scrollTop
    scroll.readerTakesOver(
      type === 'wheel' ? new WheelEvent(type, { deltaY: -20 }) : new MouseEvent(type)
    )
    scroll.onMessagesScroll()
    expect(scroll.shouldAutoScroll).toBe(false)
    await grow()
    expect(box.scrollTop).toBe(reading)
  }
)

it.each([0.5, 1, 20])(
  'keeps a %s px upward touch released when the finger lifts',
  async (distance) => {
    const { box, scroll, grow } = await open()
    const touch = (type: string, clientY: number) => {
      const event = new Event(type)
      Object.defineProperty(event, 'touches', { value: [{ clientY }] })
      return event
    }
    scroll.fingerOn(touch('touchstart', 300))
    scroll.fingerOn(touch('touchmove', 300 + distance))
    box.scrollTop -= distance
    scroll.onMessagesScroll()
    scroll.fingerOff(new Event('touchend'))
    const reading = box.scrollTop
    expect(scroll.shouldAutoScroll).toBe(false)
    await grow()
    expect(box.scrollTop).toBe(reading)
  }
)

it.each([0.5, 1, 20])(
  'keeps a %s px upward wheel movement released while more text arrives',
  async (distance) => {
    const { box, scroll, grow } = await open()
    scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -distance }))
    box.scrollTop -= distance
    scroll.onMessagesScroll()
    const reading = box.scrollTop
    await grow()
    expect(scroll.shouldAutoScroll).toBe(false)
    expect(box.scrollTop).toBe(reading)
  }
)

it('does not mistake positive layout anchoring for downward reader input', async () => {
  const { box, scroll, grow } = await open()
  scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -1 }))
  box.scrollTop -= 1
  scroll.onMessagesScroll()
  const reading = box.scrollTop,
    height = box.scrollHeight
  await grow()
  box.scrollTop = reading + box.scrollHeight - height
  scroll.onMessagesScroll()
  expect(box.scrollHeight - box.clientHeight - box.scrollTop).toBe(1)
  expect(scroll.shouldAutoScroll).toBe(false)
})

it('keeps Shift+Space released as upward input at the bottom', async () => {
  const { scroll } = await open()
  scroll.readerTakesOver(new KeyboardEvent('keydown', { key: ' ', shiftKey: true }))
  expect(scroll.shouldAutoScroll).toBe(false)
})

it('lets subsequent compositor frames of one wheel gesture keep moving the reader', async () => {
  const { box, scroll } = await open()
  box.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect
  for (const [index, child] of [...box.children].entries()) {
    child.getBoundingClientRect = () =>
      ({ top: index * 100 - box.scrollTop, bottom: (index + 1) * 100 - box.scrollTop }) as DOMRect
  }
  scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -240 }))
  box.scrollTop -= 80
  scroll.onMessagesScroll()
  const firstFrame = box.scrollTop
  // Native smooth scrolling emits several scroll frames for one input event.
  box.scrollTop -= 80
  scroll.onMessagesScroll()
  expect(box.scrollTop).toBe(firstFrame - 80)
})

it('releases the obsolete scroll range when the reader takes over', async () => {
  const { box, scroll } = await open()
  box.scrollTop -= 100
  scroll.onMessagesScroll()
  expect(box.classList.contains('abele-ai-chat__messages_floor')).toBe(true)
  scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -100 }))
  expect(box.classList.contains('abele-ai-chat__messages_floor')).toBe(false)
})

it('takes End to the conversation tail even when that page is unmounted', async () => {
  const { box, scroll } = await open()
  scroll.shouldAutoScroll = false
  scroll.showMessagesFrom(0)
  await nextTick()
  box.scrollTop = 0
  scroll.readerTakesOver(new KeyboardEvent('keydown', { key: 'End' }))
  await nextTick()
  expect(scroll.visibleMessages.value.at(-1)?.id).toBe('sample-119')
  expect(scroll.shouldAutoScroll).toBe(true)
  expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight)
})

it.each([false, true])(
  'leaves End in a nested text field to that field (at page end: %s)',
  async (atEnd) => {
    const { box, scroll } = await open()
    scroll.shouldAutoScroll = false
    scroll.showMessagesFrom(0)
    await nextTick()
    const last = scroll.visibleMessages.value.at(-1)?.id
    box.scrollTop = atEnd ? box.scrollHeight - box.clientHeight : 0
    const field = document.createElement('textarea')
    box.append(field)
    const event = new KeyboardEvent('keydown', { key: 'End' })
    field.dispatchEvent(event)
    scroll.readerTakesOver(event)
    await nextTick()
    expect(scroll.visibleMessages.value.at(-1)?.id).toBe(last)
    expect(scroll.shouldAutoScroll).toBe(false)
  }
)

it('does not stitch the streaming tail onto a window of earlier history', async () => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  const service = ChatService.getInstance()
  const messages = ref(
    Array.from({ length: 360 }, (_, i) => ({
      id: `history-${i}`,
      role: 'assistant',
      content: `Sample reply ${i}`,
      timestamp: i,
    })) as ChatMessage[]
  )
  const session = fakeChatSession({
    messages,
    kind: 'chat',
    overrides: {
      id: 'sample-window',
      isStreaming: ref(true),
      streamingContent: ref('Sample live tail.'),
    },
  })
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue(computed(() => session) as never)
  service.tabOrder.value = ['sample-window']
  service.activeTabId.value = 'sample-window'
  try {
    wrapper = mount(AiChat, { attachTo: document.body })
    await nextTick()
    expect(wrapper.find('.abele-ai-chat__streaming').exists()).toBe(true)
    for (let i = 0; i < 3; i++) {
      await wrapper.find('.abele-ai-chat__older button').trigger('click')
      await advance(80)
    }
    expect(wrapper.find('[data-message-id="history-359"]').exists()).toBe(false)
    expect(wrapper.find('.abele-ai-chat__streaming').exists()).toBe(false)
  } finally {
    wrapper?.unmount()
    wrapper = undefined
    service.tabOrder.value = []
    service.activeTabId.value = null
    vi.restoreAllMocks()
  }
})

it('keeps a completed live tail readable when the history window is full', async () => {
  const { box, scroll, messages } = await open()
  scroll.loadOlder()
  await advance(80)
  scroll.loadOlder()
  await advance(80)
  expect(scroll.visibleMessages.value).toHaveLength(90)
  scroll.shouldAutoScroll = false
  box.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect
  const live = document.createElement('div')
  live.className = 'abele-ai-chat__streaming-content'
  live.getBoundingClientRect = () => ({ top: 0, bottom: 1000 }) as DOMRect
  live.getClientRects = () => [live.getBoundingClientRect()] as unknown as DOMRectList
  box.append(live)
  messages.value = [
    ...messages.value,
    {
      id: 'completed-stream',
      role: 'assistant',
      content: 'Sample completed answer',
      timestamp: 200,
    } as ChatMessage,
  ]
  await nextTick()
  expect(scroll.visibleMessages.value.at(-1)?.id).toBe('completed-stream')
  expect(scroll.visibleMessages.value).toHaveLength(90)
  expect(scroll.shouldAutoScroll).toBe(false)
})

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

async function open() {
  useVault([])
  const observers: { callback: () => void; targets: Set<Element> }[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      entry: (typeof observers)[number]
      constructor(callback: () => void) {
        this.entry = { callback, targets: new Set() }
        observers.push(this.entry)
      }
      observe(el: Element) {
        this.entry.targets.add(el)
      }
      unobserve(el: Element) {
        this.entry.targets.delete(el)
      }
      disconnect() {
        this.entry.targets.clear()
      }
    }
  )
  const messages = ref(
    Array.from({ length: 120 }, (_, i) => ({
      id: `sample-${i}`,
      role: 'assistant',
      content: 'Sample reply',
      timestamp: i,
    })) as ChatMessage[]
  )
  const container = ref<HTMLElement | null>(null)
  const streamingContent = ref('Reply')
  let afterLayout: (() => void) | undefined
  let scroll!: ReturnType<typeof useChatScroll>
  wrapper = mount(
    defineComponent({
      setup() {
        scroll = useChatScroll({
          messagesContainer: container,
          messages,
          streamingContent,
          streamingThinking: ref(''),
          isStreaming: ref(true),
          composing: ref(false),
        })
        onUpdated(() => {
          const run = afterLayout
          afterLayout = undefined
          run?.()
        })
        return () =>
          h(
            'div',
            { ref: container },
            scroll.visibleMessages.value.map((m) =>
              h('div', { 'data-message-id': m.id }, [
                h('img'),
                h('details', [h('summary', 'Tool'), 'Output']),
              ])
            )
          )
      },
    }),
    { attachTo: document.body }
  )
  const box = container.value!
  let extra = 0
  let top = 0
  let height = 800
  const contentHeight = () => box.children.length * 100 + extra
  Object.defineProperties(box, {
    clientHeight: { get: () => height },
    scrollHeight: { get: contentHeight },
    scrollTop: {
      get: () => top,
      set: (v: number) => {
        top = Math.max(0, Math.min(v, contentHeight() - height))
      },
    },
  })
  scroll.doScroll()
  await nextTick()
  const grow = async (scrollBeforeResize = false) => {
    extra += 400
    if (scrollBeforeResize) {
      box.scrollTop += 100
      scroll.onMessagesScroll()
    }
    const message = box.lastElementChild!
    // Image layout changes the message, but not the scroll container's box.
    for (const observer of observers) if (observer.targets.has(message)) observer.callback()
    await nextTick()
  }
  return {
    box,
    scroll,
    grow,
    messages,
    streamingContent,
    afterLayout: (run: () => void) => {
      afterLayout = run
    },
    shrinkComposer: () => {
      height += 100
      box.scrollTop = Math.min(box.scrollTop, box.scrollHeight - height)
      scroll.onMessagesScroll()
      for (const observer of observers) if (observer.targets.has(box)) observer.callback()
    },
  }
}

it('follows a send from just above the end while the window and composer change', async () => {
  const { box, scroll, messages, grow, streamingContent, afterLayout, shrinkComposer } =
    await open()
  for (let i = 0; i < 65; i++) {
    messages.value = [
      ...messages.value,
      {
        id: `earlier-${i}`,
        role: 'assistant',
        content: 'Earlier reply',
        timestamp: i,
      } as ChatMessage,
    ]
    await nextTick()
  }
  await nextTick()
  box.scrollTop = box.scrollHeight - box.clientHeight - 80
  scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -80 }))
  scroll.onMessagesScroll()
  expect(scroll.shouldAutoScroll).toBe(false)
  // Resetting the 90-row window to its last page removes 60 rows above the viewport.
  // The browser keeps the same reading position and reports it before nextTick scrolls.
  afterLayout(() => {
    box.scrollTop = box.scrollHeight - box.clientHeight - 80
    scroll.onMessagesScroll()
  })
  scroll.scrollOnUserSend()
  await nextTick()
  shrinkComposer()
  await nextTick()
  messages.value = [
    ...messages.value,
    {
      id: 'sample-send',
      role: 'user',
      content: 'New question',
      timestamp: 200,
    } as ChatMessage,
  ]
  streamingContent.value = 'Starting the reply'
  await nextTick()
  await nextTick()
  await grow()
  expect(scroll.shouldAutoScroll).toBe(true)
  expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight)
})

it('lets reader input cancel a send scroll before the queued scroll runs', async () => {
  const { box, scroll, messages, afterLayout, grow } = await open()
  afterLayout(() => {
    scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -300 }))
    box.scrollTop -= 300
    scroll.onMessagesScroll()
  })
  scroll.scrollOnUserSend()
  messages.value = [
    ...messages.value,
    {
      id: 'sample-send',
      role: 'user',
      content: 'New question',
      timestamp: 200,
    } as ChatMessage,
  ]
  await nextTick()
  const reading = box.scrollTop
  await grow()
  expect(scroll.shouldAutoScroll).toBe(false)
  expect(box.scrollTop).toBe(reading)
})

it('releases an existing reading-position hold when sending a new message', async () => {
  const { box, scroll, grow } = await open()
  const message = box.lastElementChild as HTMLElement
  message.getBoundingClientRect = () =>
    ({
      top: 2900 - box.scrollTop,
      bottom: 3000 - box.scrollTop,
    }) as DOMRect
  box.scrollTop = box.scrollHeight - box.clientHeight - 80
  scroll.holdInView(message, 780)
  scroll.scrollOnUserSend()
  await nextTick()
  await grow()
  await advance(80)
  expect(scroll.shouldAutoScroll).toBe(true)
  expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight)
})

it('follows late image layout after a long chat advances its render window', async () => {
  const { box, grow, messages } = await open()
  for (let i = 0; i < 65; i++) {
    messages.value = [
      ...messages.value,
      { id: `new-${i}`, role: 'assistant', content: 'Tool result', timestamp: i } as ChatMessage,
    ]
    await nextTick()
  }
  await nextTick()
  expect(box.children.length).toBe(90)
  expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight)
  await grow()
  expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight)
})

it('leaves a reader above the end alone and resumes after they scroll back down', async () => {
  const { box, scroll, grow } = await open()
  box.scrollTop -= 300
  scroll.onMessagesScroll()
  const reading = box.scrollTop
  await grow()
  expect(box.scrollTop).toBe(reading)
  box.scrollTop = box.scrollHeight
  scroll.onMessagesScroll()
  await grow()
  expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight)
})
