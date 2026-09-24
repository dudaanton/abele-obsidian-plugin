/**
 * Text put into the chat's input while the chat is not on screen — "Ask here" or "Chat about
 * this" on a phone, where the chat is a closed drawer until the text is in.
 *
 * The field is sized to its text when the text arrives, and a hidden field measures nothing:
 * it came out one line tall, scrolled to the blank line at the end, and the link and the quote
 * above it were out of sight until the person typed. It is sized again once it is drawn.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AiChatInput from '@/components/AiChatInput.vue'
import { useVault } from '../helpers/testEnv'

let observed: { callback: ResizeObserverCallback; targets: Element[] }[] = []

class FakeResizeObserver {
  entry: { callback: ResizeObserverCallback; targets: Element[] }
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: [] }
    observed.push(this.entry)
  }
  observe(el: Element) {
    this.entry.targets.push(el)
  }
  unobserve() {}
  disconnect() {
    this.entry.targets = []
  }
}

beforeEach(() => {
  useVault([])
  observed = []
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  document.body.replaceChildren()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('text put in while the chat is hidden', () => {
  it('is sized to its text once the field is drawn', async () => {
    const wrapper = mount(AiChatInput, {
      attachTo: document.body,
      props: {
        isStreaming: false,
        isBusy: false,
        canContinue: false,
        tokenDisplay: '',
        scopeLabel: '',
      },
    })
    const field = wrapper.find('textarea').element as HTMLTextAreaElement
    let height = 0
    let shown = false
    Object.defineProperty(field, 'scrollHeight', { get: () => height, configurable: true })
    field.getClientRects = () => (shown ? [new DOMRect(0, 0, 300, 34)] : []) as never

    // Hidden: nothing to measure, and no height of nothing is set.
    ;(wrapper.vm as unknown as { setText: (t: string) => void }).setText('[a link](x)\n> words\n\n')
    await flushPromises()
    expect(field.style.height).not.toBe('0px')

    // The drawer opens: the field has a width, and its text a height.
    shown = true
    height = 90
    const watcher = observed.find((o) => o.targets.includes(field))
    expect(watcher).toBeDefined()
    watcher!.callback(
      [{ contentRect: { width: 300 } } as ResizeObserverEntry],
      {} as ResizeObserver
    )
    expect(field.style.height).toBe('90px')
  })
})
