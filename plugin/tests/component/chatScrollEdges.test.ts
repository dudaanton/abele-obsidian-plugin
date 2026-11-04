import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { useChatScroll } from '@/composables/useChatScroll'
import { DEFAULT_TAIL_PAGE_SIZE as PAGE } from '@/composables/useTailPagedList'
import type { ChatMessage } from '@/ai/types'
import { useFakeClock } from '../helpers/fakeClock'

const advance = useFakeClock()
let wrapper: ReturnType<typeof mount> | undefined
afterEach(() => wrapper?.unmount())

function open(height = 4000) {
  let scroll!: ReturnType<typeof useChatScroll>
  const box = document.createElement('div')
  Object.defineProperty(box, 'win', { value: window })
  Object.defineProperties(box, {
    clientHeight: { get: () => 800 },
    scrollHeight: { get: () => height },
  })
  wrapper = mount(
    defineComponent({
      setup() {
        scroll = useChatScroll({
          messagesContainer: ref(box),
          messages: ref(
            Array.from({ length: PAGE * 12 }, (_, i) => ({ id: String(i) })) as ChatMessage[]
          ),
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
  scroll.showMessagesFrom(PAGE * 3)
  box.scrollTop = 1000
  return { scroll, box }
}

describe('bounded chat window edges', () => {
  it('does not undo marker paging on a delayed event at the last code scroll position', async () => {
    const { scroll } = open()
    scroll.shouldAutoScroll = true
    scroll.doScroll()
    await nextTick()
    scroll.shouldAutoScroll = false
    scroll.loadOlder()
    await advance(80)
    const start = scroll.visibleMessages.value[0]?.id
    scroll.onMessagesScroll()
    await advance(300)
    expect(scroll.visibleMessages.value[0]?.id).toBe(start)
  })

  it('does not reverse a marker reveal just because eviction leaves the viewport at the bottom', async () => {
    const { scroll, box } = open()
    box.scrollTop = 3200
    scroll.loadOlder()
    const start = scroll.visibleMessages.value[0]?.id
    await advance(300)
    expect(scroll.visibleMessages.value[0]?.id).toBe(start)
  })

  it('does not reverse a newer reveal when layout leaves the viewport at the top', async () => {
    const { scroll, box } = open()
    box.scrollTop = 3200
    scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: 100 }))
    const start = scroll.visibleMessages.value[0]?.id
    box.scrollTop = 0
    await advance(300)
    expect(scroll.visibleMessages.value[0]?.id).toBe(start)
  })

  it('keeps paging newer when folded messages touch both edges, without oscillating', async () => {
    const { scroll, box } = open(800)
    box.scrollTop = 0
    scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: 100 }))
    await advance(800)
    expect(scroll.visibleMessages.value.at(-1)?.id).toBe(String(PAGE * 12 - 1))
    expect(scroll.visibleMessages.value).toHaveLength(PAGE * 3)
  })

  it('retries the top edge after a reveal settles', async () => {
    const { scroll, box } = open()
    scroll.loadOlder()
    const start = scroll.visibleMessages.value[0]?.id
    box.scrollTop = 0
    scroll.onMessagesScroll()
    expect(scroll.visibleMessages.value[0]?.id).toBe(start)
    await advance(300)
    expect(scroll.visibleMessages.value[0]?.id).toBe('0')
  })

  it('does not retry an edge the reader has left while a page settles', async () => {
    const { scroll, box } = open()
    scroll.loadOlder()
    box.scrollTop = 3200
    scroll.onMessagesScroll()
    const end = scroll.visibleMessages.value.at(-1)?.id
    box.scrollTop = 1000
    await advance(100)
    expect(scroll.visibleMessages.value.at(-1)?.id).toBe(end)
  })

  it('retries a bottom request refused while an older page settles, without another scroll', async () => {
    const { scroll, box } = open()
    scroll.loadOlder()
    const end = scroll.visibleMessages.value.at(-1)?.id
    box.scrollTop = 3200
    scroll.onMessagesScroll()
    expect(scroll.visibleMessages.value.at(-1)?.id).toBe(end)
    await nextTick()
    await advance(80)
    expect(scroll.visibleMessages.value.at(-1)?.id).not.toBe(end)
    await advance(800)
    expect(scroll.visibleMessages.value.at(-1)?.id).toBe(String(PAGE * 12 - 1))
  })

  it.each(['wheel', 'touchstart'])(
    'loads newer on %s at an immovable bottom edge',
    async (type) => {
      const { scroll, box } = open()
      box.scrollTop = 3200
      const end = scroll.visibleMessages.value.at(-1)?.id
      if (type === 'wheel') scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: 100 }))
      else scroll.fingerOn(new Event('touchstart'))
      await nextTick()
      expect(scroll.visibleMessages.value.at(-1)?.id).not.toBe(end)
    }
  )
})
