import { afterEach, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { useChatScroll } from '@/composables/useChatScroll'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { useFakeClock } from '../helpers/fakeClock'

const advance = useFakeClock()
let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  document.body.replaceChildren()
})

it('holds the paragraph below a clipped chart through a streamed reply and tool handoff', async () => {
  useVault([])
  const messages = ref<ChatMessage[]>([
    { id: 'sample-question', role: 'user', content: 'A sample plan', timestamp: 1 } as ChatMessage,
  ])
  const text = ref('A plan with a diagram, chart and paragraphs')
  const streaming = ref(true)
  const box = document.createElement('div')
  box.innerHTML =
    '<div class="abele-chat-msg" data-message-id="sample-question"></div><div class="streaming"><div class="abele-markdown"><div class="chart"></div><p>Reading point</p><p>More of the reply</p></div></div>'
  document.body.append(box)
  const stream = box.lastElementChild as HTMLElement
  const markdown = stream.firstElementChild as HTMLElement
  const chart = markdown.children[0] as HTMLElement
  const paragraph = markdown.children[1] as HTMLElement
  const more = markdown.children[2] as HTMLElement
  let chartHeight = 220
  let tailHeight = 1200
  const chartAt = 1000
  const paragraphAt = () => chartAt + chartHeight + 16
  const rect = (top: number, height: number) =>
    ({
      top: top - box.scrollTop,
      bottom: top + height - box.scrollTop,
      height,
    }) as DOMRect
  Object.defineProperties(box, {
    clientHeight: { get: () => 800 },
    scrollHeight: { get: () => paragraphAt() + 60 + tailHeight },
  })
  box.getBoundingClientRect = () => ({ top: 0, bottom: 800, height: 800 }) as DOMRect
  const layout = (el: HTMLElement, at: () => number, height: () => number) => {
    el.getBoundingClientRect = () => rect(at(), height())
    el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList
  }
  layout(
    box.firstElementChild as HTMLElement,
    () => 0,
    () => 100
  )
  layout(
    stream,
    () => 100,
    () => box.scrollHeight - 100
  )
  layout(
    chart,
    () => chartAt,
    () => chartHeight
  )
  layout(paragraph, paragraphAt, () => 60)
  layout(
    more,
    () => paragraphAt() + 60,
    () => tailHeight
  )
  let scroll!: ReturnType<typeof useChatScroll>
  wrapper = mount(
    defineComponent({
      setup() {
        scroll = useChatScroll({
          messagesContainer: ref(box),
          messages,
          streamingContent: text,
          streamingThinking: ref('Sample reasoning'),
          isStreaming: streaming,
          composing: ref(false),
        })
        return () => h('div')
      },
    })
  )
  await nextTick()
  // Like the live probe: take over while a long answer streams, putting the paragraph
  // 40px down. The chart above it still has 24px visible in the viewport.
  scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -120 }))
  box.scrollTop = paragraphAt() - 40
  scroll.onMessagesScroll()
  for (let i = 0; i < 4; i++) {
    tailHeight += 100
    text.value += ' More text.'
    await nextTick()
    expect(paragraph.getBoundingClientRect().top).toBe(40)
  }
  // A tool call ends the first answer. Markdown transfers its existing blocks to the
  // completed message, as the real renderer does, while the next answer starts below it.
  messages.value = [
    ...messages.value,
    {
      id: 'sample-answer',
      role: 'assistant',
      content: text.value,
      timestamp: 2,
    } as ChatMessage,
  ]
  text.value = ''
  await nextTick()
  const answer = document.createElement('div')
  answer.className = 'abele-chat-msg'
  answer.dataset.messageId = 'sample-answer'
  layout(
    answer,
    () => 100,
    () => box.scrollHeight - 100
  )
  answer.append(markdown)
  stream.replaceWith(answer)
  // The chart finishes its layout in the new host. Its top does not move; its bottom
  // and the reading paragraph move by one row's height unless the paragraph is held.
  chartHeight += 170
  await advance(40)
  expect(Math.abs(paragraph.getBoundingClientRect().top - 40)).toBeLessThanOrEqual(2)
  text.value = 'A follow-up after the tool result'
  tailHeight += 300
  await nextTick()
  await advance(40)
  expect(Math.abs(paragraph.getBoundingClientRect().top - 40)).toBeLessThanOrEqual(2)
  text.value = ''
  streaming.value = false
  await nextTick()
  await advance(80)
  expect(Math.abs(paragraph.getBoundingClientRect().top - 40)).toBeLessThanOrEqual(2)
  expect(scroll.visibleMessages.value.map((m) => m.id)).toEqual([
    'sample-question',
    'sample-answer',
  ])
})
