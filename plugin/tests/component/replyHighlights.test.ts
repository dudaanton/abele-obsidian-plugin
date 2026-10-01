import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mount, flushPromises } from '@vue/test-utils'
import { paintReplyHighlights, paintMessageComments, selectionAnchor } from '@/ai/messageComments'
import AiChatMessage from '@/components/AiChatMessage.vue'
import ChatSelectionBar from '@/components/ChatSelectionBar.vue'
import { Platform } from 'obsidian'
import { useVault } from '../helpers/testEnv'
import { SETTLE_MS } from '@/helpers/settledSelection'

beforeEach(() => useVault([]))

describe('reply highlight rendering', () => {
  it('explicitly enables WebKit selection instead of inheriting a touch pane’s user-select none', () => {
    const source = readFileSync('src/components/AiChatMessage.vue', 'utf8')
    const rule =
      source.match(/\.abele-chat-msg__body \[data-ask-message\][^{]*\{([^}]+)\}/)?.[1] ?? ''
    expect(rule).toContain('-webkit-user-select: text')
    expect(rule).toContain('user-select: text')
    expect(rule).toContain('-webkit-touch-callout: default')
  })
  it('paints across formatting and repaints without counting comment badges or changing the text', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>A <strong>small</strong> lantern glows.</p>'
    const marks = [{ id: 'h', quote: 'small lantern', start: 2, color: 'blue' as const }]
    paintMessageComments(
      root,
      [{ id: 'c', quote: 'small', start: 2, count: 12, state: 'idle', open: false }],
      vi.fn()
    )
    paintReplyHighlights(root, marks)
    paintReplyHighlights(root, marks)
    expect(
      [...root.querySelectorAll('[data-reply-highlight]')].map((el) => el.textContent).join('')
    ).toBe('small lantern')
    expect(root.querySelectorAll('.abele-highlight--blue')).toHaveLength(2)
    const range = document.createRange()
    range.selectNodeContents(root)
    expect(selectionAnchor(root, range)).toEqual({ quote: 'A small lantern glows.', start: 0 })
    paintReplyHighlights(root, [])
    expect(root.querySelector('[data-reply-highlight]')).toBeNull()
    expect(root.querySelectorAll('.abele-comment-marker')).toHaveLength(1)
  })

  it('does not move a missing highlight to another occurrence', () => {
    const root = document.createElement('div')
    root.textContent = 'lamp then lamp'
    paintReplyHighlights(root, [{ id: 'h', quote: 'lamp', start: 5, color: 'yellow' }])
    expect(root.querySelector('[data-reply-highlight]')).toBeNull()
  })

  it('offers a removable highlight even when its words no longer render', async () => {
    const wrapper = mount(AiChatMessage, {
      props: {
        message: {
          id: 'reply',
          role: 'assistant',
          content: 'Different words.',
          timestamp: 1,
          highlights: [{ id: 'h', quote: 'small', start: 2, color: 'green' }],
        },
        canComment: true,
      },
    })
    await flushPromises()
    await wrapper.find('.abele-chat-msg__icon').trigger('click')
    const remove = wrapper.find('[aria-label="Remove highlight: small"]')
    expect(remove.exists()).toBe(true)
    await remove.trigger('click')
    expect(wrapper.emitted('remove-highlight')).toEqual([['reply', 'h']])
    wrapper.unmount()
  })

  it('offers all book colours on a phone and preserves selection through tapping a colour', async () => {
    Platform.isMobile = true
    vi.useFakeTimers()
    const frame = document.createElement('div'),
      scroller = document.createElement('div')
    scroller.innerHTML =
      '<div data-ask-message="reply" data-highlight-reply="true">A small lantern.</div>'
    frame.append(scroller)
    document.body.append(frame)
    const wrapper = mount(ChatSelectionBar, { attachTo: frame, props: { scroller } })
    const range = document.createRange()
    range.setStart(scroller.firstChild!.firstChild!, 2)
    range.setEnd(scroller.firstChild!.firstChild!, 7)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await vi.advanceTimersByTimeAsync(SETTLE_MS.touch + 20)
    expect(wrapper.findAll('[data-highlight-color]')).toHaveLength(6)
    expect(wrapper.findAll('[data-highlight-color] .abele-highlight')).toHaveLength(6)
    await wrapper.find('[data-highlight-color="purple"]').trigger('pointerdown')
    document.getSelection()!.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    await wrapper.find('[data-highlight-color="purple"]').trigger('click')
    expect(wrapper.emitted('highlight')).toEqual([['reply', 'small', 2, 'purple']])
    wrapper.unmount()
    frame.remove()
    vi.useRealTimers()
    Platform.isMobile = false
  })
})
