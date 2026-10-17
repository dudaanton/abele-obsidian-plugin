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
  vi.restoreAllMocks()
})

it('does not reset the focused textarea height or selection on a same-line input', async () => {
  const wrapper = mount(AiChatInput, {
    attachTo: document.body,
    props: {
      textOnly: true,
      isStreaming: false,
      isBusy: false,
      canContinue: false,
      tokenDisplay: '',
      scopeLabel: '',
    },
  })
  const field = wrapper.get('textarea').element as HTMLTextAreaElement
  field.style.height = '36px'
  field.style.maxHeight = '204px'
  field.style.overflowY = 'hidden'
  field.style.width = '300px'
  field.getClientRects = () => [new DOMRect(0, 0, 300, 36)] as never
  Object.defineProperty(field, 'clientHeight', {
    configurable: true,
    get: () => Number.parseFloat(field.style.height) || 36,
  })
  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLTextAreaElement
  ) {
    return Math.max(
      Number.parseFloat(this.style.height) || 0,
      this.value.split('\n').length * 24 + 12
    )
  })
  const mutations: MutationRecord[] = []
  const observer = new MutationObserver((records) => mutations.push(...records))
  observer.observe(field, { attributes: true, attributeFilter: ['style'], attributeOldValue: true })
  try {
    field.focus()
    field.value = 'sample text'
    field.setSelectionRange(3, 3)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    expect(mutations.map((m) => m.oldValue)).toEqual([])
    expect(wrapper.get('textarea').element).toBe(field)
    expect(document.activeElement).toBe(field)
    expect(field.selectionStart).toBe(3)
    expect(field.selectionEnd).toBe(3)
    expect(field.style.height).toBe('36px')

    field.value = Array.from({ length: 12 }, () => 'sample line').join('\n')
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(field.style.height).toBe('204px')
    expect(field.style.overflowY).toBe('auto')

    field.value = 'two\nlines'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(field.style.height).toBe('60px')
    expect(field.style.overflowY).toBe('hidden')
    expect(wrapper.findAll('textarea')).toHaveLength(1)
  } finally {
    observer.disconnect()
    wrapper.unmount()
  }
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
