import { expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { useChatScroll } from '@/composables/useChatScroll'
import { useVault } from '../helpers/testEnv'

it('does not correct an already browser-anchored paragraph again on a message resize', async () => {
  useVault([])
  let resize = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    }
  )
  const box = document.createElement('div')
  const message = document.createElement('div')
  message.className = 'abele-chat-msg'
  box.append(message)
  document.body.append(box)
  let content = 3000
  let paragraphAt = 1040
  Object.defineProperties(box, {
    clientHeight: { get: () => 800 },
    scrollHeight: { get: () => content },
  })
  box.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
  message.getClientRects = () => [message.getBoundingClientRect()] as unknown as DOMRectList
  message.getBoundingClientRect = () =>
    ({
      top: paragraphAt - box.scrollTop,
      bottom: paragraphAt + 100 - box.scrollTop,
    }) as DOMRect
  const streaming = ref(false)
  let scroll!: ReturnType<typeof useChatScroll>
  const wrapper = mount(
    defineComponent({
      setup() {
        scroll = useChatScroll({
          messagesContainer: ref(box),
          messages: ref([]),
          streamingContent: ref(''),
          streamingThinking: ref(''),
          isStreaming: streaming,
          composing: ref(false),
        })
        return () => h('div')
      },
    })
  )
  try {
    await nextTick()
    resize()
    box.scrollTop = 1000
    scroll.onMessagesScroll()
    streaming.value = true
    await nextTick()
    // A layout change above the paragraph, already compensated by the browser in
    // this layout pass. Deliver the message resize before the next anchor frame.
    content += 170
    paragraphAt += 170
    box.scrollTop += 170
    expect(message.getBoundingClientRect().top).toBe(40)
    resize()
    expect(message.getBoundingClientRect().top).toBe(40)
  } finally {
    wrapper.unmount()
    box.remove()
    vi.unstubAllGlobals()
  }
})

it('keeps the reading position when a reply grows while the composer changes height', async () => {
  useVault([])
  let resize = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    }
  )
  const box = document.createElement('div')
  const message = document.createElement('div')
  message.className = 'abele-chat-msg'
  box.append(message)
  document.body.append(box)
  let height = 800,
    content = 2000
  Object.defineProperties(box, {
    clientHeight: { get: () => height },
    scrollHeight: { get: () => content },
  })
  box.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
  message.getBoundingClientRect = () =>
    ({ top: 416 - box.scrollTop, bottom: 516 - box.scrollTop }) as DOMRect
  const streaming = ref(false)
  let scroll!: ReturnType<typeof useChatScroll>
  const wrapper = mount(
    defineComponent({
      setup() {
        scroll = useChatScroll({
          messagesContainer: ref(box),
          messages: ref([]),
          streamingContent: ref(''),
          streamingThinking: ref(''),
          isStreaming: streaming,
          composing: ref(false),
        })
        return () => h('div')
      },
    })
  )
  try {
    await nextTick()
    resize()
    scroll.holdInView(message, 16)
    scroll.clearAnchor()
    streaming.value = true
    await nextTick()
    content = 3000
    height = 700
    resize()
    expect(message.getBoundingClientRect().top).toBe(16)
  } finally {
    wrapper.unmount()
    box.remove()
    vi.unstubAllGlobals()
  }
})
