import { afterEach, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, onUpdated, ref } from 'vue'
import { useChatScroll } from '@/composables/useChatScroll'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { useFakeClock } from '../helpers/fakeClock'

const advance = useFakeClock()

it('keeps following when content layout reports a scroll before its resize', async () => {
  const { box, scroll, grow } = await open()
  // A folded tool row expands before its ResizeObserver callback is delivered.
  await grow(true)
  expect(scroll.shouldAutoScroll).toBe(true)
  expect(box.scrollTop).toBe(box.scrollHeight - box.clientHeight)
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
