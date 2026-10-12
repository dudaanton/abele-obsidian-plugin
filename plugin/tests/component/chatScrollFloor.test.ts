/**
 * While the conversation changes under a reader, the chat keeps its scroll range at least as
 * long as it was, so a browser that clamps the scroll mid-change has nothing to clamp. A chat
 * left with no messages — a new one, or another opened in its place — has no place to hold, and
 * a floor there only scrolls its greeting out of sight: it is let go at once.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
