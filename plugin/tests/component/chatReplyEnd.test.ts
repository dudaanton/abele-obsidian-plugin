/**
 * A reply ending under a reader who has scrolled back into it.
 *
 * The reply's text moves from the streaming block into the message that replaces it, and for a
 * moment in between the message is on the page and has not drawn its text yet. WebKit, which is
 * what a phone runs, clamps a scroll position the moment anything reads the layout, and in that
 * moment the conversation ends where the reply used to start: a reader halfway down the reply was
 * put at that end, and on a short chat at its very top. A desktop's browser waits for the frame
 * to clamp, by which time the text is back, so this was seen on a phone only.
 *
 * happy-dom lays nothing out, so the layout is modelled the way WebKit behaves: every block has a
 * height, a message just mounted has none until its text is drawn, and reading the position
 * clamps it to what the content allows at that moment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useFakeClock } from '../helpers/fakeClock'
const frames = useFakeClock()

const messages = ref<ChatMessage[]>([])
const streaming = ref('')
const isStreaming = ref(false)

let attached: ReturnType<typeof mount> | null = null

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  messages.value = Array.from({ length: 6 }, (_, i) => ({
    id: `m${i + 1}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${i + 1}`,
    timestamp: i + 1,
  })) as ChatMessage[]
  streaming.value = ''
  isStreaming.value = false
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
    value: fakeChatSession({
      messages,
      kind: 'chat',
      overrides: { streamingContent: streaming, isStreaming },
    }),
  } as never)
})

afterEach(() => {
  attached?.unmount()
  attached = null
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const BOX = 800
const MESSAGE = 100
const REPLY = 3000

/** The layout, as WebKit keeps it: see the comment at the top. */
function webkitModel(container: HTMLElement) {
  /** Blocks whose text has been drawn, and how tall they are. Anything else has no height. */
  const drawn = new Map<Element, number>()
  let scrollTop = 0

  const blocks = () =>
    [...container.children].filter(
      (el) =>
        el.classList.contains('abele-chat-msg') || el.classList.contains('abele-ai-chat__streaming')
    )
  const content = () => blocks().reduce((sum, el) => sum + (drawn.get(el) ?? 0), 0)
  // The browser's scroll range: the content, or the floor the chat puts under it, if taller.
  const floor = () => parseFloat(container.style.getPropertyValue('--abele-chat-floor') || '0') || 0
  const range = () => Math.max(content(), floor())
  const clamp = () => {
    scrollTop = Math.max(0, Math.min(scrollTop, range() - BOX))
  }

  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => {
      clamp()
      return scrollTop
    },
    set: (v: number) => {
      scrollTop = v
      clamp()
    },
  })
  Object.defineProperty(container, 'scrollHeight', { configurable: true, get: range })
  Object.defineProperty(container, 'clientHeight', { configurable: true, get: () => BOX })
  container.getBoundingClientRect = () => ({ top: 0, bottom: BOX, height: BOX }) as DOMRect

  const relayout = () => {
    let offset = 0
    for (const el of blocks()) {
      const top = offset
      const height = drawn.get(el) ?? 0
      const rect = () =>
        ({ top: top - scrollTop, bottom: top + height - scrollTop, height }) as DOMRect
      Object.defineProperty(el, 'getBoundingClientRect', { configurable: true, value: rect })
      Object.defineProperty(el, 'getClientRects', {
        configurable: true,
        value: () => (height ? [rect()] : []),
      })
      offset += height
    }
  }

  return {
    draw: (el: Element, height: number) => {
      drawn.set(el, height)
      relayout()
    },
    blocks,
    relayout,
    scrollTo: (v: number) => {
      scrollTop = v
      relayout()
    },
    /** Where the reader is, read without the read clamping anything. */
    at: () => scrollTop,
  }
}

describe('a reply ending while the reader is back in it', () => {
  it('keeps the reader where they were, though the message draws its text a moment late', async () => {
    attached = mount(AiChat, { attachTo: document.body })
    const container = attached.find('.abele-ai-chat__messages').element as HTMLElement
    const model = webkitModel(container)

    isStreaming.value = true
    streaming.value = 'The reply'
    await nextTick()
    await nextTick()
    for (const el of model.blocks())
      model.draw(el, el.classList.contains('abele-ai-chat__streaming') ? REPLY : MESSAGE)

    // The reader scrolls back into the middle of the reply and reads there.
    const reading = 6 * MESSAGE + REPLY / 2
    await attached.find('.abele-ai-chat__messages').trigger('touchstart')
    model.scrollTo(reading)
    await attached.find('.abele-ai-chat__messages').trigger('touchend')
    await attached.find('.abele-ai-chat__messages').trigger('scroll')

    // The reply ends: its message takes the streaming block's place, its text not drawn yet.
    messages.value = [
      ...messages.value,
      { id: 'reply', role: 'assistant', content: 'The reply', timestamp: 7 } as ChatMessage,
    ]
    streaming.value = ''
    isStreaming.value = false
    await nextTick()
    model.relayout()

    // Something reads the layout in that moment, as a phone's own code does.
    void container.scrollTop

    // Then the message draws its text, as tall as the reply was.
    const reply = model.blocks().at(-1)!
    model.draw(reply, REPLY)
    await frames(120)

    expect(model.at()).toBe(reading)
  })
})
