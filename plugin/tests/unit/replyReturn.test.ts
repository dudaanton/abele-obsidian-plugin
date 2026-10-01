import { describe, expect, it, vi } from 'vitest'
import { flashMessagePassage, paintMessageComments, selectionAnchor } from '@/ai/messageComments'

describe('returning to selected reply words', () => {
  it('marks only the selected repeated occurrence across formatting', () => {
    const root = createDiv()
    root.innerHTML =
      '<p>A small lantern.</p><p>Later a <strong>small</strong> lantern, by a gate.</p>'
    const text = 'A small lantern.Later a small lantern, by a gate.'
    const quote = 'small lantern,',
      start = text.indexOf(quote)
    paintMessageComments(
      root,
      [{ id: 'sample', quote: 'A small', start: 0, count: 123, state: 'idle', open: false }],
      vi.fn()
    )
    const target = flashMessagePassage(root, quote, start)
    expect(target).not.toBeNull()
    expect(
      [...root.querySelectorAll('[data-reply-return]')].map((el) => el.textContent).join('')
    ).toBe(quote)
    expect(target!.closest('p')).toBe(root.querySelectorAll('p')[1])
    const range = document.createRange()
    range.selectNodeContents(root)
    expect(selectionAnchor(root, range)?.quote).toBe(text)
  })
  it('falls back safely when words are gone and replaces old flashes on repeated returns', () => {
    const root = createDiv()
    root.textContent = 'A lantern beside the gate.'
    flashMessagePassage(root, 'lantern', 2)
    flashMessagePassage(root, 'gate', 21)
    expect(root.querySelectorAll('[data-reply-return]')).toHaveLength(1)
    expect(root.querySelector('[data-reply-return]')!.textContent).toBe('gate')
    expect(flashMessagePassage(root, 'gone', 0)).toBeNull()
    expect(root.querySelector('[data-reply-return]')).toBeNull()
  })
})
