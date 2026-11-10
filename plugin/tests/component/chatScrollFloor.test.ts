/**
 * While the conversation changes under a reader, the chat keeps its scroll range at least as
 * long as it was, so a browser that clamps the scroll mid-change has nothing to clamp. A chat
 * left with no messages — a new one, or another opened in its place — has no place to hold, and
 * a floor there only scrolls its greeting out of sight: it is let go at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { useChatScrollAnchors } from '@/composables/useChatScrollAnchors'
import { useChatScroll } from '@/composables/useChatScroll'
import type { ChatMessage } from '@/ai/types'
import { useFakeClock } from '../helpers/fakeClock'
import { useVault } from '../helpers/testEnv'

const advance = useFakeClock()
const FLOOR = 'abele-ai-chat__messages_floor'

let wrapper: VueWrapper | undefined
beforeEach(() => {
  useVault([])
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

/** A conversation box, as tall as it was before the change, holding the messages given. */
function conversation(messages: number) {
  const container = document.createElement('div')
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: () => 1000 })
  for (let i = 0; i < messages; i++) {
    const message = document.createElement('div')
    message.className = 'abele-chat-msg'
    container.append(message)
  }
  document.body.append(container)
  let anchors!: ReturnType<typeof useChatScrollAnchors>
  wrapper = mount(
    defineComponent({
      setup() {
        anchors = useChatScrollAnchors({
          messagesContainer: ref(container),
          scrollContainerTo: (el, top) => {
            el.scrollTop = top
          },
          shouldAutoScroll: () => false,
        })
        return () => h('div')
      },
    })
  )
  return { container, anchors }
}

