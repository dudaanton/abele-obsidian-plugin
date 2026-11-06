import { afterEach, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { useChatScroll } from '@/composables/useChatScroll'
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

it.each([false, true])(
  'keeps visible short rows through wide-panel paging (collapsed tools: %s)',
  async (tools) => {
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
      Array.from({ length: 120 }, (_, i) => ({
        id: `sample-${i}`,
        role: tools && i % 2 ? 'tool-call' : 'assistant',
        content: 'Short sample',
        timestamp: i,
        toolName: 'sample_action',
        toolStatus: 'approved',
        toolResult: 'Done',
      })) as ChatMessage[]
    )
    const box = ref<HTMLElement | null>(null)
    let scroll!: ReturnType<typeof useChatScroll>
    const rect = (top: number, height: number) =>
      ({ top, bottom: top + height, height, left: 0, right: 1500, width: 1500 }) as DOMRect
    const geometry = (el: unknown) => {
      if (!(el instanceof HTMLElement)) return
      el.getBoundingClientRect = () =>
        rect(Array.from(box.value!.children).indexOf(el) * 20 - box.value!.scrollTop, 20)
      el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList
    }
    wrapper = mount(
      defineComponent({
        setup() {
          scroll = useChatScroll({
            messagesContainer: box,
            messages,
            streamingContent: ref(''),
            streamingThinking: ref(''),
            isStreaming: ref(false),
            composing: ref(false),
            windowCost: (a, b) => chatRenderCost(messages.value, () => false)(a, b),
          })
          return () =>
            h(
              'div',
              { ref: box },
              chatBlocks(scroll.visibleMessages.value).map((block) => {
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
              })
            )
        },
      }),
      { attachTo: document.body }
    )
    const el = box.value!
    let position = 0
    const height = () =>
      Math.max(
        el.children.length * 20,
        parseFloat(el.style.getPropertyValue('--abele-chat-floor')) || 0
      )
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
    scroll.showMessagesFrom(30)
    await nextTick()
    scroll.doScroll()
    await nextTick()
    for (const delta of [-100, ...Array<number>(16).fill(-40), ...Array<number>(16).fill(40)]) {
      const before = Array.from(el.children)
        .filter((row) => {
          const r = row.getBoundingClientRect()
          return r.top >= 100 && r.bottom <= 700
        })
        .map((row) => ({ row, top: row.getBoundingClientRect().top }))
      scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: delta }))
      const old = el.scrollTop
      el.scrollTop += delta
      const applied = el.scrollTop - old
      scroll.onMessagesScroll()
      await nextTick()
      await advance(80)
      for (const { row, top } of before) {
        expect(row.isConnected, 'visible row was evicted').toBe(true)
        expect(
          Math.abs(row.getBoundingClientRect().top - top + applied),
          'native displacement'
        ).toBeLessThanOrEqual(2)
      }
    }
  }
)
