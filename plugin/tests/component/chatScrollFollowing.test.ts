import { afterEach, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { useChatScroll } from '@/composables/useChatScroll'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

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
  let scroll!: ReturnType<typeof useChatScroll>
  wrapper = mount(
    defineComponent({
      setup() {
        scroll = useChatScroll({
          messagesContainer: container,
          messages,
          streamingContent: ref('Reply'),
          streamingThinking: ref(''),
          isStreaming: ref(true),
          composing: ref(false),
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
  const contentHeight = () => box.children.length * 100 + extra
  Object.defineProperties(box, {
    clientHeight: { get: () => 800 },
    scrollHeight: { get: contentHeight },
    scrollTop: {
      get: () => top,
      set: (v: number) => {
        top = Math.max(0, Math.min(v, contentHeight() - 800))
      },
    },
  })
  scroll.doScroll()
  await nextTick()
  const grow = async () => {
    extra += 400
    const message = box.lastElementChild!
    // Image layout changes the message, but not the scroll container's box.
    for (const observer of observers) if (observer.targets.has(message)) observer.callback()
    await nextTick()
  }
  return { box, scroll, grow, messages }
}

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
