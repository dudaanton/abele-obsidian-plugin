import { afterEach, describe, expect, it, vi } from 'vitest'
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
  it.each([
    ['touch', -1],
    ['touch', 1],
    ['wheel', -1],
    ['wheel', 1],
  ] as const)(
    'retries a deferred %s prefetch before the next native step reaches edge %s',
    async (input, direction) => {
      const { scroll, box } = open()
      const touch = (type: string, clientY: number) => {
        const event = new Event(type)
        Object.defineProperty(event, 'touches', { value: [{ clientY }] })
        return event
      }
      // A previous reveal still owns the page transaction when input asks for
      // its successor. There is time to mount it, but not to wait for 200px.
      box.scrollTop = direction < 0 ? 100 : 3100
      scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: direction }))
      const edge = () =>
        direction < 0
          ? scroll.visibleMessages.value[0]?.id
          : scroll.visibleMessages.value.at(-1)?.id
      const before = edge()
      box.scrollTop = direction < 0 ? 950 : 2250
      if (input === 'touch') {
        scroll.fingerOn(touch('touchstart', 100))
        scroll.fingerOn(touch('touchmove', 100 - direction * 300))
      } else scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: direction * 300 }))
      // The native default action runs while Vue settles the previous page.
      box.scrollTop += direction * 300
      await advance(80)
      if (direction < 0) {
        // Model the added range only when the next page actually mounted. Three
        // coalesced native steps must retain all their travel, without another
        // event to rescue a prefetch that was dropped at the transaction boundary.
        if (edge() !== before) box.scrollTop += 3000
        let travelled = 0
        for (let step = 0; step < 3; step++) {
          const movement = Math.min(box.scrollTop, 300)
          box.scrollTop -= movement
          travelled += movement
        }
        expect(travelled).toBe(900)
      }
      expect(edge()).not.toBe(before)
    }
  )

  it('captures the anchor once for a logical wheel page', async () => {
    const { scroll, box } = open()
    const query = vi.spyOn(box, 'querySelectorAll')
    box.scrollTop = 100
    scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -10 }))
    // Move clear of the edge: count work for this request, not another requested page.
    box.scrollTop = 1000
    await advance(80)
    const captures = query.mock.calls.filter(([selector]) =>
      String(selector).includes('.abele-chat-run.is-collapsed')
    ).length
    console.info('anchor captures per logical wheel page', captures)
    expect(captures).toBe(1)
    query.mockRestore()
  })
  it.each([-1, 1])('prefetches wheel pages before the next large delta: %s', (direction) => {
    const { scroll, box } = open()
    box.scrollTop = 2000
    scroll.onMessagesScroll()
    scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: direction }))
    const before =
      direction < 0 ? scroll.visibleMessages.value[0]?.id : scroll.visibleMessages.value.at(-1)?.id
    box.scrollTop = direction < 0 ? 500 : 2500
    scroll.onMessagesScroll()
    const after =
      direction < 0 ? scroll.visibleMessages.value[0]?.id : scroll.visibleMessages.value.at(-1)?.id
    expect(after).not.toBe(before)
  })
  it.each([-1, 1])(
    'does not reverse reader direction after a layout clamp during reveal: %s',
    async (direction) => {
      const { scroll, box } = open()
      if (direction < 0) scroll.loadOlder()
      else {
        box.scrollTop = 3200
        scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: 10 }))
      }
      const before =
        direction < 0
          ? scroll.visibleMessages.value[0]?.id
          : scroll.visibleMessages.value.at(-1)?.id
      scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: direction * 10 }))
      box.scrollTop = direction < 0 ? 3200 : 0
      scroll.onMessagesScroll()
      await advance(80)
      const after =
        direction < 0
          ? scroll.visibleMessages.value[0]?.id
          : scroll.visibleMessages.value.at(-1)?.id
      expect(after).toBe(before)
    }
  )
  it.each([-1, 1])(
    'does not page the opposite edge when the reader moves away from it: %s',
    (direction) => {
      const { scroll, box } = open()
      box.scrollTop = direction < 0 ? 3100 : 100
      const before =
        direction < 0
          ? scroll.visibleMessages.value.at(-1)?.id
          : scroll.visibleMessages.value[0]?.id
      scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: direction * 10 }))
      box.scrollTop += direction * 10
      scroll.onMessagesScroll()
      const after =
        direction < 0
          ? scroll.visibleMessages.value.at(-1)?.id
          : scroll.visibleMessages.value[0]?.id
      expect(after).toBe(before)
    }
  )
  it('does not infer touch paging direction from a zero-distance layout scroll', () => {
    const { scroll, box } = open()
    box.scrollTop = 2000
    scroll.onMessagesScroll()
    scroll.fingerOn(new Event('touchstart'))
    const before = scroll.visibleMessages.value.at(-1)?.id
    scroll.onMessagesScroll()
    expect(scroll.visibleMessages.value.at(-1)?.id).toBe(before)
  })
  it.each([-1, 1])(
    'prefetches in the touch direction between coalesced input events: %s',
    (direction) => {
      const { scroll, box } = open()
      scroll.onMessagesScroll()
      scroll.fingerOn(new Event('touchstart'))
      const before =
        direction < 0
          ? scroll.visibleMessages.value[0]?.id
          : scroll.visibleMessages.value.at(-1)?.id
      box.scrollTop = direction < 0 ? 500 : 2500
      scroll.onMessagesScroll()
      const after =
        direction < 0
          ? scroll.visibleMessages.value[0]?.id
          : scroll.visibleMessages.value.at(-1)?.id
      expect(after).not.toBe(before)
    }
  )
  it.each([-500, 500])('loads before a large touch delta crosses a virtual edge: %s', (delta) => {
    const { scroll, box } = open()
    const before =
      delta < 0 ? scroll.visibleMessages.value[0]?.id : scroll.visibleMessages.value.at(-1)?.id
    const touch = (type: string, clientY: number) => {
      const event = new Event(type)
      Object.defineProperty(event, 'touches', { value: [{ clientY }] })
      return event
    }
    box.scrollTop = 1000
    scroll.fingerOn(touch('touchstart', 600))
    box.scrollTop = delta < 0 ? 400 : 2800
    scroll.fingerOn(touch('touchmove', 600 - delta))
    const after =
      delta < 0 ? scroll.visibleMessages.value[0]?.id : scroll.visibleMessages.value.at(-1)?.id
    expect(after).not.toBe(before)
  })
  it.each([-500, 500])('loads before a large wheel delta crosses a virtual edge: %s', (delta) => {
    const { scroll, box } = open()
    const before =
      delta < 0 ? scroll.visibleMessages.value[0]?.id : scroll.visibleMessages.value.at(-1)?.id
    box.scrollTop = delta < 0 ? 400 : 2800
    scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: delta }))
    const after =
      delta < 0 ? scroll.visibleMessages.value[0]?.id : scroll.visibleMessages.value.at(-1)?.id
    expect(after).not.toBe(before)
  })
  it.each(['during', 'after'])(
    'keeps every marker page when browser clamping reports the bottom %s reveal',
    async (when) => {
      const { scroll, box } = open()
      for (let page = 1; page <= 3; page++) {
        box.scrollTop = 3200
        scroll.loadOlder(new Event('click'))
        if (when === 'after') await advance(80)
        // Evicting the visible tail can clamp/re-anchor scrollTop without reader input.
        box.scrollTop = 3100
        scroll.onMessagesScroll()
        await advance(100)
        expect(scroll.visibleMessages.value[0]?.id).toBe(String(PAGE * (3 - page)))
      }
      // A real downward gesture is still allowed to bring newer pages back.
      scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: 100 }))
      await advance(100)
      expect(scroll.visibleMessages.value[0]?.id).not.toBe('0')
    }
  )

  it('keeps marker presses made while the previous page is mounting', async () => {
    const { scroll, box } = open()
    box.scrollTop = 3200
    for (let i = 0; i < 3; i++) scroll.loadOlder(new Event('click'))
    await advance(300)
    expect(scroll.visibleMessages.value[0]?.id).toBe('0')
  })

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
    const target = String(Number(scroll.visibleMessages.value[0]?.id) + PAGE)
    scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: 100 }))
    box.scrollTop = 0
    await advance(300)
    expect(scroll.visibleMessages.value[0]?.id).toBe(target)
  })

  it('cancels remaining slices when navigation chooses another window', async () => {
    const { scroll, box } = open()
    box.scrollTop = 100
    scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -10 }))
    scroll.showMessagesFrom(200)
    const destination = scroll.visibleMessages.value.map((message) => message.id)
    box.scrollTop = 1000
    await advance(200)
    expect(scroll.visibleMessages.value.map((message) => message.id)).toEqual(destination)
  })

  it('cancels remaining older slices when the reader reverses direction', async () => {
    const { scroll, box } = open()
    box.scrollTop = 100
    scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: -10 }))
    const first = scroll.visibleMessages.value[0]?.id
    box.scrollTop = 1000
    scroll.readerTakesOver(new WheelEvent('wheel', { deltaY: 10 }))
    await advance(200)
    expect(scroll.visibleMessages.value[0]?.id).toBe(first)
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
