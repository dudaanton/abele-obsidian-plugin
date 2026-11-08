import { afterEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { useChatScroll } from '@/composables/useChatScroll'
import type { ChatMessage } from '@/ai/types'
import { useFakeClock } from '../helpers/fakeClock'

const advance = useFakeClock()
let wrapper: ReturnType<typeof mount> | undefined
afterEach(() => {
  wrapper?.unmount()
  document.body.replaceChildren()
})

it('retries a restored viewport offset after the first scroll write is clamped by layout', async () => {
  const box = document.createElement('div')
  const message = document.createElement('div')
  message.dataset.messageId = 'sample-message'
  message.className = 'abele-chat-msg'
  box.append(message)
  document.body.append(box)
  let height = 800
  let top = 0
  Object.defineProperties(box, {
    win: { value: window },
    clientHeight: { get: () => 800 },
    scrollHeight: { get: () => height },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.max(0, Math.min(value, height - 800))
      },
    },
  })
  box.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect
  message.getBoundingClientRect = () => ({ top: 400 - top, bottom: 500 - top }) as DOMRect
  let scroll!: ReturnType<typeof useChatScroll>
  wrapper = mount(
    defineComponent({
      setup() {
        scroll = useChatScroll({
          messagesContainer: ref(box),
          messages: ref([{ id: 'sample-message' }] as ChatMessage[]),
          streamingContent: ref(''),
          streamingThinking: ref(''),
          isStreaming: ref(false),
          composing: ref(false),
        })
        return () => h('div')
      },
    })
  )
  scroll.shouldAutoScroll = false
  await nextTick()
  await scroll.returnTo({ messageId: 'sample-message', offset: -40, hidden: 0 })
  expect(top).toBe(0)
  // WebKit reports the clamped position before late content has filled the range.
  scroll.onMessagesScroll()
  height = 2000
  await advance(80)
  expect(message.getBoundingClientRect().top).toBe(-40)
  // A later native layout adjustment is still not a request to abandon that place.
  box.scrollTop = 398
  expect(message.getBoundingClientRect().top).toBe(2)
  scroll.onMessagesScroll()
  expect(message.getBoundingClientRect().top).toBe(-40)
  // Real input must still release the restoration hold immediately.
  scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -10 }))
  box.scrollTop = 300
  scroll.onMessagesScroll()
  await advance(80)
  expect(top).toBe(300)
})