describe('the floor under a changing conversation', () => {
  it('finishes a patch without an anchor so later input can release a new hold', async () => {
    const { container, anchors } = conversation(0)
    anchors.beginPageChange()
    anchors.finishPageChange()
    await Promise.resolve()
    anchors.anchor = { el: container, offset: 0, at: 0 }
    anchors.releaseReader()
    expect(anchors.anchor).toBeNull()
  })

  it.each([true, false])(
    'measures a patched page once before paint (observer: %s)',
    async (observed) => {
      const { container, anchors } = conversation(1)
      const message = container.children[0] as HTMLElement
      let top = 300
      let documentTop = 400
      const range = vi.fn(() => 1400)
      Object.defineProperties(container, {
        scrollTop: {
          get: () => top,
          set: (value: number) => {
            top = value
          },
        },
        scrollHeight: { get: range },
        clientHeight: { get: () => 400 },
      })
      container.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
      message.getBoundingClientRect = () => ({ top: documentTop - top }) as DOMRect
      anchors.beginPageChange()
      anchors.anchor = { el: message, offset: 100, at: documentTop }
      range.mockClear()
      // Native input arrives before the patch; only the inserted height is compensated.
      top -= 40
      anchors.releaseReader()
      documentTop += 200
      anchors.finishPageChange()
      expect(range).not.toHaveBeenCalled()
      // The subtree observer runs at the microtask checkpoint after Vue's post watchers.
      if (observed) anchors.holdLayout()
      await Promise.resolve()
      expect(range).toHaveBeenCalledTimes(1)
      expect(top).toBe(460)
      expect(message.getBoundingClientRect().top).toBe(140)
      anchors.releaseReader()
      expect(anchors.anchor).toBeNull()
    }
  )

  it('samples position after a range read has applied native layout clamping', () => {
    const { container, anchors } = conversation(1)
    const message = container.children[0] as HTMLElement
    let top = 900
    Object.defineProperties(container, {
      scrollTop: {
        get: () => top,
        set: (value: number) => {
          top = value
        },
      },
      scrollHeight: {
        get: () => {
          top = Math.min(top, 600)
          return 1000
        },
      },
      clientHeight: { get: () => 400 },
    })
    container.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
    message.getBoundingClientRect = () => ({ top: 500 - top }) as DOMRect
    anchors.anchor = { el: message, offset: -400, at: 500 }
    const measured = vi.fn()
    anchors.holdLayout(measured)
    expect(measured).toHaveBeenCalledWith({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })
    expect(anchors.anchor?.at).toBe(500)
    // A second pass must not undo the browser's clamp using a fictitious first drift.
    anchors.holdLayout(measured)
    expect(top).toBe(600)
  })

  it('keeps the complete mutation-observer path free of reads after its first write', async () => {
    let mutated!: () => void
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: () => void) {
          mutated = callback
        }
        observe() {}
        disconnect() {}
      }
    )
    const container = document.createElement('div')
    const message = document.createElement('div')
    message.className = 'abele-chat-msg'
    container.append(message)
    document.body.append(container)
    let top = 900
    let documentTop = 1000
    const events: string[] = []
    Object.defineProperties(container, {
      scrollTop: {
        get: () => {
          events.push('read scroll')
          return top
        },
        set: (value: number) => {
          events.push('write scroll')
          top = value
        },
      },
      scrollHeight: {
        get: () => {
          events.push('read range')
          return 1600
        },
      },
      clientHeight: {
        get: () => {
          events.push('read height')
          return 400
        },
      },
    })
    container.getBoundingClientRect = () => {
      events.push('read box')
      return { top: 0 } as DOMRect
    }
    message.getBoundingClientRect = () => {
      events.push('read anchor')
      return { top: documentTop - top, bottom: documentTop + 100 - top } as DOMRect
    }
    let scroll!: ReturnType<typeof useChatScroll>
    wrapper = mount(
      defineComponent({
        setup() {
          scroll = useChatScroll({
            messagesContainer: ref(container),
            messages: ref(
              Array.from({ length: 100 }, (_, i) => ({ id: `sample-${i}` })) as ChatMessage[]
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
    scroll.loadOlder()
    await nextTick()
    documentTop = 600
    const remove = container.classList.remove.bind(container.classList)
    vi.spyOn(container.classList, 'remove').mockImplementation((...names) => {
      events.push('write class')
      remove(...names)
    })
    events.length = 0
    mutated()
    expect(top).toBe(500)
    const firstWrite = events.findIndex((event) => event.startsWith('write'))
    expect(firstWrite).toBeGreaterThan(0)
    expect(events.slice(firstWrite).every((event) => event.startsWith('write'))).toBe(true)
    expect(events.filter((event) => event === 'read range')).toHaveLength(1)
    expect(events.filter((event) => event === 'write scroll')).toHaveLength(1)
  })

  it.each([true, false])(
    'coalesces unanchored mutation bursts (following: %s)',
    async (following) => {
      let mutated!: () => void
      vi.stubGlobal(
        'MutationObserver',
        class {
          constructor(callback: () => void) {
            mutated = callback
          }
          observe() {}
          disconnect() {}
        }
      )
      const container = document.createElement('div')
      document.body.append(container)
      const range = vi.fn(() => 1000)
      Object.defineProperties(container, {
        scrollHeight: { get: range },
        clientHeight: { get: () => 400 },
      })
      wrapper = mount(
        defineComponent({
          setup() {
            const scroll = useChatScroll({
              messagesContainer: ref(container),
              messages: ref([]),
              streamingContent: ref(''),
              streamingThinking: ref(''),
              isStreaming: ref(false),
              composing: ref(false),
            })
            scroll.shouldAutoScroll = following
            return () => h('div')
          },
        })
      )
      await nextTick()
      await advance(60)
      range.mockClear()
      mutated()
      mutated()
      mutated()
      expect(range).not.toHaveBeenCalled()
      await advance(17)
      const reads = range.mock.calls.length
      expect(reads).toBeGreaterThan(0)
      range.mockClear()
      mutated()
      await advance(17)
      expect(range).toHaveBeenCalledTimes(reads)
    }
  )

  it('cancels the losing frame fallback instead of retaining its callback until timeout', async () => {
    const { container, anchors } = conversation(0)
    const before = vi.getTimerCount()
    const run = vi.fn()
    anchors.nextFrame(container.win, run)
    await advance(17)
    expect(run).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(before)
  })

  it('does not reuse container geometry across layout passes', () => {
    const { container, anchors } = conversation(1)
    const message = container.children[0] as HTMLElement
    let boxTop = 20
    container.getBoundingClientRect = () => ({ top: boxTop }) as DOMRect
    message.getBoundingClientRect = () => ({ top: boxTop + 40, bottom: boxTop + 80 }) as DOMRect
    anchors.anchor = { el: message, offset: 40 }
    anchors.holdLayout()
    boxTop += 100
    anchors.holdLayout()
    expect(container.scrollTop).toBe(0)
  })

  it('preserves native movement occurring between a page capture and layout correction', () => {
    const { container, anchors } = conversation(1)
    const message = container.children[0] as HTMLElement
    let documentTop = 500
    container.scrollTop = 100
    message.getBoundingClientRect = () =>
      ({
        top: documentTop - container.scrollTop,
        bottom: documentTop + 100 - container.scrollTop,
      }) as DOMRect
    anchors.captureAnchor()
    container.scrollTop += 80
    documentTop += 300
    anchors.holdAnchor()
    expect(container.scrollTop).toBe(480)
    container.scrollTop += 40
    anchors.holdAnchor()
    expect(container.scrollTop).toBe(520)
  })

  it('corrects the anchor before releasing a floor that prevents native clamping', () => {
    const { container, anchors } = conversation(1)
    let top = 900,
      limit = 1200,
      documentTop = 1000
    const maximum = () => (container.classList.contains(FLOOR) ? 1200 : limit)
    Object.defineProperty(container, 'scrollTop', {
      get: () => (top = Math.min(top, maximum())),
      set: (value) => {
        top = Math.min(value, maximum())
      },
    })
    container.children[0].getBoundingClientRect = () =>
      ({
        top: documentTop - container.scrollTop,
        bottom: documentTop + 100 - container.scrollTop,
      }) as DOMRect
    anchors.captureAnchor()
    documentTop = 600
    limit = 600
    anchors.holdAnchor()
    expect(container.scrollTop).toBe(500)
  })

  it('reads the gap and anchor before correcting scroll and releasing the floor', () => {
    const { container, anchors } = conversation(30)
    let top = 900
    let documentTop = 1000
    let limit = 1200
    const events: string[] = []
    Object.defineProperties(container, {
      scrollTop: {
        get: () => {
          events.push('read scroll')
          return (top = Math.min(top, container.classList.contains(FLOOR) ? 1200 : limit))
        },
        set: (value: number) => {
          events.push('write scroll')
          top = Math.min(value, container.classList.contains(FLOOR) ? 1200 : limit)
        },
      },
      clientHeight: {
        get: () => {
          events.push('read height')
          return 400
        },
      },
      scrollHeight: {
        configurable: true,
        get: () => {
          events.push('read range')
          return 1600
        },
      },
    })
    const bounds = vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => {
      events.push('read box')
      return { top: 20 } as DOMRect
    })
    const message = container.children[0]
    const measure = vi.spyOn(message, 'getBoundingClientRect').mockImplementation(() => {
      events.push('read anchor')
      return { top: 20 + documentTop - top, bottom: 120 + documentTop - top } as DOMRect
    })
    const other = vi.spyOn(container.children[1], 'getBoundingClientRect')
    anchors.captureAnchor()
    // Releasing the floor before applying -400 would clamp 900 to 600 and
    // lose another 300 pixels of the reading position during page eviction.
    documentTop = 600
    limit = 600
    events.length = 0
    measure.mockClear()
    bounds.mockClear()
    const remove = container.classList.remove.bind(container.classList)
    vi.spyOn(container.classList, 'remove').mockImplementation((...names) => {
      events.push('write class')
      remove(...names)
    })
    let gap = 0
    anchors.holdLayout((geometry) => {
      events.push('read gap')
      gap = geometry.scrollHeight - geometry.scrollTop - geometry.clientHeight
    })
    expect(top).toBe(500)
    expect(gap).toBe(700)
    expect(container.classList.contains(FLOOR)).toBe(false)
    const firstWrite = events.findIndex((event) => event.startsWith('write'))
    expect(firstWrite).toBeGreaterThan(0)
    expect(events.slice(firstWrite).every((event) => event.startsWith('write'))).toBe(true)
    expect(events.filter((event) => event === 'write scroll')).toHaveLength(1)
    expect(events.filter((event) => event === 'read range')).toHaveLength(1)
    expect(events.filter((event) => event === 'read height')).toHaveLength(1)
    expect(measure).toHaveBeenCalledTimes(1)
    expect(bounds).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
  })

  it('measures an anchor without a saved document position only once', () => {
    const { container, anchors } = conversation(1)
    const message = container.children[0] as HTMLElement
    const measure = vi
      .spyOn(message, 'getBoundingClientRect')
      .mockReturnValue({ top: 40, bottom: 80 } as DOMRect)
    anchors.anchor = { el: message, offset: 40 }
    anchors.holdAnchor()
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it('does not invalidate styles when a held anchor has already released its floor', () => {
    const { container, anchors } = conversation(1)
    anchors.captureAnchor()
    anchors.holdAnchor()
    const remove = vi.spyOn(container.classList, 'remove')
    const removeProperty = vi.spyOn(container.style, 'removeProperty')
    for (let i = 0; i < 20; i++) anchors.holdAnchor()
    expect(remove).not.toHaveBeenCalled()
    expect(removeProperty).not.toHaveBeenCalled()
  })

  it('does not accumulate layout polling when reader gestures replace a floor', async () => {
    const { container, anchors } = conversation(1)
    const measure = vi
      .spyOn(container.children[0], 'getBoundingClientRect')
      .mockReturnValue({ top: 0, bottom: 100, height: 100 } as DOMRect)
    anchors.steadyReader()
    measure.mockClear()
    await advance(64)
    const baseline = measure.mock.calls.length
    for (let i = 0; i < 20; i++) {
      anchors.releaseReader()
      anchors.steadyReader()
    }
    measure.mockClear()
    await advance(64)
    expect(measure.mock.calls.length).toBeLessThanOrEqual(baseline + 2)
  })
  it('anchors a viewport containing only folded tool runs', async () => {
    const { container, anchors } = conversation(1)
    const run = container.children[0] as HTMLElement
    run.className = 'abele-chat-run is-collapsed'
    run.getBoundingClientRect = () => ({ top: 0, bottom: 100 }) as DOMRect
    anchors.captureAnchor()
    expect(anchors.anchor?.el).toBe(run)
    anchors.steadyReader()
    await advance(60)
    expect(container.classList.contains(FLOOR)).toBe(true)
  })
  it('keeps a later page hold when an earlier hold reaches its deadline', async () => {
    const { container, anchors } = conversation(2)
    anchors.anchor = { el: container.children[0] as HTMLElement, offset: 0 }
    anchors.holdAnchorAWhile(container)
    await advance(1000)
    const later = { el: container.children[1] as HTMLElement, offset: 0 }
    anchors.anchor = later
    anchors.holdAnchorAWhile(container)
    await advance(600)
    expect(anchors.anchor).toBe(later)
  })

  it('is let go at once when the conversation holds no messages', async () => {
    const { container, anchors } = conversation(0)
    anchors.steadyReader()
    expect(container.classList.contains(FLOOR)).toBe(true)

    await advance(60)
    expect(container.classList.contains(FLOOR)).toBe(false)
    expect(container.style.getPropertyValue('--abele-chat-floor')).toBe('')
  })

  it('holds under messages that have not drawn again, until the hold runs out', async () => {
    const { container, anchors } = conversation(2)
    anchors.steadyReader()

    await advance(60)
    expect(container.classList.contains(FLOOR)).toBe(true)
    expect(container.style.getPropertyValue('--abele-chat-floor')).toBe('1000px')
    await advance(1600)
    expect(container.classList.contains(FLOOR)).toBe(false)
  })
})
