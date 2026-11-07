import { afterEach, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { useChatScroll } from '@/composables/useChatScroll'
import type { ChatMessage } from '@/ai/types'
import { useFakeClock } from '../helpers/fakeClock'

import { useVault } from '../helpers/testEnv'

const advance = useFakeClock()
let wrapper: VueWrapper | undefined
afterEach(() => wrapper?.unmount())

async function open() {
  useVault([])
  const box = ref<HTMLElement | null>(null)
  const streaming = ref(false)
  let scroll!: ReturnType<typeof useChatScroll>
  const rect = (top: number, height: number) =>
    ({ top, bottom: top + height, height, left: 0, right: 1500, width: 1500 }) as DOMRect
  wrapper = mount(
    defineComponent({
      setup() {
        scroll = useChatScroll({
          messagesContainer: box,
          messages: ref(
            Array.from({ length: 240 }, (_, i) => ({
              id: `sample-${i}`,
              role: 'assistant',
              content: 'Sample reply',
              timestamp: i,
            })) as ChatMessage[]
          ),
          streamingContent: ref(''),
          streamingThinking: ref(''),
          isStreaming: streaming,
          composing: ref(false),
        })
        return () =>
          h(
            'div',
            { ref: box },
            scroll.visibleMessages.value.map((message) =>
              h(
                'div',
                {
                  class: 'abele-chat-msg',
                  'data-message-id': message.id,
                  ref: (element: unknown) => {
                    if (!(element instanceof HTMLElement)) return
                    element.getBoundingClientRect = () =>
                      rect(
                        Array.from(box.value!.children).indexOf(element) * 100 -
                          box.value!.scrollTop,
                        100
                      )
                    element.getClientRects = () =>
                      [element.getBoundingClientRect()] as unknown as DOMRectList
                  },
                },
                message.content
              )
            )
          )
      },
    }),
    { attachTo: document.body }
  )
  await nextTick()
  const el = box.value!
  Object.defineProperties(el, {
    clientHeight: { get: () => 800 },
    scrollHeight: { get: () => el.children.length * 100 },
  })
  el.getBoundingClientRect = () => rect(0, 800)
  scroll.shouldAutoScroll = false
  el.scrollTop = 1000
  const input = () => scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -40 }))
  const visible = () =>
    Array.from(el.children)
      .filter((row) => {
        const r = row.getBoundingClientRect()
        return r.bottom > 0 && r.top < 800
      })
      .map((row) => ({ row, top: row.getBoundingClientRect().top }))
  return { scroll, el, input, visible, streaming }
}

it('prefetches one full page after 200ms quiet and preserves every visible row', async () => {
  const f = await open()
  const before = f.visible()
  f.input()
  await advance(199)
  expect(f.scroll.visibleMessages.value).toHaveLength(30)
  await advance(81)
  expect(f.scroll.visibleMessages.value).toHaveLength(60)
  for (const { row, top } of before) {
    expect(row.isConnected).toBe(true)
    expect(Math.abs(row.getBoundingClientRect().top - top)).toBeLessThanOrEqual(2)
  }
  await advance(1000)
  expect(f.scroll.visibleMessages.value).toHaveLength(60)
})

it.each(['wheel', 'scroll', 'touch'])('postpones prefetch for renewed %s input', async (mode) => {
  const f = await open()
  f.input()
  await advance(150)
  if (mode === 'wheel') f.input()
  else if (mode === 'scroll') {
    f.el.scrollTop = 900
    f.scroll.onMessagesScroll()
  } else f.scroll.fingerOn(new Event('touchstart'))
  await advance(100)
  expect(f.scroll.visibleMessages.value).toHaveLength(30)
  if (mode === 'touch') {
    await advance(300)
    expect(f.scroll.visibleMessages.value).toHaveLength(30)
    f.scroll.fingerOff(new Event('touchend'))
  }
  await advance(250)
  expect(f.scroll.visibleMessages.value).toHaveLength(60)
})

it.each(['following', 'far away', 'navigation', 'unmount'])(
  'skips idle work after %s',
  async (mode) => {
    const f = await open()
    f.input()
    if (mode === 'following') {
      f.streaming.value = true
      f.scroll.shouldAutoScroll = true
    } else if (mode === 'far away') f.el.scrollTop = 1800
    else if (mode === 'navigation') f.scroll.resetWindow()
    else {
      wrapper!.unmount()
      wrapper = undefined
    }
    await advance(500)
    expect(f.scroll.visibleMessages.value).toHaveLength(30)
  }
)
