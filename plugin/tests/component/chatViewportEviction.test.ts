import { afterEach, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { useChatScroll } from '@/composables/useChatScroll'
import { useChatScrollAnchors } from '@/composables/useChatScrollAnchors'
import type { ChatMessage } from '@/ai/types'
import { chatBlocks } from '@/ai/toolRuns'
import { chatRenderCost } from '@/ai/chatRenderCost'
import { useFakeClock } from '../helpers/fakeClock'
import { useVault } from '../helpers/testEnv'

const advance = useFakeClock()
let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  vi.unstubAllGlobals()
})

it('resolves a page anchor after its host is replaced on a later tick', () => {
  useVault([])
  const box = ref<HTMLElement | null>(null)
  let anchors!: ReturnType<typeof useChatScrollAnchors>
  wrapper = mount(
    defineComponent({
      setup() {
        anchors = useChatScrollAnchors({
          messagesContainer: box,
          shouldAutoScroll: () => false,
          scrollContainerTo: (el, top) => {
            el.scrollTop = top
          },
        })
        return () => h('div', { ref: box })
      },
    }),
    { attachTo: document.body }
  )
  const el = box.value!
  el.getBoundingClientRect = () => ({ top: 0, bottom: 800 }) as DOMRect
  Object.defineProperties(el, {
    clientHeight: { get: () => 800 },
    scrollHeight: { get: () => 2000 },
  })
  el.scrollTop = 100
  const row = (at: number) => {
    const node = document.createElement('div')
    node.className = 'abele-chat-msg'
    node.dataset.messageId = 'sample-anchor'
    node.getBoundingClientRect = () =>
      ({ top: at - el.scrollTop, bottom: at + 50 - el.scrollTop }) as DOMRect
    node.getClientRects = () => [node.getBoundingClientRect()] as unknown as DOMRectList
    el.append(node)
    return node
  }
  const old = row(120)
  anchors.captureAnchor()
  old.remove()
  anchors.holdAnchor()
  const replacement = row(300)
  anchors.holdAnchor()
  expect(replacement.getBoundingClientRect().top).toBe(20)
  expect(el.scrollTop).toBe(280)
})

it.each([
  [false, 120],
  [true, 120],
  [false, 480],
  [true, 480],
  [true, 480, true],
  [true, 480, true, true],
] as const)(
  'keeps visible short rows through wide-panel paging (collapsed tools: %s, messages: %s)',
  async (tools, count, mixed = false, drag = false) => {
    useVault([])
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    const messages = ref(
      Array.from({ length: count }, (_, i) => ({
        id: `sample-${i}`,
        role: tools && i % 2 ? 'tool-call' : 'assistant',
        content: 'Short sample',
        timestamp: i,
        toolName: 'sample_action',
        toolStatus: 'approved',
        toolResult: 'Done',
      })) as ChatMessage[]
    )
    const text = ref('')
    let streamHeight = 0
    const box = ref<HTMLElement | null>(null)
    let scroll!: ReturnType<typeof useChatScroll>
    const rect = (top: number, height: number) =>
      ({ top, bottom: top + height, height, left: 0, right: 1500, width: 1500 }) as DOMRect
    const rowHeight = (el: Element) =>
      el.classList.contains('abele-ai-chat__streaming')
        ? streamHeight
        : mixed
          ? [20, 94, 29, 180, 42][
              Number((el as HTMLElement).dataset.messageId?.split('-').pop() ?? 0) % 5
            ]
          : 20
    let layoutKey = ''
    let contentHeight = 0
    const tops = new Map<Element, number>()
    const layout = () => {
      const el = box.value!
      const key = `${el.firstElementChild?.getAttribute('data-message-id')}:${el.lastElementChild?.getAttribute('data-message-id')}:${el.childElementCount}:${streamHeight}`
      if (key === layoutKey) return
      layoutKey = key
      tops.clear()
      contentHeight = 0
      for (const row of Array.from(el.children)) {
        tops.set(row, contentHeight)
        contentHeight += rowHeight(row)
      }
    }
    const geometry = (el: unknown) => {
      if (!(el instanceof HTMLElement)) return
      el.getBoundingClientRect = () => {
        layout()
        return rect((tops.get(el) ?? 0) - box.value!.scrollTop, rowHeight(el))
      }
      el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList
    }
    wrapper = mount(
      defineComponent({
        setup() {
          scroll = useChatScroll({
            messagesContainer: box,
            messages,
            streamingContent: text,
            streamingThinking: ref(''),
            isStreaming: ref(drag),
            composing: ref(false),
            windowCost: (a, b) => chatRenderCost(messages.value, () => false)(a, b),
          })
          return () =>
            h('div', { ref: box }, [
              ...chatBlocks(scroll.visibleMessages.value).map((block) => {
                const id = block.kind === 'run' ? block.id : block.message.id
                return h(
                  'div',
                  {
                    key: id,
                    ref: geometry,
                    'data-message-id': id,
                    class: block.kind === 'run' ? 'abele-chat-run is-collapsed' : 'abele-chat-msg',
                    'data-run-ids':
                      block.kind === 'run' ? block.calls.map((c) => c.id).join(' ') : undefined,
                  },
                  'Sample'
                )
              }),
              ...(drag && !scroll.hasNewer.value
                ? [
                    h(
                      'div',
                      {
                        key: 'stream',
                        ref: geometry,
                        class: 'abele-ai-chat__streaming',
                      },
                      text.value
                    ),
                  ]
                : []),
            ])
        },
      }),
      { attachTo: document.body }
    )
    const el = box.value!
    let position = 0
    const height = () => {
      layout()
      return Math.max(
        contentHeight,
        parseFloat(el.style.getPropertyValue('--abele-chat-floor')) || 0
      )
    }
    Object.defineProperties(el, {
      clientHeight: { get: () => 800 },
      scrollHeight: { get: height },
      scrollTop: {
        get: () => (position = Math.max(0, Math.min(position, height() - 800))),
        set: (value: number) => {
          position = Math.max(0, Math.min(value, height() - 800))
        },
      },
    })
    el.getBoundingClientRect = () => rect(0, 800)
    scroll.showMessagesFrom(count - 90)
    await nextTick()
    scroll.doScroll()
    await nextTick()
    const steps = drag ? 180 : mixed ? 250 : count === 120 ? 16 : 80
    const journey = [-100, ...Array<number>(steps).fill(-40), ...Array<number>(steps).fill(40)]
    for (const delta of mixed ? [...journey, ...journey, ...journey] : journey) {
      const before = Array.from(el.children)
        .filter((row) => {
          const r = row.getBoundingClientRect()
          return r.bottom > 0 && r.top < 800
        })
        .map((row) => ({ row, top: row.getBoundingClientRect().top }))
      if (!drag) scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: delta }))
      const old = el.scrollTop
      el.scrollTop += delta
      const applied = el.scrollTop - old
      if (drag) {
        streamHeight += 23
        text.value += ' chunk'
      }
      scroll.onMessagesScroll()
      await nextTick()
      if (mixed) {
        vi.advanceTimersByTime(16)
        // A native event can arrive after a frame queues reclaim, before Vue patches.
        if (drag) scroll.onMessagesScroll()
        else scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: delta }))
        await nextTick()
      } else await advance(80)
      expect(el.children.length, 'off-screen rows are reclaimed').toBeLessThanOrEqual(180)
      for (const { row, top } of before) {
        expect(row.isConnected, 'visible row was evicted').toBe(true)
        expect(
          Math.abs(row.getBoundingClientRect().top - top + applied),
          'native displacement'
        ).toBeLessThanOrEqual(2)
      }
    }
  },
  30_000
)
