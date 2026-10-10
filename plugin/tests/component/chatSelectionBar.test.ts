/**
 * A fictional chat contains selectable text. A long press starts selection and then extends it.
 * "Ask here" must remain hidden while the selection moves and appear below it only after the
 * touch ends; it must not obstruct the words being selected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { Platform } from 'obsidian'
import ChatSelectionBar from '@/components/ChatSelectionBar.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import type { ChatMessage } from '@/ai/types'
import { SETTLE_MS } from '@/helpers/settledSelection'
import { useVault } from '../helpers/testEnv'

let scroller: HTMLElement
let wrapper: VueWrapper

const touch = (type: 'touchstart' | 'touchend', down: number) => {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'touches', { value: { length: down } })
  scroller.dispatchEvent(event)
}

function select(words: string, message = 'm1') {
  const text = scroller.querySelector(`[data-ask-message="${message}"] p`)!.firstChild as Text
  const at = text.data.indexOf(words)
  const range = document.createRange()
  range.setStart(text, at)
  range.setEnd(text, at + words.length)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

const bar = () => wrapper.find('.abele-chat-selection')

beforeEach(() => {
  useVault([])
  vi.useFakeTimers()
  Platform.isMobile = true
  Platform.isPhone = true
  const frame = document.createElement('div')
  scroller = document.createElement('div')
  scroller.innerHTML =
    '<div data-ask-message="m1"><p>Take the night train.</p></div><div><p>Not a message.</p></div>'
  frame.append(scroller)
  document.body.append(frame)
  wrapper = mount(ChatSelectionBar, { attachTo: frame, props: { scroller } })
})

afterEach(() => {
  wrapper.unmount()
  document.body.replaceChildren()
  document.getSelection()?.removeAllRanges()
  Platform.isMobile = false
  Platform.isPhone = false
  vi.useRealTimers()
})

describe('words selected in a chat on a phone', () => {
  it('bring up nothing while the finger is still selecting', async () => {
    touch('touchstart', 1)
    select('night')
    select('night train')
    await vi.advanceTimersByTimeAsync(2000)
    expect(bar().exists()).toBe(false)
  })

  it('bring up "Ask here" once the finger is lifted and the words have stopped', async () => {
    touch('touchstart', 1)
    select('night train')
    touch('touchend', 0)
    await vi.advanceTimersByTimeAsync(SETTLE_MS.touch + 20)
    expect(bar().text()).toContain('Ask here')

    await bar().find('button').trigger('click')
    expect(wrapper.emitted('ask')?.[0]).toEqual(['m1', 'night train', 9])
    expect(bar().exists()).toBe(false)
  })

  it('copies a link to the captured selection even if the tap clears native selection', async () => {
    scroller.querySelector<HTMLElement>('[data-ask-message]')!.dataset.copySelection = 'true'
    const copy = vi.fn()
    const captureLink = vi.fn(() => copy)
    await wrapper.setProps({ captureLink })
    select('night train')
    await vi.advanceTimersByTimeAsync(SETTLE_MS.touch + 20)
    expect(captureLink).toHaveBeenCalledWith('m1', 'night train', 9, 'Take the night train.')
    const button = bar()
      .findAll('button')
      .find((button) => button.text() === 'Copy link to selection')!
    expect(button).toBeDefined()
    await button.trigger('pointerdown')
    document.getSelection()!.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    await button.trigger('click')
    expect(copy).toHaveBeenCalledOnce()
    expect(wrapper.emitted('ask')).toBeUndefined()
  })

  it('collapses a long script menu into a searchable picker and keeps the captured launch on selection loss', async () => {
    scroller.querySelector<HTMLElement>('[data-ask-message]')!.dataset.copySelection = 'true'
    const run = vi.fn()
    const captureScript = vi.fn(() => run)
    await wrapper.setProps({
      captureScript,
      scripts: Array.from({ length: 20 }, (_, i) => ({
        script: `Sample ${i}`,
        label: `Long sample ${i}`,
        icon: 'scroll-text',
      })),
    } as any)
    select('night train')
    await vi.advanceTimersByTimeAsync(SETTLE_MS.touch + 20)
    expect(captureScript).toHaveBeenCalledWith('m1', 'night train', 9, 'Take the night train.')
    const button = bar().find('[aria-label="Run a script on these words…"]')
    expect(button.exists(), bar().html()).toBe(true)
    expect(bar().text()).not.toContain('Long sample')
    await button.trigger('pointerdown')
    document.getSelection()!.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    await button.trigger('click')
    expect(run).toHaveBeenCalledWith(undefined)
    expect(bar().exists()).toBe(false)
  })

  it('offers no script launch on a streamed target without a saved-selection marker', async () => {
    const captureScript = vi.fn(() => vi.fn())
    await wrapper.setProps({ captureScript } as any)
    select('train')
    await vi.advanceTimersByTimeAsync(SETTLE_MS.touch + 20)
    expect(captureScript).not.toHaveBeenCalled()
    expect(bar().find('[aria-label="Run a script on these words…"]').exists()).toBe(false)
  })

  it('go away at once when the words are let go', async () => {
    select('train')
    await vi.advanceTimersByTimeAsync(SETTLE_MS.touch + 20)
    expect(bar().exists()).toBe(true)
    document.getSelection()!.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(bar().exists()).toBe(false)
  })

  it('offer nothing outside a message a comment can be kept on', async () => {
    const text = scroller.querySelectorAll('p')[1].firstChild as Text
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 3)
    document.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(bar().exists()).toBe(false)
  })
})

describe('the message on a phone', () => {
  it('opens no menu of its own on the long press that starts a selection', async () => {
    const obsidian = await import('obsidian')
    const shown = vi.spyOn(obsidian.Menu.prototype, 'showAtMouseEvent')
    const message = mount(AiChatMessage, {
      attachTo: document.body,
      props: {
        message: {
          id: 'm2',
          role: 'assistant',
          content: 'Go by bus.',
          timestamp: 1,
        } as ChatMessage,
        canComment: true,
      },
    })
    await vi.advanceTimersByTimeAsync(10)
    const md = message.find('.abele-markdown')
    expect(md.attributes('data-ask-message')).toBe('m2')
    const text = md.element.firstChild as Text
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 2)
    document.getSelection()!.addRange(range)
    const hostMenu = vi.fn((event: Event) => event.preventDefault())
    document.body.addEventListener('contextmenu', hostMenu)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    md.element.dispatchEvent(event)
    document.body.removeEventListener('contextmenu', hostMenu)
    // The host's custom context menu cancels WebKit's native word selection.
    expect(hostMenu).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(shown).not.toHaveBeenCalled()
    message.unmount()
  })
})
