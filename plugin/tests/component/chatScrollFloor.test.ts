/**
 * While the conversation changes under a reader, the chat keeps its scroll range at least as
 * long as it was, so a browser that clamps the scroll mid-change has nothing to clamp. A chat
 * left with no messages — a new one, or another opened in its place — has no place to hold, and
 * a floor there only scrolls its greeting out of sight: it is let go at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { useChatScrollAnchors } from '@/composables/useChatScrollAnchors'
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
